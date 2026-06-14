import type { Message } from "../../../../engine/contracts/types/chat";
import type { PartyDialogueLine } from "../../../../engine/contracts/types/game";
import {
  DIALOGUE_QUOTE_CAPTURE_GROUP_PATTERN_SOURCE,
  stripSurroundingDialogueQuotes,
} from "../../../../shared/lib/dialogue-quotes";
import { findNamedMapValue } from "./game-character-name-match";
import { stripGmTagsKeepReadables } from "./game-tag-parser";

export type NarrationMessage = Pick<Message, "id" | "chatId" | "role" | "content" | "characterId" | "extra"> & {
  characterName?: string;
};

export interface NarrationSegment {
  id: string;
  type: "narration" | "dialogue" | "readable" | "system";
  speaker?: string;
  sprite?: string;
  content: string;
  color?: string;
  sourceMessageId?: string | null;
  sourceSegmentIndex?: number | null;
  sourceRole?: Message["role"] | null;
  partyType?: "main" | "side" | "extra" | "action" | "thought" | "whisper";
  whisperTarget?: string;
  readableType?: "note" | "book";
  readableContent?: string;
}

export type GameSideLine = PartyDialogueLine & {
  voiceSourceMessageId?: string | null;
  voiceSourceSegmentIndex?: number | null;
  voiceSourceRole?: Message["role"] | null;
};

const APPROX_MESSAGE_TOKEN_OVERHEAD = 4;

export function narrationSegmentAnchorKey(segment: NarrationSegment): string {
  if (segment.sourceMessageId && segment.sourceSegmentIndex != null) {
    return `${segment.sourceMessageId}:${segment.sourceSegmentIndex}`;
  }
  if (segment.sourceMessageId) return `${segment.sourceMessageId}:${segment.id}`;
  return segment.id;
}

function estimateTextTokenCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const wordEstimate = trimmed.split(/\s+/).filter(Boolean).length * 1.3;
  const charEstimate = trimmed.length / 4;
  return Math.ceil(Math.max(wordEstimate, charEstimate));
}

function estimateMessageTokenCount(message: NarrationMessage): number {
  const stored = message.extra?.tokenCount;
  if (typeof stored === "number" && Number.isFinite(stored) && stored > 0) return stored;
  const textTokens = estimateTextTokenCount(message.content);
  return textTokens > 0 ? textTokens + APPROX_MESSAGE_TOKEN_OVERHEAD : 0;
}

export function estimateSessionHistoryTokens(messages: NarrationMessage[]): number {
  let startIndex = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.extra?.isConversationStart) {
      startIndex = i;
      break;
    }
  }
  return messages.slice(startIndex).reduce((total, message) => total + estimateMessageTokenCount(message), 0);
}

