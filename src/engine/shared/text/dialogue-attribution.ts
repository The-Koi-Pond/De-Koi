import type { DialogueAttributionSegment, DialogueAttributionsExtra } from "../../contracts/types/chat";

export interface DialogueAttributionSpeaker {
  id?: string | null;
  name: string;
  aliases?: string[];
}

export interface BuildDialogueAttributionsOptions {
  stripSpeakerTags?: boolean;
  includeDerivedProse?: boolean;
}

export interface BuildDialogueAttributionsResult {
  text: string;
  attributions: DialogueAttributionsExtra | null;
}

const SPEECH_VERBS =
  "said|says|asked|asks|replied|replies|whispered|whispers|muttered|mutters|called|calls|answered|answers|shouted|shouts";

export function createDialogueAttributionTextHash(text: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return `dk1:${text.length}:${hash.toString(16).padStart(8, "0")}`;
}

export function validateDialogueAttributionsForText(
  text: string,
  attributions: DialogueAttributionsExtra | null | undefined,
): DialogueAttributionsExtra | null {
  if (!attributions || attributions.version !== 1) {
    return null;
  }

  if (attributions.textHash !== createDialogueAttributionTextHash(text)) {
    return null;
  }

  const segments = normalizeSegments(text, attributions.segments);

  if (segments.length === 0) {
    return null;
  }

  return {
    version: 1,
    textHash: attributions.textHash,
    segments,
  };
}

export function buildDialogueAttributions(
  text: string,
  speakers: DialogueAttributionSpeaker[],
  options: BuildDialogueAttributionsOptions = {},
): BuildDialogueAttributionsResult {
  const lookup = createSpeakerLookup(speakers);
  const tagResult = collectSpeakerTagSegments(text, lookup, options.stripSpeakerTags === true);
  const namePrefixSegments = collectNamePrefixSegments(tagResult.text, lookup, tagResult.segments);
  const explicitSegments = [...tagResult.segments, ...namePrefixSegments];
  const proseSegments =
    options.includeDerivedProse === true ? collectExplicitProseSegments(tagResult.text, lookup, explicitSegments) : [];
  const normalized = normalizeSegments(tagResult.text, [...explicitSegments, ...proseSegments]);

  return {
    text: tagResult.text,
    attributions:
      normalized.length > 0
        ? {
            version: 1,
            textHash: createDialogueAttributionTextHash(tagResult.text),
            segments: normalized,
          }
        : null,
  };
}

interface SpeakerLookupEntry {
  id?: string | null;
  name: string;
  key: string;
}

interface SpeakerLookup {
  entries: SpeakerLookupEntry[];
  byName: Map<string, SpeakerLookupEntry>;
  byId: Map<string, SpeakerLookupEntry>;
  namePattern: string | null;
}

function createSpeakerLookup(speakers: DialogueAttributionSpeaker[]): SpeakerLookup {
  const byName = new Map<string, SpeakerLookupEntry>();
  const byId = new Map<string, SpeakerLookupEntry>();

  for (const speaker of speakers) {
    const name = speaker.name.trim();
    if (name.length === 0) {
      continue;
    }

    const entry = { id: speaker.id ?? null, name, key: normalizeSpeakerKey(name) };
    byName.set(entry.key, entry);

    if (entry.id) {
      byId.set(entry.id, entry);
    }

    for (const alias of speaker.aliases ?? []) {
      const aliasKey = normalizeSpeakerKey(alias);
      if (aliasKey.length > 0 && !byName.has(aliasKey)) {
        byName.set(aliasKey, entry);
      }
    }
  }

  const entries = [...new Set(byName.values())];
  const namePattern =
    entries.length > 0
      ? [...byName.keys()]
          .sort((left, right) => right.length - left.length)
          .map(escapeRegExp)
          .join("|")
      : null;

  return { entries, byName, byId, namePattern };
}

function collectSpeakerTagSegments(
  text: string,
  lookup: SpeakerLookup,
  stripTags: boolean,
): { text: string; segments: DialogueAttributionSegment[] } {
  const tagPattern = /<speaker\b([^>]*)>([\s\S]*?)<\/speaker>/gi;
  const segments: DialogueAttributionSegment[] = [];

  if (!tagPattern.test(text)) {
    return { text, segments };
  }

  tagPattern.lastIndex = 0;
  let cleaned = "";
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(text)) !== null) {
    const fullMatch = match[0];
    const attrs = parseTagAttributes(match[1] ?? "");
    const innerText = match[2] ?? "";
    const speaker = findSpeaker(lookup, attrs.name, attrs.characterId);

    if (stripTags) {
      cleaned += text.slice(cursor, match.index);
      const start = cleaned.length;
      cleaned += innerText;
      const end = cleaned.length;
      cursor = match.index + fullMatch.length;

      if (speaker) {
        segments.push(createSegment(start, end, speaker, "speaker-tag", "explicit"));
      }
      continue;
    }

    if (speaker) {
      const innerStart = match.index + fullMatch.indexOf(innerText);
      segments.push(createSegment(innerStart, innerStart + innerText.length, speaker, "speaker-tag", "explicit"));
    }
  }

  if (!stripTags) {
    return { text, segments };
  }

  cleaned += text.slice(cursor);
  return { text: cleaned, segments };
}

