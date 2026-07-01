import { DIALOGUE_QUOTE_PATTERN_SOURCE } from "../../../../../shared/lib/dialogue-quotes";

export type SpeakerDialogueColorSegment = {
  text: string;
  color?: string;
};

const SPEAKER_TAG_RE = /<speaker(?:="([^"]*)")?>([\s\S]*?)<\/speaker>/g;
const SPEAKER_TAG_STRIP_RE = /<\/?speaker(?:="[^"]*")?>/g;
const NAME_BOUNDARY_RE = /[\p{L}\p{N}_-]/u;

function normalizeSpeakerColorKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function createSpeakerColorLookup(entries: Iterable<[string | null | undefined, string | null | undefined]>) {
  const lookup = new Map<string, string>();
  for (const [name, color] of entries) {
    const key = typeof name === "string" ? normalizeSpeakerColorKey(name) : "";
    const value = typeof color === "string" ? color.trim() : "";
    if (key && value) lookup.set(key, value);
  }
  return lookup;
}

function findSpeakerColor(speakerColorMap: Map<string, string> | undefined, speakerName: string | undefined) {
  const key = speakerName ? normalizeSpeakerColorKey(speakerName) : "";
  return key ? speakerColorMap?.get(key) : undefined;
}

function pushSegment(segments: SpeakerDialogueColorSegment[], text: string, color: string | undefined) {
  if (!text) return;
  const last = segments[segments.length - 1];
  if (last && last.color === color) {
    last.text += text;
    return;
  }
  segments.push({ text, color });
}

function splitSpeakerTags(
  text: string,
  defaultDialogueColor: string | undefined,
  speakerColorMap: Map<string, string> | undefined,
): SpeakerDialogueColorSegment[] | null {
  const regex = new RegExp(SPEAKER_TAG_RE.source, "g");
  const segments: SpeakerDialogueColorSegment[] = [];
  let found = false;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    found = true;
    pushSegment(segments, text.slice(lastIndex, match.index), defaultDialogueColor);
    const speakerName = typeof match[1] === "string" ? match[1].trim() : "";
    const color = findSpeakerColor(speakerColorMap, speakerName) ?? defaultDialogueColor;
    pushSegment(segments, match[2] ?? "", color);
    lastIndex = match.index + match[0].length;
  }

  if (!found) return null;
  pushSegment(segments, text.slice(lastIndex), defaultDialogueColor);
  return segments;
}

function matchNamePrefix(
  line: string,
  speakerColorMap: Map<string, string> | undefined,
): { prefixEnd: number; color: string } | null {
  if (!speakerColorMap?.size) return null;
  const leading = line.match(/^\s*/)?.[0].length ?? 0;
  const colonIndex = line.indexOf(":", leading);
  if (colonIndex <= leading || colonIndex - leading > 80) return null;

  const speakerName = line.slice(leading, colonIndex);
  const color = findSpeakerColor(speakerColorMap, speakerName);
  if (!color) return null;

  let prefixEnd = colonIndex + 1;
  while (line[prefixEnd] === " " || line[prefixEnd] === "\t") prefixEnd++;
  return { prefixEnd, color };
}

function splitNamePrefixedLines(
  text: string,
  defaultDialogueColor: string | undefined,
  speakerColorMap: Map<string, string> | undefined,
): SpeakerDialogueColorSegment[] | null {
  const lines = text.match(/[^\n]*(?:\n|$)/g)?.filter((line) => line.length > 0) ?? [];
  const segments: SpeakerDialogueColorSegment[] = [];
  let found = false;
  let currentColor: string | undefined;

  for (const line of lines) {
    const body = line.endsWith("\n") ? line.slice(0, -1) : line;
    const newline = line.endsWith("\n") ? "\n" : "";
    const prefix = matchNamePrefix(body, speakerColorMap);
    if (prefix) {
      found = true;
      currentColor = prefix.color;
      pushSegment(segments, body.slice(0, prefix.prefixEnd), defaultDialogueColor);
      pushSegment(segments, body.slice(prefix.prefixEnd) + newline, currentColor);
      continue;
    }
    pushSegment(segments, line, currentColor ?? defaultDialogueColor);
  }

  return found ? segments : null;
}

function hasNameBoundary(value: string, start: number, end: number) {
  const before = start > 0 ? value[start - 1] : "";
  const after = end < value.length ? value[end] : "";
  return !NAME_BOUNDARY_RE.test(before) && !NAME_BOUNDARY_RE.test(after);
}

function findLastSpeakerColorInContext(context: string, speakerColorMap: Map<string, string> | undefined) {
  if (!speakerColorMap?.size) return undefined;
  const lower = context.toLowerCase();
  let best: { index: number; color: string } | null = null;

  for (const [speakerName, color] of speakerColorMap) {
    let fromIndex = 0;
    while (fromIndex < lower.length) {
      const index = lower.indexOf(speakerName, fromIndex);
      if (index === -1) break;
      const end = index + speakerName.length;
      if (hasNameBoundary(lower, index, end) && (!best || index > best.index)) {
        best = { index, color };
      }
      fromIndex = end;
    }
  }

  return best?.color;
}

function splitAttributedQuotes(
  text: string,
  defaultDialogueColor: string | undefined,
  speakerColorMap: Map<string, string> | undefined,
): SpeakerDialogueColorSegment[] | null {
  const quoteRe = new RegExp(DIALOGUE_QUOTE_PATTERN_SOURCE, "g");
  const segments: SpeakerDialogueColorSegment[] = [];
  let found = false;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = quoteRe.exec(text)) !== null) {
    const context = text.slice(lastIndex, match.index);
    const color = findLastSpeakerColorInContext(context, speakerColorMap);
    if (!color) continue;
    found = true;
    pushSegment(segments, context, defaultDialogueColor);
    pushSegment(segments, match[0], color);
    lastIndex = match.index + match[0].length;
  }

  if (!found) return null;
  pushSegment(segments, text.slice(lastIndex), defaultDialogueColor);
  return segments;
}

export function splitSpeakerDialogueColorSegments(
  text: string,
  defaultDialogueColor: string | undefined,
  speakerColorMap: Map<string, string> | undefined,
): SpeakerDialogueColorSegment[] {
  return (
    splitSpeakerTags(text, defaultDialogueColor, speakerColorMap) ??
    splitNamePrefixedLines(text, defaultDialogueColor, speakerColorMap) ??
    splitAttributedQuotes(text, defaultDialogueColor, speakerColorMap) ?? [{ text, color: defaultDialogueColor }]
  );
}

export function stripSpeakerTags(text: string) {
  return text.replace(SPEAKER_TAG_STRIP_RE, "");
}

export function replaceSpeakerTagsWithColorSpans(text: string, speakerColorMap: Map<string, string> | undefined) {
  const regex = new RegExp(SPEAKER_TAG_RE.source, "g");
  return text.replace(regex, (_match, name: string | undefined, dialogue: string) => {
    const color = findSpeakerColor(speakerColorMap, name?.trim());
    return color ? `<span data-spk="${color}">${dialogue}</span>` : dialogue;
  });
}
