import type { DialogueAttributionsExtra } from "../../../../../engine/contracts/types/chat";
import { validateDialogueAttributionsForText } from "../../../../../engine/shared/text/dialogue-attribution";

export type SpeakerDialogueColorSegment = {
  text: string;
  color?: string;
};

const SPEAKER_TAG_RE = /<speaker(?:="([^"]*)")?>([\s\S]*?)<\/speaker>/g;
const SPEAKER_TAG_STRIP_RE = /<\/?speaker(?:="[^"]*")?>/g;

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

export function splitSpeakerDialogueColorSegments(
  text: string,
  defaultDialogueColor: string | undefined,
  speakerColorMap: Map<string, string> | undefined,
  attributions?: DialogueAttributionsExtra | null,
): SpeakerDialogueColorSegment[] {
  const validAttributions = validateDialogueAttributionsForText(text, attributions);
  if (!validAttributions) {
    return [{ text, color: defaultDialogueColor }];
  }

  const segments: SpeakerDialogueColorSegment[] = [];
  let cursor = 0;

  for (const attribution of validAttributions.segments) {
    if (attribution.start < cursor) {
      continue;
    }
    pushSegment(segments, text.slice(cursor, attribution.start), defaultDialogueColor);
    pushSegment(
      segments,
      text.slice(attribution.start, attribution.end),
      findSpeakerColor(speakerColorMap, attribution.speakerName) ?? defaultDialogueColor,
    );
    cursor = attribution.end;
  }

  pushSegment(segments, text.slice(cursor), defaultDialogueColor);
  return segments.length > 0 ? segments : [{ text, color: defaultDialogueColor }];
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
