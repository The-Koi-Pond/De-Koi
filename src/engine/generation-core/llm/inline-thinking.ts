const THINKING_TAG_NAMES = ["thinking", "thoughts", "thought", "reasoning", "reason", "think"] as const;
const THINKING_TAG_PATTERN = THINKING_TAG_NAMES.join("|");
const OPEN_THINKING_TAG_RE = new RegExp(`^<\\s*(${THINKING_TAG_PATTERN})\\b[^>]*>`, "i");
const CLOSE_THINKING_TAG_RE = new RegExp(`^<\\s*\\/\\s*(${THINKING_TAG_PATTERN})\\s*>`, "i");
const BRACKET_COLON_THINKING_TAG_RE = new RegExp(`^\\[\\s*(${THINKING_TAG_PATTERN})\\s*:\\s*([^\\]]*)\\]`, "i");

// Pipe-style thinking tags: <|think|>...<|/think|> and <|channel>thought...<channel|>
const PIPE_THINK_OPEN_RE = new RegExp(`^<\\|(${THINKING_TAG_PATTERN})\\|>`, "i");
const PIPE_THINK_CLOSE_RE = new RegExp(`^<\\|\\/(${THINKING_TAG_PATTERN})\\|>`, "i");
const PIPE_CHANNEL_OPEN_RE = /^<\|channel>\s*thought\b/i;
const PIPE_CHANNEL_CLOSE_RE = /^<channel\|>/i;

// Bracket open/close pairs: [tag]content[/tag] (distinct from [tag: inline] colon form)
const BRACKET_OPEN_PAIR_RE = new RegExp(`^\\[(${THINKING_TAG_PATTERN})\\]`, "i");
const BRACKET_CLOSE_PAIR_RE = new RegExp(`^\\[\\/(${THINKING_TAG_PATTERN})\\]`, "i");

export type InlineThinkingPart = { type: "content" | "thinking"; text: string };
export interface CustomThinkingTagPair {
  open: string;
  close: string;
}

export interface InlineThinkingStreamParserOptions {
  customThinkingTags?: unknown;
}