export function formatTokenEstimate(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}m`;
  if (tokens >= 10_000) return `${Math.round(tokens / 1_000)}k`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return tokens.toLocaleString();
}

const EFFECT_TAG_RE = /\{(shake|shout|whisper|glow|pulse|wave|flicker|drip|bounce|tremble|glitch|expand):([^}]+)\}/gi;
const INLINE_DIALOGUE_VERBS_PATTERN =
  "said|says|whispered|whispers|muttered|mutters|replied|replies|called|calls|shouted|shouts|asked|asks|warned|warns|growled|growls|hissed|hisses|exclaimed|exclaims|murmured|murmurs|sighed|sighs|snapped|snaps|barked|barks|declared|declares|continued|continues|added|adds|spoke|speaks|began|begins|remarked|remarks|chuckled|chuckles|laughed|laughs|cried|cries";

export function effectDisplayLength(content: string): number {
  return content.replace(EFFECT_TAG_RE, "$2").length;
}

export function slicePreservingEffects(content: string, maxVisible: number): string {
  const re = new RegExp(EFFECT_TAG_RE.source, "gi");
  let result = "";
  let visible = 0;
  let lastIdx = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(content)) !== null) {
    const plain = content.slice(lastIdx, m.index);
    const room = maxVisible - visible;
    if (room <= 0) break;

    if (plain.length <= room) {
      result += plain;
      visible += plain.length;
    } else {
      result += plain.slice(0, room);
      return result;
    }

    const inner = m[2] ?? "";
    const room2 = maxVisible - visible;
    if (room2 <= 0) break;

    if (inner.length <= room2) {
      result += m[0];
      visible += inner.length;
    } else {
      result += `{${m[1]}:${inner.slice(0, room2)}}`;
      return result;
    }

    lastIdx = m.index + m[0].length;
  }

  const tail = content.slice(lastIdx);
  const room = maxVisible - visible;
  if (room > 0) {
    result += tail.slice(0, room);
  }

  return result;
}

function humanizeName(name: string): string {
  if (name.includes(" ") || name.includes("_")) return name;
  return name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
}

function normalizeInlineVnDialogueLines(source: string): string {
  return source
    .replace(
      /([^\n])\s+(\[[^\]]+\]\s*\[(?:main|side|extra|action|thought|whisper(?::[^\]]+)?)\]\s*(?:\[[^\]]+\])?\s*:)/gi,
      "$1\n$2",
    )
    .replace(
      /(\[[^\]]+\]\s*\[(?:main|side|extra|whisper(?::[^\]]+)?)\]\s*(?:\[[^\]]+\])?\s*:\s*(?:"[^"]*"|“[^”]*”|«[^»]*»))\s+(?=\S)/gi,
      "$1\n",
    );
}

function createInlineDialogueRegex(): RegExp {
  return new RegExp(
    `(?:^|(?<=\\s))(?:${DIALOGUE_QUOTE_CAPTURE_GROUP_PATTERN_SOURCE}|'([^']+)')[,.]?\\s+([A-Z][a-z]+(?:\\s[A-Z][a-z]+)?)\\s+(?:${INLINE_DIALOGUE_VERBS_PATTERN})\\b[.!?]?`,
    "gi",
  );
}

function getInlineDialogueSpeaker(match: RegExpExecArray): string | undefined {
  return match[8]?.trim();
}

type TruncationLine = {
  text: string;
  originalStart: number;
  originalEnd: number;
};

function findReadableBlockEnd(source: string, start: number): number {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "[") depth++;
    else if (source[i] === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTextIntoBoundedLines(text: string, originalStart: number): TruncationLine[] {
  const lines: TruncationLine[] = [];
  let lineStart = 0;

  for (let i = 0; i <= text.length; i++) {
    if (i < text.length && text[i] !== "\n") continue;
    const rawLine = text.slice(lineStart, i);
    const lineText = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    lines.push({
      text: lineText,
      originalStart: originalStart + lineStart,
      originalEnd: originalStart + lineStart + lineText.length,
    });
    lineStart = i + 1;
  }

  return lines;
}

function splitInlineVnDialogueLineMetadata(line: TruncationLine): TruncationLine[] {
  const headerRe = /\[[^\]]+\]\s*\[(?:main|side|extra|action|thought|whisper(?::[^\]]+)?)\]\s*(?:\[[^\]]+\])?\s*:/gi;
  const pieces: TruncationLine[] = [];
  let chunkStart = 0;
  let match: RegExpExecArray | null;

  while ((match = headerRe.exec(line.text))) {
    if (match.index > chunkStart && /\s/.test(line.text[match.index - 1] ?? "")) {
      pieces.push({
        text: line.text.slice(chunkStart, match.index),
        originalStart: line.originalStart + chunkStart,
        originalEnd: line.originalStart + match.index,
      });
      chunkStart = match.index;
    }
  }
  pieces.push({
    text: line.text.slice(chunkStart),
    originalStart: line.originalStart + chunkStart,
    originalEnd: line.originalEnd,
  });

  return pieces.flatMap((piece) => {
    const splitRe =
      /^(\s*\[[^\]]+\]\s*\[(?:main|side|extra|whisper(?::[^\]]+)?)\]\s*(?:\[[^\]]+\])?\s*:\s*(?:"[^"]*"|“[^”]*”|«[^»]*»))\s+(?=\S)/i;
    const split = splitRe.exec(piece.text);
    if (!split || split[1]!.length >= piece.text.length) return [piece];

    const splitAt = split[1]!.length;
    return [
      {
        text: piece.text.slice(0, splitAt),
        originalStart: piece.originalStart,
        originalEnd: piece.originalStart + splitAt,
      },
      {
        text: piece.text.slice(splitAt).trimStart(),
        originalStart: piece.originalStart + splitAt + (piece.text.slice(splitAt).match(/^\s*/)?.[0].length ?? 0),
        originalEnd: piece.originalEnd,
      },
    ];
  });
}

