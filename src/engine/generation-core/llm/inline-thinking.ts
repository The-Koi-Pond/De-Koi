const THINKING_TAG_NAMES = ["thinking", "thoughts", "thought", "reasoning", "reason", "think"] as const;
const THINKING_TAG_PATTERN = THINKING_TAG_NAMES.join("|");
const XML_THINKING_BLOCK_RE = new RegExp(`^(\\s*)<(${THINKING_TAG_PATTERN})>([\\s\\S]*?)<\\/\\2>`, "i");
const PIPE_THINKING_BLOCK_RE = /^(\s*)<\|think\|>([\s\S]*?)<\|\/think\|>/i;
const CHANNEL_THINKING_BLOCK_RE = /^(\s*)<\|channel>thought\b([\s\S]*?)<channel\|>/i;
const OPEN_THINKING_TAG_RE = new RegExp(`^<\\s*(${THINKING_TAG_PATTERN})\\b[^>]*>`, "i");
const CLOSE_THINKING_TAG_RE = new RegExp(`^<\\s*\\/\\s*(${THINKING_TAG_PATTERN})\\s*>`, "i");

export type InlineThinkingPart = { type: "content" | "thinking"; text: string };

export interface LeadingThinkingExtraction {
  content: string;
  thinking: string;
  stripped: boolean;
}

/**
 * Extract leading inline reasoning blocks that some models emit instead of
 * returning provider-native thinking channels.
 */
export function extractLeadingThinkingBlocks(text: string): LeadingThinkingExtraction {
  let remaining = text;
  let stripped = false;
  const chunks: string[] = [];

  while (true) {
    const xmlMatch = remaining.match(XML_THINKING_BLOCK_RE);
    if (xmlMatch) {
      stripped = true;
      const thinking = xmlMatch[3]?.trim();
      if (thinking) chunks.push(thinking);
      remaining = remaining.slice(xmlMatch[0].length).trimStart();
      continue;
    }

    const pipeMatch = remaining.match(PIPE_THINKING_BLOCK_RE);
    if (pipeMatch) {
      stripped = true;
      const thinking = pipeMatch[2]?.trim();
      if (thinking) chunks.push(thinking);
      remaining = remaining.slice(pipeMatch[0].length).trimStart();
      continue;
    }

    const channelMatch = remaining.match(CHANNEL_THINKING_BLOCK_RE);
    if (channelMatch) {
      stripped = true;
      const thinking = channelMatch[2]?.trim();
      if (thinking) chunks.push(thinking);
      remaining = remaining.slice(channelMatch[0].length).trimStart();
      continue;
    }

    break;
  }

  return {
    content: remaining,
    thinking: chunks.join("\n\n"),
    stripped,
  };
}

function possibleTagPrefix(buffer: string, closing: boolean): boolean {
  if (!buffer.startsWith("<") || buffer.includes(">")) return false;
  const body = buffer
    .slice(1)
    .replace(/^\s+/, "")
    .toLowerCase();
  const normalized = closing ? body.replace(/^\/\s*/, "") : body;
  if (closing && !body.startsWith("/") && !"/".startsWith(body)) return false;
  if (!/^[\w-]*$/.test(normalized)) return false;
  return THINKING_TAG_NAMES.some((tag) => tag.startsWith(normalized));
}

export function createInlineThinkingStreamParser() {
  let buffer = "";
  let inThinking = false;

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

        const opening = buffer.match(OPEN_THINKING_TAG_RE);
        if (opening) {
          inThinking = true;
          buffer = buffer.slice(opening[0].length);
          continue;
        }
        if (!final && possibleTagPrefix(buffer, false)) break;
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
