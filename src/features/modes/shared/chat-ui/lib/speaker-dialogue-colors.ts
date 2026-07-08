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

function speakerNameColorKey(name: string): string {
  return `name:${normalizeSpeakerColorKey(name)}`;
}

function speakerIdColorKey(id: string): string {
  return `id:${id.trim()}`;
}

export type SpeakerColorIdentity = {
  id?: string | null | undefined;
  names: Array<string | null | undefined>;
  color?: string | null | undefined;
};

export type SpeakerColorEntry = [string | null | undefined, string | null | undefined] | SpeakerColorIdentity;
export type SpeakerColorLookup = Map<string, string>;

function isSpeakerColorIdentity(entry: SpeakerColorEntry): entry is SpeakerColorIdentity {
  return !Array.isArray(entry);
}

export function createSpeakerColorLookup(entries: Iterable<SpeakerColorEntry>): SpeakerColorLookup {
  const lookup: SpeakerColorLookup = new Map();
  for (const entry of entries) {
    if (isSpeakerColorIdentity(entry)) {
      const color = typeof entry.color === "string" ? entry.color.trim() : "";
      if (!color) continue;
      const id = typeof entry.id === "string" ? entry.id.trim() : "";
      if (id) lookup.set(speakerIdColorKey(id), color);
      for (const rawName of entry.names) {
        const name = typeof rawName === "string" ? rawName.trim().replace(/\s+/g, " ") : "";
        if (name) lookup.set(speakerNameColorKey(name), color);
      }
      continue;
    }

    const [name, color] = entry;
    const key = typeof name === "string" && name.trim() ? speakerNameColorKey(name) : "";
    const value = typeof color === "string" ? color.trim() : "";
    if (key && value) lookup.set(key, value);
  }
  return lookup;
}

export function hasSpeakerColor(
  speakerColorMap: SpeakerColorLookup | undefined,
  speakerName: string | undefined,
  speakerId?: string | null,
): boolean {
  return !!findSpeakerColor(speakerColorMap, speakerName, speakerId);
}

function findSpeakerColor(
  speakerColorMap: SpeakerColorLookup | undefined,
  speakerName: string | undefined,
  speakerId?: string | null,
) {
  const id = typeof speakerId === "string" ? speakerId.trim() : "";
  if (id) {
    const color = speakerColorMap?.get(speakerIdColorKey(id));
    if (color) return color;
  }
  const key = speakerName ? speakerNameColorKey(speakerName) : "";
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
  speakerColorMap: SpeakerColorLookup | undefined,
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
      findSpeakerColor(speakerColorMap, attribution.speakerName, attribution.speakerId) ?? defaultDialogueColor,
    );
    cursor = attribution.end;
  }

  pushSegment(segments, text.slice(cursor), defaultDialogueColor);
  return segments.length > 0 ? segments : [{ text, color: defaultDialogueColor }];
}

export function stripSpeakerTags(text: string) {
  return text.replace(SPEAKER_TAG_STRIP_RE, "");
}

export function replaceSpeakerTagsWithColorSpans(text: string, speakerColorMap: SpeakerColorLookup | undefined) {
  const regex = new RegExp(SPEAKER_TAG_RE.source, "g");
  return text.replace(regex, (_match, name: string | undefined, dialogue: string) => {
    const color = findSpeakerColor(speakerColorMap, name?.trim());
    return color ? `<span data-spk="${color}">${dialogue}</span>` : dialogue;
  });
}