function buildTruncationLines(rawContent: string): TruncationLine[] {
  const chunks: TruncationLine[] = [];
  const readableTagRe = /\[(?:Note|Book):/gi;
  let cursor = 0;
  let placeholderIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = readableTagRe.exec(rawContent))) {
    const start = match.index;
    const end = findReadableBlockEnd(rawContent, start);
    if (end < 0) continue;

    if (start > cursor) {
      chunks.push(...splitTextIntoBoundedLines(rawContent.slice(cursor, start), cursor));
    }
    chunks.push({
      text: `__READABLE_${placeholderIndex}__`,
      originalStart: start,
      originalEnd: end + 1,
    });
    placeholderIndex += 1;
    cursor = end + 1;
    readableTagRe.lastIndex = cursor;
  }

  if (cursor < rawContent.length) {
    chunks.push(...splitTextIntoBoundedLines(rawContent.slice(cursor), cursor));
  }

  return chunks.flatMap((chunk) => {
    if (/^__READABLE_\d+__$/.test(chunk.text)) return [chunk];
    return splitInlineVnDialogueLineMetadata(chunk).map((line) => ({
      ...line,
      text: stripGmTagsKeepReadables(line.text),
    }));
  });
}

export function parseNarrationSegments(
  message: NarrationMessage,
  speakerColors: Map<string, string>,
): NarrationSegment[] {
  const withReadables = stripGmTagsKeepReadables(message.content || "");
  const readableContents: Array<{ type: "note" | "book"; content: string }> = [];
  let source = withReadables;
  for (const tag of ["[Note:", "[Book:"] as const) {
    const rType = tag === "[Note:" ? "note" : "book";
    let searchFrom = 0;
    while (true) {
      const idx = source.toLowerCase().indexOf(tag.toLowerCase(), searchFrom);
      if (idx === -1) break;
      let depth = 0;
      let end = -1;
      for (let i = idx; i < source.length; i++) {
        if (source[i] === "[") depth++;
        else if (source[i] === "]") {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      if (end === -1) {
        searchFrom = idx + 1;
        continue;
      }
      const inner = source.slice(idx + tag.length, end).trim();
      const placeholderIdx = readableContents.length;
      readableContents.push({ type: rType, content: inner });
      const placeholder = `__READABLE_${placeholderIdx}__`;
      source = source.slice(0, idx) + placeholder + source.slice(end + 1);
      searchFrom = idx + placeholder.length;
    }
  }

  const lines = normalizeInlineVnDialogueLines(source).split(/\r?\n/);
  const parsed: NarrationSegment[] = [];
  const readablePlaceholderRe = /^__READABLE_(\d+)__$/;
  const compactDialogueRegex = /^\s*\[([^\]]+)\]\s*(?:\[([^\]]+)\])?\s*:\s*(.+)$/;
  const legacyDialogueRegex = /^\s*Dialogue\s*\[([^\]]+)\]\s*(?:\[([^\]]+)\])?\s*:\s*(.+)$/i;
  const narrationPrefixRegex = /^\s*Narration\s*:\s*(.+)$/i;
  const partyLineRegex =
    /^\s*\[([^\]]+)\]\s*\[(main|side|extra|action|thought|whisper(?::([^\]]+))?)\]\s*(?:\[([^\]]+)\])?\s*:\s*(.+)$/i;

  let fallbackText = "";
  const flushFallback = () => {
    if (!fallbackText.trim()) return;
    parsed.push({
      id: `${message.id}-fallback-${parsed.length}`,
      type: "narration",
      content: fallbackText.trim(),
    });
    fallbackText = "";
  };
  const appendFallbackPiece = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const narrationMatch = trimmed.match(narrationPrefixRegex);
    const content = (narrationMatch?.[1] ?? trimmed).trim();
    if (!content) return;
    fallbackText += `${fallbackText ? "\n" : ""}${content}`;
  };
  const pushReadable = (readableIndex: number) => {
    const readable = readableContents[readableIndex];
    if (!readable) return;
    parsed.push({
      id: `${message.id}-readable-${parsed.length}`,
      type: "readable",
      content: readable.type === "book" ? "You find a book..." : "You find a note...",
      readableType: readable.type,
      readableContent: readable.content,
    });
  };
  const pushContentPieces = (
    content: string,
    buildSegment: (content: string) => NarrationSegment,
  ): boolean => {
    const readablePlaceholderGlobalRe = /__READABLE_(\d+)__/g;
    let cursor = 0;
    let emitted = false;
    let piece: RegExpExecArray | null;

    while ((piece = readablePlaceholderGlobalRe.exec(content))) {
      const before = content.slice(cursor, piece.index).trim();
      if (before) {
        parsed.push(buildSegment(before));
        emitted = true;
      }
      pushReadable(Number.parseInt(piece[1]!, 10));
      emitted = true;
      cursor = piece.index + piece[0].length;
    }

    const after = content.slice(cursor).trim();
    if (after) {
      parsed.push(buildSegment(after));
      emitted = true;
    }

    return emitted;
  };
  const pushPartyMatch = (partyMatch: RegExpMatchArray) => {
    flushFallback();
    const character = humanizeName(partyMatch[1]!.trim());
    let rawType = partyMatch[2]!.toLowerCase().replace(/:.*$/, "") as NarrationSegment["partyType"];
    const whisperTarget = partyMatch[3]?.trim() ? humanizeName(partyMatch[3].trim()) : undefined;
    const expression = partyMatch[4]?.trim() || undefined;
    let content = partyMatch[5]!.trim();

    if (rawType === "extra") rawType = "side";
    if ((rawType === "main" || rawType === "side" || rawType === "whisper") && content.length >= 2) {
      content = stripSurroundingDialogueQuotes(content);
    }

    const color = findNamedMapValue(speakerColors, character);
    if (rawType === "action") {
      pushContentPieces(content, (pieceContent) => ({
        id: `${message.id}-party-action-${character}-${parsed.length}`,
        type: "narration",
        content: pieceContent,
      }));
      return;
    }
    const isSpoken = rawType === "main" || rawType === "whisper" || rawType === "thought" || rawType === "side";
    pushContentPieces(content, (pieceContent) => ({
      id: `${message.id}-party-${rawType}-${character}-${parsed.length}`,
      type: isSpoken ? "dialogue" : "narration",
      speaker: character,
      sprite: expression,
      content: pieceContent,
      color,
      partyType: rawType,
      whisperTarget,
    }));
  };
  const pushDialogueMatch = (dialogueMatch: RegExpMatchArray) => {
    flushFallback();
    const speaker = humanizeName(dialogueMatch[1]!.trim());
    let content = dialogueMatch[3]!.trim();
    content = stripSurroundingDialogueQuotes(content);
    pushContentPieces(content, (pieceContent) => ({
      id: `${message.id}-d-${parsed.length}`,
      type: "dialogue",
      speaker,
      sprite: dialogueMatch[2]?.trim() || undefined,
      content: pieceContent,
      color: findNamedMapValue(speakerColors, speaker),
    }));
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushFallback();
      continue;
    }

    const partyMatch = line.match(partyLineRegex);
    if (partyMatch) {
      pushPartyMatch(partyMatch);
      continue;
    }

    const dialogueMatch = line.match(legacyDialogueRegex) || line.match(compactDialogueRegex);
    if (dialogueMatch) {
      pushDialogueMatch(dialogueMatch);
      continue;
    }

    let consumedReadablePlaceholder = false;
    const readablePlaceholderGlobalRe = /__READABLE_(\d+)__/g;
    let readableCursor = 0;
    let readablePiece: RegExpExecArray | null;
    while ((readablePiece = readablePlaceholderGlobalRe.exec(line))) {
      consumedReadablePlaceholder = true;
      appendFallbackPiece(line.slice(readableCursor, readablePiece.index));
      flushFallback();
      pushReadable(Number.parseInt(readablePiece[1]!, 10));
      readableCursor = readablePiece.index + readablePiece[0].length;
    }
    if (consumedReadablePlaceholder) {
      appendFallbackPiece(line.slice(readableCursor));
      continue;
    }

    const readableMatch = line.match(readablePlaceholderRe);
    if (readableMatch) {
      flushFallback();
      const rIdx = Number.parseInt(readableMatch[1]!, 10);
      pushReadable(rIdx);
      continue;
    }

    const narrationMatch = line.match(narrationPrefixRegex);
    if (narrationMatch) {
      flushFallback();
      parsed.push({
        id: `${message.id}-n-${parsed.length}`,
        type: "narration",
        content: narrationMatch[1]!.trim(),
      });
      continue;
    }

    appendFallbackPiece(line);
  }

  flushFallback();

  if (parsed.length > 0) {
    const expanded = splitInlineDialogue(parsed, message.id, speakerColors);
    if (expanded.some((s) => s.type === "dialogue")) {
      return stampNarrationSegmentSources(expanded, message);
    }
  }

  return stampNarrationSegmentSources(parsed, message);
}

