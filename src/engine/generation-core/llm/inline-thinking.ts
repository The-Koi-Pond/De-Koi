const THINKING_TAG_NAMES = ["thinking", "thoughts", "thought", "reasoning", "reason", "think"] as const;
const THINKING_TAG_PATTERN = THINKING_TAG_NAMES.join("|");
const OPEN_THINKING_TAG_RE = new RegExp(`^<\\s*(${THINKING_TAG_PATTERN})\\b[^>]*>`, "i");
const CLOSE_THINKING_TAG_RE = new RegExp(`^<\\s*\\/\\s*(${THINKING_TAG_PATTERN})\\s*>`, "i");

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

function possibleExactPrefix(buffer: string, values: readonly string[]): boolean {
  return values.some((value) => buffer.length < value.length && value.startsWith(buffer));
}

function findOpeningCustomTag(buffer: string, tags: readonly CustomThinkingTagPair[]): CustomThinkingTagPair | null {
  return tags.find((tag) => buffer.startsWith(tag.open)) ?? null;
}

export function createInlineThinkingStreamParser(options: InlineThinkingStreamParserOptions = {}) {
  const customThinkingTags = normalizeCustomThinkingTags(options.customThinkingTags);
  const customOpeningTags = customThinkingTags.map((tag) => tag.open);
  let buffer = "";
  let inThinking = false;
  let activeCustomCloseTag: string | null = null;

  const drain = (final = false): InlineThinkingPart[] => {
    const parts: InlineThinkingPart[] = [];

    while (buffer.length > 0) {
      if (!inThinking) {
        const tagIndex = buffer.indexOf("<");
        if (tagIndex < 0) {
          parts.push({ type: "content", text: buffer });
          buffer = "";
          break;
        }
        if (tagIndex > 0) {
          parts.push({ type: "content", text: buffer.slice(0, tagIndex) });
          buffer = buffer.slice(tagIndex);
          continue;
        }

        const customOpening = findOpeningCustomTag(buffer, customThinkingTags);
        if (customOpening) {
          inThinking = true;
          activeCustomCloseTag = customOpening.close;
          buffer = buffer.slice(customOpening.open.length);
          continue;
        }
        const opening = buffer.match(OPEN_THINKING_TAG_RE);
        if (opening) {
          inThinking = true;
          activeCustomCloseTag = null;
          buffer = buffer.slice(opening[0].length);
          continue;
        }
        const orphanClosing = buffer.match(CLOSE_THINKING_TAG_RE);
        if (orphanClosing) {
          buffer = buffer.slice(orphanClosing[0].length);
          continue;
        }
        if (!final && possibleTagPrefix(buffer, true)) break;
        if (!final && possibleTagPrefix(buffer, false)) break;
        if (!final && possibleExactPrefix(buffer, customOpeningTags)) break;
        parts.push({ type: "content", text: buffer[0]! });
        buffer = buffer.slice(1);
        continue;
      }

      const tagIndex = buffer.indexOf("<");
      if (tagIndex < 0) {
        parts.push({ type: "thinking", text: buffer });
        buffer = "";
        break;
      }
      if (tagIndex > 0) {
        parts.push({ type: "thinking", text: buffer.slice(0, tagIndex) });
        buffer = buffer.slice(tagIndex);
        continue;
      }

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

      const closingTag = buffer.match(CLOSE_THINKING_TAG_RE);
      if (closingTag) {
        inThinking = false;
        buffer = buffer.slice(closingTag[0].length);
        continue;
      }
      if (!final && possibleTagPrefix(buffer, true)) break;
      parts.push({ type: "thinking", text: buffer[0]! });
      buffer = buffer.slice(1);
    }

    if (final && buffer.length > 0) {
      parts.push({ type: inThinking ? "thinking" : "content", text: buffer });
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