function collectNamePrefixSegments(
  text: string,
  lookup: SpeakerLookup,
  existingSegments: DialogueAttributionSegment[],
): DialogueAttributionSegment[] {
  if (!lookup.namePattern) {
    return [];
  }

  const pattern = new RegExp(`(^|\\n)([ \\t]*)(${lookup.namePattern}):[ \\t]*([^\\n]+)`, "gi");
  const segments: DialogueAttributionSegment[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const speaker = findSpeaker(lookup, match[3]);
    const content = match[4] ?? "";
    const start = match.index + match[0].length - content.length;
    const end = start + content.length;

    if (speaker && !overlapsAny(start, end, existingSegments)) {
      segments.push(createSegment(start, end, speaker, "name-prefix", "explicit"));
    }
  }

  return segments;
}

function collectExplicitProseSegments(
  text: string,
  lookup: SpeakerLookup,
  existingSegments: DialogueAttributionSegment[],
): DialogueAttributionSegment[] {
  if (lookup.entries.length === 0) {
    return [];
  }

  const quotePattern = /"[^"\n]+"/g;
  const segments: DialogueAttributionSegment[] = [];
  let match: RegExpExecArray | null;

  while ((match = quotePattern.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;

    if (overlapsAny(start, end, existingSegments)) {
      continue;
    }

    const speaker = findExplicitProseSpeaker(text, start, end, lookup);
    if (speaker) {
      segments.push(createSegment(start, end, speaker, "explicit-attribution", "derived"));
    }
  }

  return segments;
}

function findExplicitProseSpeaker(
  text: string,
  quoteStart: number,
  quoteEnd: number,
  lookup: SpeakerLookup,
): SpeakerLookupEntry | null {
  const before = text.slice(Math.max(0, quoteStart - 100), quoteStart);
  const after = text.slice(quoteEnd, Math.min(text.length, quoteEnd + 100));
  const matches = new Set<SpeakerLookupEntry>();

  for (const entry of lookup.entries) {
    const name = escapeRegExp(entry.name);
    const beforePattern = new RegExp(`\\b${name}\\s+(?:${SPEECH_VERBS})[\\s,]*$`, "i");
    const afterSpeakerVerbPattern = new RegExp(`^[\\s,]*(?:${name})\\s+(?:${SPEECH_VERBS})\\b`, "i");
    const afterVerbSpeakerPattern = new RegExp(`^[\\s,]*(?:${SPEECH_VERBS})\\s+(?:${name})\\b`, "i");

    if (beforePattern.test(before) || afterSpeakerVerbPattern.test(after) || afterVerbSpeakerPattern.test(after)) {
      matches.add(entry);
    }
  }

  return matches.size === 1 ? [...matches][0] : null;
}

function normalizeSegments(text: string, segments: DialogueAttributionSegment[]): DialogueAttributionSegment[] {
  return segments
    .map((segment) => {
      const start = clampIndex(segment.start, text.length);
      const end = clampIndex(segment.end, text.length);
      const speakerName = segment.speakerName.trim();

      if (end <= start || speakerName.length === 0) {
        return null;
      }

      const normalized: DialogueAttributionSegment = {
        start,
        end,
        speakerName,
        source: segment.source,
        confidence: segment.confidence,
      };

      if ("speakerId" in segment) {
        normalized.speakerId = segment.speakerId ?? null;
      }

      return normalized;
    })
    .filter((segment): segment is DialogueAttributionSegment => segment !== null)
    .sort((left, right) => left.start - right.start || left.end - right.end);
}

function parseTagAttributes(raw: string): { name?: string; characterId?: string } {
  const attrs: { name?: string; characterId?: string } = {};
  const attrPattern = /([a-zA-Z][a-zA-Z0-9_-]*)=(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;

  while ((match = attrPattern.exec(raw)) !== null) {
    const name = match[1]?.toLowerCase();
    const value = (match[2] ?? match[3] ?? "").trim();

    if ((name === "name" || name === "speaker") && value.length > 0) {
      attrs.name = value;
    }

    if ((name === "characterid" || name === "character-id" || name === "id") && value.length > 0) {
      attrs.characterId = value;
    }
  }

  return attrs;
}

function findSpeaker(lookup: SpeakerLookup, name?: string, characterId?: string): SpeakerLookupEntry | null {
  if (characterId) {
    const byId = lookup.byId.get(characterId);
    if (byId) {
      return byId;
    }
  }

  if (!name) {
    return null;
  }

  return lookup.byName.get(normalizeSpeakerKey(name)) ?? null;
}

function createSegment(
  start: number,
  end: number,
  speaker: SpeakerLookupEntry,
  source: DialogueAttributionSegment["source"],
  confidence: DialogueAttributionSegment["confidence"],
): DialogueAttributionSegment {
  return {
    start,
    end,
    speakerName: speaker.name,
    speakerId: speaker.id ?? null,
    source,
    confidence,
  };
}

function overlapsAny(start: number, end: number, segments: DialogueAttributionSegment[]): boolean {
  return segments.some((segment) => start < segment.end && end > segment.start);
}

function clampIndex(index: number, max: number): number {
  if (!Number.isFinite(index)) {
    return 0;
  }

  return Math.max(0, Math.min(max, Math.trunc(index)));
}

function normalizeSpeakerKey(name: string): string {
  return name.trim().toLocaleLowerCase();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