export function truncateMessageContentAtSegment(rawContent: string, segmentIndexInclusive: number): string {
  if (segmentIndexInclusive < 0) return "";

  const lines = buildTruncationLines(rawContent || "");
  const readablePlaceholderRe = /^__READABLE_(\d+)__$/;
  const compactDialogueRegex = /^\s*\[([^\]]+)\]\s*(?:\[([^\]]+)\])?\s*:\s*(.+)$/;
  const legacyDialogueRegex = /^\s*Dialogue\s*\[([^\]]+)\]\s*(?:\[([^\]]+)\])?\s*:\s*(.+)$/i;
  const narrationPrefixRegex = /^\s*Narration\s*:\s*(.+)$/i;
  const partyLineRegex =
    /^\s*\[([^\]]+)\]\s*\[(main|side|extra|action|thought|whisper(?::([^\]]+))?)\]\s*(?:\[([^\]]+)\])?\s*:\s*(.+)$/i;

  const target = segmentIndexInclusive + 1;
  let segmentCount = 0;
  let pendingFallbackEnd: number | null = null;
  let lastIncludedEnd: number | null = null;

  const includeSegmentThrough = (endOffset: number): boolean => {
    segmentCount++;
    lastIncludedEnd = endOffset;
    return segmentCount >= target;
  };

  const flushPendingFallback = (): boolean => {
    if (pendingFallbackEnd == null) return false;
    const reachedTarget = includeSegmentThrough(pendingFallbackEnd);
    pendingFallbackEnd = null;
    return reachedTarget;
  };

  lineLoop: for (let i = 0; i < lines.length; i++) {
    if (segmentCount >= target) break;
    const rawLine = lines[i]!;
    const line = rawLine.text.trim();

    if (!line) {
      if (flushPendingFallback()) break;
      continue;
    }

    const isSpecial =
      readablePlaceholderRe.test(line) ||
      partyLineRegex.test(line) ||
      narrationPrefixRegex.test(line) ||
      legacyDialogueRegex.test(line) ||
      compactDialogueRegex.test(line);

    if (isSpecial) {
      if (flushPendingFallback()) break;
      if (includeSegmentThrough(rawLine.originalEnd)) break;
    } else {
      const inlineBounds = getInlineDialogueTruncationBounds(rawLine);
      if (inlineBounds.length > 0) {
        if (flushPendingFallback()) break;
        for (const endOffset of inlineBounds) {
          if (includeSegmentThrough(endOffset)) break lineLoop;
        }
      } else {
        pendingFallbackEnd = rawLine.originalEnd;
      }
    }
  }
  if (segmentCount < target) {
    flushPendingFallback();
  }

  if (lastIncludedEnd == null) {
    if (pendingFallbackEnd != null) {
      return normalizePartialQuotedDialogueTruncation(rawContent.slice(0, pendingFallbackEnd));
    }
    return rawContent;
  }
  return normalizePartialQuotedDialogueTruncation(rawContent.slice(0, lastIncludedEnd));
}