function customThinkingTagText(entry: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = entry[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function normalizeCustomThinkingTags(value: unknown): CustomThinkingTagPair[] {
  if (!Array.isArray(value)) return [];
  const tags: CustomThinkingTagPair[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    let open = "";
    let close = "";
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const record = entry as Record<string, unknown>;
      open = customThinkingTagText(record, ["open", "openingTag", "openTag", "start", "startTag"]);
      close = customThinkingTagText(record, ["close", "closingTag", "closeTag", "end", "endTag"]);
    } else if (Array.isArray(entry)) {
      const [rawOpen, rawClose] = entry;
      open = typeof rawOpen === "string" ? rawOpen.trim() : "";
      close = typeof rawClose === "string" ? rawClose.trim() : "";
    }

    if (!open || !close) continue;
    const key = `${open}\u0000${close}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push({ open, close });
    if (tags.length >= 20) break;
  }

  return tags;
}

function possibleTagPrefix(buffer: string, closing: boolean): boolean {
  if (!buffer.startsWith("<") || buffer.includes(">")) return false;
  const body = buffer.slice(1).replace(/^\s+/, "").toLowerCase();
  const normalized = closing ? body.replace(/^\/\s*/, "") : body;
  if (closing && !body.startsWith("/") && !"/".startsWith(body)) return false;
  if (!/^[\w-]*$/.test(normalized)) return false;
  return THINKING_TAG_NAMES.some((tag) => tag.startsWith(normalized));
}

function possiblePipeTagPrefix(buffer: string): boolean {
  if (!buffer.startsWith("<")) return false;
  const body = buffer.slice(1).toLowerCase();
  if (!body.startsWith("|")) return false;

  // <|channel>thought — allow > mid-tag for this asymmetric form
  const CHANNEL_FULL = "|channel>thought";
  if (body.startsWith("|c") && CHANNEL_FULL.startsWith(body)) return true;

  // Standard pipe tags: <|tag|> or <|/tag|>  — > means complete or broken
  if (buffer.includes(">")) return false;
  if (body.length <= 1) return true; // bare <|

  if (body.startsWith("|/")) {
    if (body.length <= 2) return true; // bare <|/
    const tagBody = body.slice(2).replace(/^\s*/, "");
    return tagBody.length > 0 && THINKING_TAG_NAMES.some((tag) => tag.startsWith(tagBody));
  }

  const tagBody = body.slice(1).replace(/^\s*/, "");
  return tagBody.length > 0 && THINKING_TAG_NAMES.some((tag) => tag.startsWith(tagBody));
}

function possibleBracketThinkingPrefix(buffer: string): boolean {
  if (!buffer.startsWith("[") || buffer.includes("]")) return false;
  const body = buffer.slice(1).replace(/^\s+/, "").toLowerCase();
  if (!body) return true;
  const colonIndex = body.indexOf(":");
  const tagText = (colonIndex >= 0 ? body.slice(0, colonIndex) : body).trim();
  if (!/^[\w-]*$/.test(tagText)) return false;
  if (colonIndex >= 0) return THINKING_TAG_NAMES.some((tag) => tag === tagText);
  return THINKING_TAG_NAMES.some((tag) => tag.startsWith(tagText));
}

function possibleBracketClosePrefix(buffer: string): boolean {
  if (!buffer.startsWith("[") || buffer.includes("]")) return false;
  const body = buffer.slice(1).toLowerCase();
  if (!body) return true;
  if (!body.startsWith("/")) return false;
  const tagBody = body.slice(1);
  if (!tagBody) return true;
  if (!/^[\w-]*$/.test(tagBody)) return false;
  return THINKING_TAG_NAMES.some((tag) => tag.startsWith(tagBody));
}

function possibleExactPrefix(buffer: string, values: readonly string[]): boolean {
  return values.some((value) => buffer.length < value.length && value.startsWith(buffer));
}

function findOpeningCustomTag(buffer: string, tags: readonly CustomThinkingTagPair[]): CustomThinkingTagPair | null {
  return tags.find((tag) => buffer.startsWith(tag.open)) ?? null;
}

function firstInlineThinkingControlIndex(buffer: string): number {
  const tagIndex = buffer.indexOf("<");
  const bracketIndex = buffer.indexOf("[");
  if (tagIndex < 0) return bracketIndex;
  if (bracketIndex < 0) return tagIndex;
  return Math.min(tagIndex, bracketIndex);
}

function firstControlIndexInThinking(buffer: string): number {
  const ltIndex = buffer.indexOf("<");
  const brIndex = buffer.indexOf("[");
  if (ltIndex < 0) return brIndex;
  if (brIndex < 0) return ltIndex;
  return Math.min(ltIndex, brIndex);
}

export function createInlineThinkingStreamParser(options: InlineThinkingStreamParserOptions = {}) {
  const customThinkingTags = normalizeCustomThinkingTags(options.customThinkingTags);
  const customOpeningTags = customThinkingTags.map((tag) => tag.open);
  let buffer = "";
  let inThinking = false;
  let activeCustomCloseTag: string | null = null;
  // Tracks whether any non-whitespace content has been emitted. Bracket-pair
  // thinking openers ([thought]...[/thought] etc.) are only recognized in the
  // leading zone (before visible content); mid-text [thought] is treated as
  // narration and kept visible. XML, pipe, channel, and custom tags remain
  // recognized anywhere since they are unambiguous model control tokens.
  let emittedNonWhitespaceContent = false;

  const drain = (final = false): InlineThinkingPart[] => {
    const parts: InlineThinkingPart[] = [];
    const pushContent = (text: string) => {
      parts.push({ type: "content", text });
      if (!emittedNonWhitespaceContent && text.trim()) emittedNonWhitespaceContent = true;
    };

    while (buffer.length > 0) {
      if (!inThinking) {
        const tagIndex = firstInlineThinkingControlIndex(buffer);
        if (tagIndex < 0) {
          pushContent(buffer);
          buffer = "";
          break;
        }
        if (tagIndex > 0) {
          pushContent(buffer.slice(0, tagIndex));
          buffer = buffer.slice(tagIndex);
          continue;
        }

        if (buffer.startsWith("[")) {
          // 1. Colon form [tag: inline content] — checked first, unambiguous
          const bracketThinking = buffer.match(BRACKET_COLON_THINKING_TAG_RE);
          if (bracketThinking) {
            const text = bracketThinking[2]?.trim() ?? "";
            if (text) parts.push({ type: "thinking", text });
            buffer = buffer.slice(bracketThinking[0].length);
            continue;
          }

          // 2. Bracket open/close pair [tag]content[/tag] — leading zone only.
          // Mid-text [thought] is narration, not model reasoning.
          if (!emittedNonWhitespaceContent) {
            const bracketOpen = buffer.match(BRACKET_OPEN_PAIR_RE);
            if (bracketOpen) {
              inThinking = true;
              activeCustomCloseTag = null;
              buffer = buffer.slice(bracketOpen[0].length);
              continue;
            }

            // 3. Orphan bracket close [/tag] consumed silently in leading zone
            const orphanBracketCloseIdx = buffer.match(BRACKET_CLOSE_PAIR_RE);
            if (orphanBracketCloseIdx) {
              buffer = buffer.slice(orphanBracketCloseIdx[0].length);
              continue;
            }
          }

          if (!final && possibleBracketThinkingPrefix(buffer)) break;
          pushContent(buffer[0]!);
          buffer = buffer.slice(1);
          continue;
        }

        const customOpening = findOpeningCustomTag(buffer, customThinkingTags);
        if (customOpening) {
          inThinking = true;
          activeCustomCloseTag = customOpening.close;
          buffer = buffer.slice(customOpening.open.length);
          continue;
        }

        // Standard XML open: <think>, <thinking>, etc.
        const opening = buffer.match(OPEN_THINKING_TAG_RE);
        if (opening) {
          inThinking = true;
          activeCustomCloseTag = null;
          buffer = buffer.slice(opening[0].length);
          continue;
        }

        // Pipe-style open: <|think|>, <|channel>thought
        const pipeOpen = buffer.match(PIPE_THINK_OPEN_RE);
        if (pipeOpen) {
          inThinking = true;
          activeCustomCloseTag = null;
          buffer = buffer.slice(pipeOpen[0].length);
          continue;
        }
        const channelOpen = buffer.match(PIPE_CHANNEL_OPEN_RE);
        if (channelOpen) {
          inThinking = true;
          activeCustomCloseTag = null;
          buffer = buffer.slice(channelOpen[0].length);
          continue;
        }

        // Orphan close tags consumed silently outside thinking
        const orphanClosing = buffer.match(CLOSE_THINKING_TAG_RE);
        if (orphanClosing) {
          buffer = buffer.slice(orphanClosing[0].length);
          continue;
        }
        const orphanPipeClose = buffer.match(PIPE_THINK_CLOSE_RE);
        if (orphanPipeClose) {
          buffer = buffer.slice(orphanPipeClose[0].length);
          continue;
        }
        const orphanChannelClose = buffer.match(PIPE_CHANNEL_CLOSE_RE);
        if (orphanChannelClose) {
          buffer = buffer.slice(orphanChannelClose[0].length);
          continue;
        }

        // Partial tag detection — pause if this could start a thinking tag
        if (!final && possibleTagPrefix(buffer, true)) break;
        if (!final && possibleTagPrefix(buffer, false)) break;
        if (!final && possiblePipeTagPrefix(buffer)) break;
        if (!final && possibleExactPrefix(buffer, customOpeningTags)) break;
        parts.push({ type: "content", text: buffer[0]! });
        buffer = buffer.slice(1);
        continue;
      }

      // ——— In thinking mode ———
      const controlIdx = firstControlIndexInThinking(buffer);
      if (controlIdx < 0) {
        parts.push({ type: "thinking", text: buffer });
        buffer = "";
        break;
      }
      if (controlIdx > 0) {
        parts.push({ type: "thinking", text: buffer.slice(0, controlIdx) });
        buffer = buffer.slice(controlIdx);
        continue;
      }

      // Control character at position 0 — check close tags
      if (activeCustomCloseTag) {
        if (buffer.startsWith(activeCustomCloseTag)) {
          const closeTag = activeCustomCloseTag;
          inThinking = false;
          activeCustomCloseTag = null;
          buffer = buffer.slice(closeTag.length);
          continue;
        }
        if (!final && possibleExactPrefix(buffer, [activeCustomCloseTag])) break;
        parts.push({ type: "thinking", text: buffer[0]! });
        buffer = buffer.slice(1);
        continue;
      }

      // Check for close tags (not inside custom tag)
      if (buffer.startsWith("[")) {
        // Bracket close pair [/tag]
        const bracketClose = buffer.match(BRACKET_CLOSE_PAIR_RE);
        if (bracketClose) {
          inThinking = false;
          buffer = buffer.slice(bracketClose[0].length);
          continue;
        }
        if (!final && possibleBracketClosePrefix(buffer)) break;
        parts.push({ type: "thinking", text: buffer[0]! });
        buffer = buffer.slice(1);
        continue;
      }

      // Standard XML close </think>
      const closingTag = buffer.match(CLOSE_THINKING_TAG_RE);
      if (closingTag) {
        inThinking = false;
        buffer = buffer.slice(closingTag[0].length);
        continue;
      }

      // Pipe-style close <|/think|>
      const pipeClose = buffer.match(PIPE_THINK_CLOSE_RE);
      if (pipeClose) {
        inThinking = false;
        buffer = buffer.slice(pipeClose[0].length);
        continue;
      }

      // Channel close <channel|>
      const channelClose = buffer.match(PIPE_CHANNEL_CLOSE_RE);
      if (channelClose) {
        inThinking = false;
        buffer = buffer.slice(channelClose[0].length);
        continue;
      }

      // Partial tag detection
      if (!final && possibleTagPrefix(buffer, true)) break;
      if (!final && possiblePipeTagPrefix(buffer)) break;
      parts.push({ type: "thinking", text: buffer[0]! });
      buffer = buffer.slice(1);
    }

    if (final && buffer.length > 0) {
      if (inThinking) {
        parts.push({ type: "thinking", text: buffer });
      } else {
        pushContent(buffer);
      }
      buffer = "";
    }

    return parts;
  };

  return {
    push(text: string): InlineThinkingPart[] {
      if (!text) return [];
      buffer += text;
      return drain(false);
    },
    flush(): InlineThinkingPart[] {
      return drain(true);
    },
  };
}

/**
 * Non-streaming extraction of leading thinking blocks from a complete response string.
 * Reuses the same built-in tag set + custom tags as the streaming parser.
 * Returns the text with leading thinking blocks removed.
 * If the entire text is a thinking block, returns empty string.
 */
export function extractLeadingThinkingBlocks(
  text: string,
  customTags?: CustomThinkingTagPair[],
): { cleanText: string; leadingThinking: string } {
  const normalizedCustomTags = normalizeCustomThinkingTags(customTags);
  let remaining = text;
  let leadingThinking = "";

  while (remaining.length > 0) {
    const trimmed = remaining.trimStart();

    // Try each built-in open tag family + custom tags
    let found = false;

    // Standard XML open <tag>
    const xmlMatch = trimmed.match(new RegExp(`^<\\s*(${THINKING_TAG_PATTERN})\\b[^>]*>`, "i"));
    if (xmlMatch) {
      const closeMatch = trimmed
        .slice(xmlMatch[0].length)
        .match(new RegExp(`^[\\s\\S]*?<\\s*\\/\\s*(?:${THINKING_TAG_PATTERN})\\s*>`, "i"));
      if (closeMatch) {
        leadingThinking += trimmed.slice(0, xmlMatch[0].length + closeMatch[0].length);
        remaining = trimmed.slice(xmlMatch[0].length + closeMatch[0].length);
        found = true;
        continue;
      }
    }

    // Pipe think open <|tag|>
    const pipeMatch = trimmed.match(new RegExp(`^<\\|(${THINKING_TAG_PATTERN})\\|>`, "i"));
    if (pipeMatch) {
      const closeMatch = trimmed
        .slice(pipeMatch[0].length)
        .match(new RegExp(`^[\\s\\S]*?<\\|\\/(?:${THINKING_TAG_PATTERN})\\|>`, "i"));
      if (closeMatch) {
        leadingThinking += trimmed.slice(0, pipeMatch[0].length + closeMatch[0].length);
        remaining = trimmed.slice(pipeMatch[0].length + closeMatch[0].length);
        found = true;
        continue;
      }
    }

    // Channel open <|channel>thought...<channel|>
    const channelMatch = trimmed.match(/^<\|channel>\s*thought\b/i);
    if (channelMatch) {
      const closeMatch = trimmed.slice(channelMatch[0].length).match(/^[\s\S]*?<channel\|>/i);
      if (closeMatch) {
        leadingThinking += trimmed.slice(0, channelMatch[0].length + closeMatch[0].length);
        remaining = trimmed.slice(channelMatch[0].length + closeMatch[0].length);
        found = true;
        continue;
      }
    }

    // Bracket open pair [tag]
    const bracketMatch = trimmed.match(new RegExp(`^\\[(${THINKING_TAG_PATTERN})\\]`, "i"));
    if (bracketMatch) {
      const closeMatch = trimmed
        .slice(bracketMatch[0].length)
        .match(new RegExp(`^[\\s\\S]*?\\[\\/(?:${THINKING_TAG_PATTERN})\\]`, "i"));
      if (closeMatch) {
        leadingThinking += trimmed.slice(0, bracketMatch[0].length + closeMatch[0].length);
        remaining = trimmed.slice(bracketMatch[0].length + closeMatch[0].length);
        found = true;
        continue;
      }
    }

    // Custom tags
    for (const tag of normalizedCustomTags) {
      if (trimmed.startsWith(tag.open)) {
        const closeIdx = trimmed.indexOf(tag.close, tag.open.length);
        if (closeIdx >= 0) {
          const blockEnd = closeIdx + tag.close.length;
          leadingThinking += trimmed.slice(0, blockEnd);
          remaining = trimmed.slice(blockEnd);
          found = true;
          break;
        }
      }
    }

    // Check for bracket colon form [tag: inline] — always single-line
    const colonMatch = trimmed.match(new RegExp(`^\\[\\s*(${THINKING_TAG_PATTERN})\\s*:\\s*([^\\]]*)\\]`, "i"));
    if (colonMatch) {
      leadingThinking += colonMatch[0];
      remaining = trimmed.slice(colonMatch[0].length);
      found = true;
      continue;
    }

    if (!found) break;

    // Continue scanning — there may be multiple leading thinking blocks
  }

  return { cleanText: remaining, leadingThinking };
}