function normalizePartialQuotedDialogueTruncation(content: string): string {
  const lastNewlineIndex = Math.max(content.lastIndexOf("\n"), content.lastIndexOf("\r"));
  const lineStart = lastNewlineIndex + 1;
  const prefix = content.slice(0, lineStart);
  const line = content.slice(lineStart);
  const quotedDialoguePrefixRe =
    /^(\s*(?:Dialogue\s*)?\[[^\]]+\](?:\s*\[[^\]]+\]){0,2}\s*:\s*)(["“«])(.*)$/i;
  const match = line.match(quotedDialoguePrefixRe);
  if (!match) return content;

  const openingQuote = match[2]!;
  const closingQuote = openingQuote === "“" ? "”" : openingQuote === "«" ? "»" : openingQuote;
  const body = match[3]!;
  if (body.includes(closingQuote)) return content;

  return `${prefix}${match[1]}${openingQuote}${body.trimEnd()}${closingQuote}`;
}

function trimTrailingWhitespaceOffset(line: TruncationLine, relativeEnd: number): number {
  let end = relativeEnd;
  while (end > 0 && /\s/.test(line.text[end - 1] ?? "")) end -= 1;
  return line.originalStart + end;
}

function getInlineDialogueTruncationBounds(line: TruncationLine): number[] {
  const bounds: number[] = [];
  const inlineDialogueRe = createInlineDialogueRegex();
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = inlineDialogueRe.exec(line.text)) !== null) {
    const before = line.text.slice(lastIndex, match.index).trim();
    if (before) bounds.push(trimTrailingWhitespaceOffset(line, match.index));
    bounds.push(line.originalStart + match.index + match[0].length);
    lastIndex = match.index + match[0].length;
  }

  if (bounds.length > 0 && line.text.slice(lastIndex).trim()) {
    bounds.push(line.originalEnd);
  }

  return bounds;
}

function splitInlineDialogue(
  segments: NarrationSegment[],
  msgId: string,
  speakerColors: Map<string, string>,
): NarrationSegment[] {
  const result: NarrationSegment[] = [];
  const inlineDialogueRe = createInlineDialogueRegex();

  for (const seg of segments) {
    if (seg.type !== "narration") {
      result.push(seg);
      continue;
    }

    const text = seg.content;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let didSplit = false;
    inlineDialogueRe.lastIndex = 0;

    while ((match = inlineDialogueRe.exec(text)) !== null) {
      didSplit = true;
      const before = text.slice(lastIndex, match.index).trim();
      if (before) {
        result.push({
          id: `${msgId}-fallback-split-${result.length}`,
          type: "narration",
          content: before,
        });
      }

      const speaker = getInlineDialogueSpeaker(match);
      if (!speaker) {
        lastIndex = match.index + match[0].length;
        continue;
      }
      result.push({
        id: `${msgId}-inline-d-${result.length}`,
        type: "dialogue",
        speaker,
        content: match[0].trim(),
        color: findNamedMapValue(speakerColors, speaker),
      });
      lastIndex = match.index + match[0].length;
    }

    if (didSplit) {
      const after = text.slice(lastIndex).trim();
      if (after) {
        result.push({
          id: `${msgId}-fallback-split-${result.length}`,
          type: "narration",
          content: after,
        });
      }
    } else {
      result.push(seg);
    }
  }

  return result;
}

function stampNarrationSegmentSources(
  segments: NarrationSegment[],
  message: NarrationMessage,
): NarrationSegment[] {
  return segments.map((segment, index) => ({
    ...segment,
    sourceMessageId: message.id,
    sourceSegmentIndex: index,
    sourceRole: message.role,
  }));
}
