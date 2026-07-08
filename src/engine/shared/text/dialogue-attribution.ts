import type { DialogueAttributionSegment, DialogueAttributionsExtra } from "../../contracts/types/chat";

export interface DialogueAttributionSpeaker {
  id?: string | null;
  name: string;
  aliases?: string[];
}

export interface BuildDialogueAttributionsOptions {
  stripSpeakerTags?: boolean;
  includeDerivedProse?: boolean;
  stripLeadingSpeakerPrefix?: boolean;
}

export interface BuildDialogueAttributionsResult {
  text: string;
  attributions: DialogueAttributionsExtra | null;
}

const SPEECH_VERBS =
  "said|says|asked|asks|replied|replies|repeated|repeats|whispered|whispers|murmured|murmurs|whimpered|whimpers|muttered|mutters|growled|growls|rumbled|rumbles|gasped|gasps|called|calls|answered|answers|shouted|shouts";

const SHA256_INITIAL_HASH = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
] as const;

const SHA256_ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
] as const;

export function createDialogueAttributionTextHash(text: string): string {
  return `dk1:${text.length}:${sha256Hex(new TextEncoder().encode(text))}`;
}

export function validateDialogueAttributionsForText(
  text: string,
  attributions: DialogueAttributionsExtra | null | undefined,
  speakers?: DialogueAttributionSpeaker[],
): DialogueAttributionsExtra | null {
  if (!attributions || attributions.version !== 1) {
    return null;
  }

  if (attributions.textHash !== createDialogueAttributionTextHash(text)) {
    return null;
  }

  const lookup = speakers ? createSpeakerLookup(speakers) : null;
  const segments = normalizeSegments(text, attributions.segments, lookup);

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
  const output =
    options.stripLeadingSpeakerPrefix === true
      ? stripLeadingSpeakerPrefixSegment(tagResult.text, [...explicitSegments, ...proseSegments])
      : { text: tagResult.text, segments: [...explicitSegments, ...proseSegments] };
  const normalized = normalizeSegments(output.text, output.segments, lookup);

  return {
    text: output.text,
    attributions:
      normalized.length > 0
        ? {
            version: 1,
            textHash: createDialogueAttributionTextHash(output.text),
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
  const segments: DialogueAttributionSegment[] = [];

  if (!stripTags) {
    const tagPattern = /<speaker\b([^>]*)>([\s\S]*?)<\/speaker>/gi;
    let match: RegExpExecArray | null;
    while ((match = tagPattern.exec(text)) !== null) {
      const fullMatch = match[0];
      const attrs = parseTagAttributes(match[1] ?? "");
      const innerText = match[2] ?? "";
      const speaker = findSpeaker(lookup, attrs.name, attrs.characterId);
      if (speaker) {
        const innerStart = match.index + fullMatch.indexOf(innerText);
        segments.push(createSegment(innerStart, innerStart + innerText.length, speaker, "speaker-tag", "explicit"));
      }
    }
    return { text, segments };
  }

  const tagPattern = /<\/speaker\s*>|<speaker\b[^>]*>/gi;
  const stack: Array<{ speaker: SpeakerLookupEntry | null }> = [];
  let cleaned = "";
  let cursor = 0;
  let match: RegExpExecArray | null;

  const activeSpeaker = (): SpeakerLookupEntry | null => {
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      const speaker = stack[index]?.speaker;
      if (speaker) return speaker;
    }
    return null;
  };

  const appendText = (rawChunk: string, finalChunk = false) => {
    const chunk = finalChunk ? stripIncompleteSpeakerMarkers(rawChunk) : rawChunk;
    if (!chunk) return;
    const start = cleaned.length;
    cleaned += chunk;
    const end = cleaned.length;
    const speaker = activeSpeaker();
    if (!speaker || end <= start) return;

    const last = segments[segments.length - 1];
    if (
      last &&
      last.end === start &&
      last.speakerName === speaker.name &&
      (last.speakerId ?? null) === (speaker.id ?? null) &&
      last.source === "speaker-tag" &&
      last.confidence === "explicit"
    ) {
      last.end = end;
      return;
    }

    segments.push(createSegment(start, end, speaker, "speaker-tag", "explicit"));
  };

  while ((match = tagPattern.exec(text)) !== null) {
    appendText(text.slice(cursor, match.index));
    const token = match[0] ?? "";
    if (/^<\//.test(token)) {
      if (stack.length > 0) stack.pop();
    } else {
      const attrs = parseTagAttributes(/^<speaker\b([^>]*)>$/i.exec(token)?.[1] ?? "");
      stack.push({ speaker: findSpeaker(lookup, attrs.name, attrs.characterId) });
    }
    cursor = match.index + token.length;
  }

  appendText(text.slice(cursor), true);
  return { text: cleaned, segments };
}

function stripIncompleteSpeakerMarkers(text: string): string {
  return text.replace(/<\/speaker\s*$/i, "").replace(/<speaker\b[^>]*$/i, "");
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
    const indentation = match[2] ?? "";
    const content = match[4] ?? "";
    const lineStart = match.index + (match[1]?.length ?? 0);
    const start = match.index + match[0].length - content.length;
    const end = start + content.length;

    if (
      speaker &&
      !isNamePrefixLineSuppressed(text, lineStart, indentation) &&
      !overlapsAny(start, end, existingSegments)
    ) {
      segments.push(createSegment(start, end, speaker, "name-prefix", "explicit"));
    }
  }

  return segments;
}

function stripLeadingSpeakerPrefixSegment(
  text: string,
  segments: DialogueAttributionSegment[],
): { text: string; segments: DialogueAttributionSegment[] } {
  const candidate = segments
    .filter((segment) => segment.source === "name-prefix" && segment.start > 0 && segment.end > segment.start)
    .sort((left, right) => left.start - right.start || left.end - right.end)
    .find((segment) => isLeadingSpeakerPrefixSegment(text, segment));

  if (!candidate) {
    return { text, segments };
  }

  const removedLength = candidate.start;
  return {
    text: text.slice(removedLength),
    segments: segments
      .filter((segment) => segment.end > removedLength)
      .map((segment) => ({
        ...segment,
        start: Math.max(0, segment.start - removedLength),
        end: Math.max(0, segment.end - removedLength),
      }))
      .filter((segment) => segment.end > segment.start),
  };
}

function isLeadingSpeakerPrefixSegment(text: string, segment: DialogueAttributionSegment): boolean {
  const prefix = text.slice(0, segment.start);
  if (prefix.includes("\n")) {
    return false;
  }

  const trimmed = prefix.trim();
  if (!trimmed.endsWith(":")) {
    return false;
  }

  const prefixName = trimmed.slice(0, -1).trim().toLowerCase();
  return prefixName.length > 0 && prefixName === segment.speakerName.trim().toLowerCase();
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
  let carriedSpeaker: { speaker: SpeakerLookupEntry; lastEnd: number } | null = null;
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
      carriedSpeaker = { speaker, lastEnd: end };
      continue;
    }

    if (
      carriedSpeaker &&
      canCarrySpeakerAcross(text.slice(carriedSpeaker.lastEnd, start), carriedSpeaker.speaker, lookup)
    ) {
      segments.push(createSegment(start, end, carriedSpeaker.speaker, "explicit-attribution", "derived"));
      carriedSpeaker = { speaker: carriedSpeaker.speaker, lastEnd: end };
    } else {
      carriedSpeaker = null;
    }
  }

  return segments;
}

function canCarrySpeakerAcross(gap: string, speaker: SpeakerLookupEntry, lookup: SpeakerLookup): boolean {
  if (gap.length > 500) return false;
  return ![...collectNamedSpeakerEntries(gap, lookup, { includePossessives: false })].some(
    (entry) => entry.key !== speaker.key,
  );
}

const NAME_PROXIMITY_WORD_WINDOW = 12;

function findExplicitProseSpeaker(
  text: string,
  quoteStart: number,
  quoteEnd: number,
  lookup: SpeakerLookup,
): SpeakerLookupEntry | null {
  const nearbyNameSpeaker = findNearbyNameSpeaker(text, quoteStart, quoteEnd, lookup);
  if (nearbyNameSpeaker) {
    return nearbyNameSpeaker;
  }

  const pronounLookbackSpeaker = findPronounLookbackSpeaker(text, quoteStart, quoteEnd, lookup);
  if (pronounLookbackSpeaker) {
    return pronounLookbackSpeaker;
  }

  const nextParagraphSpeaker = findNextParagraphSpeaker(text, quoteEnd, lookup);
  if (nextParagraphSpeaker) {
    return nextParagraphSpeaker;
  }

  return findSpeechVerbSpeaker(text, quoteStart, quoteEnd, lookup);
}

function findNearbyNameSpeaker(
  text: string,
  quoteStart: number,
  quoteEnd: number,
  lookup: SpeakerLookup,
): SpeakerLookupEntry | null {
  const before = takeTrailingWordWindow(getProseBeforeQuote(text, quoteStart), NAME_PROXIMITY_WORD_WINDOW);
  const after = takeLeadingWordWindow(getProseAfterQuote(text, quoteEnd), NAME_PROXIMITY_WORD_WINDOW);
  const distances = new Map<SpeakerLookupEntry, number>();
  collectNamedSpeakerDistances(before, lookup, "before", distances);
  collectNamedSpeakerDistances(after, lookup, "after", distances);
  const ranked = [...distances.entries()].sort((left, right) => left[1] - right[1]);
  if (ranked.length === 0) {
    return null;
  }

  const closest = ranked[0];
  const nextClosest = ranked[1];
  if (!closest || (nextClosest && nextClosest[1] === closest[1])) {
    return null;
  }

  return closest[0];
}

function findPronounLookbackSpeaker(
  text: string,
  quoteStart: number,
  quoteEnd: number,
  lookup: SpeakerLookup,
): SpeakerLookupEntry | null {
  const paragraphProse = getQuoteParagraphProse(text, quoteStart, quoteEnd);
  if (!hasPronounAttribution(paragraphProse)) {
    return null;
  }

  const previousParagraph = getPreviousParagraphBefore(text, quoteStart);
  if (!previousParagraph.trim()) {
    return null;
  }

  const nonPossessiveNames = collectNamedSpeakerEntries(previousParagraph, lookup, { includePossessives: false });
  if (nonPossessiveNames.size === 1) {
    return [...nonPossessiveNames][0] ?? null;
  }

  if (nonPossessiveNames.size > 1) {
    return null;
  }

  const allNames = collectNamedSpeakerEntries(previousParagraph, lookup, { includePossessives: true });
  return allNames.size === 1 ? ([...allNames][0] ?? null) : null;
}

function findNextParagraphSpeaker(text: string, quoteEnd: number, lookup: SpeakerLookup): SpeakerLookupEntry | null {
  const nextParagraph = getNextParagraphAfter(text, quoteEnd);
  if (!nextParagraph.trim()) {
    return null;
  }

  const names = collectNamedSpeakerEntries(takeLeadingWordWindow(nextParagraph, NAME_PROXIMITY_WORD_WINDOW), lookup, {
    includePossessives: false,
  });
  return names.size === 1 ? ([...names][0] ?? null) : null;
}

function findSpeechVerbSpeaker(
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

function getProseBeforeQuote(text: string, quoteStart: number): string {
  const paragraphStart = findParagraphStartBefore(text, quoteStart);
  const previousQuoteEnd = text.lastIndexOf('"', quoteStart - 1);
  return text.slice(Math.max(paragraphStart, previousQuoteEnd + 1), quoteStart);
}

function getProseAfterQuote(text: string, quoteEnd: number): string {
  const paragraphEnd = findParagraphEndAfter(text, quoteEnd);
  const nextQuoteStart = text.indexOf('"', quoteEnd);
  const end = nextQuoteStart === -1 ? paragraphEnd : Math.min(paragraphEnd, nextQuoteStart);
  return text.slice(quoteEnd, end);
}

function collectNamedSpeakerDistances(
  text: string,
  lookup: SpeakerLookup,
  side: "before" | "after",
  distances: Map<SpeakerLookupEntry, number>,
): void {
  const normalizedText = text.toLowerCase();
  for (const [nameKey, entry] of lookup.byName) {
    const namePattern = new RegExp(`(^|[^A-Za-z0-9_])(${escapeRegExp(nameKey)})(?=$|[^A-Za-z0-9_])`, "gi");
    let match: RegExpExecArray | null;
    while ((match = namePattern.exec(normalizedText)) !== null) {
      const nameStart = match.index + (match[1]?.length ?? 0);
      const nameEnd = nameStart + (match[2]?.length ?? 0);
      if (isPossessiveNameUse(normalizedText, nameEnd)) {
        continue;
      }

      const distance = side === "before" ? countWords(text.slice(nameEnd)) : countWords(text.slice(0, nameStart));
      const previousDistance = distances.get(entry);
      if (previousDistance === undefined || distance < previousDistance) {
        distances.set(entry, distance);
      }
    }
  }
}

function collectNamedSpeakerEntries(
  text: string,
  lookup: SpeakerLookup,
  options: { includePossessives: boolean },
): Set<SpeakerLookupEntry> {
  const entries = new Set<SpeakerLookupEntry>();
  const normalizedText = text.toLowerCase();
  for (const [nameKey, entry] of lookup.byName) {
    const namePattern = new RegExp(`(^|[^A-Za-z0-9_])(${escapeRegExp(nameKey)})(?=$|[^A-Za-z0-9_])`, "gi");
    let match: RegExpExecArray | null;
    while ((match = namePattern.exec(normalizedText)) !== null) {
      const nameEnd = match.index + (match[1]?.length ?? 0) + (match[2]?.length ?? 0);
      if (!options.includePossessives && isPossessiveNameUse(normalizedText, nameEnd)) {
        continue;
      }

      entries.add(entry);
    }
  }
  return entries;
}

function isPossessiveNameUse(text: string, nameEnd: number): boolean {
  const suffix = text.slice(nameEnd, nameEnd + 2);
  return suffix === "'s" || suffix === "\u2019s";
}

function getQuoteParagraphProse(text: string, quoteStart: number, quoteEnd: number): string {
  const paragraphStart = findParagraphStartBefore(text, quoteStart);
  const paragraphEnd = findParagraphEndAfter(text, quoteEnd);
  return text.slice(paragraphStart, paragraphEnd).replace(/"[^"\n]+"/g, " ");
}

function hasPronounAttribution(text: string): boolean {
  return (
    /\b(?:he|she)\s+[A-Za-z][A-Za-z'-]*\b/i.test(text) ||
    /\b(?:his|her)\s+[A-Za-z][A-Za-z'-]*\s+[A-Za-z][A-Za-z'-]*\b/i.test(text)
  );
}

function getPreviousParagraphBefore(text: string, index: number): string {
  const paragraphStart = findParagraphStartBefore(text, index);
  if (paragraphStart <= 0) {
    return "";
  }

  const before = text.slice(0, paragraphStart).replace(/\s+$/, "");
  const previousStart = findParagraphStartBefore(before, before.length);
  return before.slice(previousStart);
}

function getNextParagraphAfter(text: string, index: number): string {
  const paragraphEnd = findParagraphEndAfter(text, index);
  const afterBreak = /^\n\s*\n/.exec(text.slice(paragraphEnd));
  if (!afterBreak) {
    return "";
  }

  const nextStart = paragraphEnd + afterBreak[0].length;
  const nextEnd = findParagraphEndAfter(text, nextStart);
  return text.slice(nextStart, nextEnd);
}

function countWords(text: string): number {
  return [...text.matchAll(/[A-Za-z0-9_'-]+/g)].length;
}

function takeTrailingWordWindow(text: string, maxWords: number): string {
  const words = [...text.matchAll(/[A-Za-z0-9_'-]+/g)];
  if (words.length <= maxWords) {
    return text;
  }

  return text.slice(words[words.length - maxWords]?.index ?? 0);
}

function takeLeadingWordWindow(text: string, maxWords: number): string {
  const words = [...text.matchAll(/[A-Za-z0-9_'-]+/g)];
  if (words.length <= maxWords) {
    return text;
  }

  const lastWord = words[maxWords - 1];
  return text.slice(0, (lastWord?.index ?? 0) + (lastWord?.[0].length ?? 0));
}

function findParagraphStartBefore(text: string, index: number): number {
  const before = text.slice(0, index);
  const matches = [...before.matchAll(/\n\s*\n/g)];
  const lastBreak = matches[matches.length - 1];
  return lastBreak ? (lastBreak.index ?? 0) + lastBreak[0].length : 0;
}

function findParagraphEndAfter(text: string, index: number): number {
  const after = text.slice(index);
  const match = /\n\s*\n/.exec(after);
  return match ? index + match.index : text.length;
}

function normalizeSegments(
  text: string,
  segments: DialogueAttributionSegment[],
  lookup: SpeakerLookup | null,
): DialogueAttributionSegment[] {
  return segments
    .map((segment) => {
      const start = clampIndex(segment.start, text.length);
      const end = clampIndex(segment.end, text.length);
      const speaker = lookup ? findSpeaker(lookup, segment.speakerName, segment.speakerId ?? undefined) : null;
      const speakerName = (speaker?.name ?? segment.speakerName).trim();

      if (end <= start || speakerName.length === 0 || (lookup && !speaker)) {
        return null;
      }

      const normalized: DialogueAttributionSegment = {
        start,
        end,
        speakerName,
        source: segment.source,
        confidence: segment.confidence,
      };

      if (lookup || "speakerId" in segment) {
        normalized.speakerId = speaker ? (speaker.id ?? null) : (segment.speakerId ?? null);
      }

      return normalized;
    })
    .filter((segment): segment is DialogueAttributionSegment => segment !== null)
    .sort((left, right) => left.start - right.start || left.end - right.end);
}

function parseTagAttributes(raw: string): { name?: string; characterId?: string } {
  const attrs: { name?: string; characterId?: string } = {};
  const bareSpeaker = raw.match(/^\s*=\s*(?:"([^"]*)"|'([^']*)')\s*$/);
  if (bareSpeaker) {
    const value = (bareSpeaker[1] ?? bareSpeaker[2] ?? "").trim();
    if (value.length > 0) attrs.name = value;
  }
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

function isNamePrefixLineSuppressed(text: string, lineStart: number, indentation: string): boolean {
  if (indentation.length >= 4) {
    return true;
  }

  return isInsideFenceAtIndex(text, lineStart) || isInsideHtmlTagAtIndex(text, lineStart, "pre");
}

function isInsideFenceAtIndex(text: string, index: number): boolean {
  const before = text.slice(0, index);
  const fenceMatches = before.match(/(^|\n)```/g);
  return (fenceMatches?.length ?? 0) % 2 === 1;
}

function isInsideHtmlTagAtIndex(text: string, index: number, tagName: string): boolean {
  const lower = text.slice(0, index).toLowerCase();
  return lower.lastIndexOf(`<${tagName}`) > lower.lastIndexOf(`</${tagName}>`);
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
  return name.trim().toLowerCase();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sha256Hex(bytes: Uint8Array): string {
  const hash: number[] = [...SHA256_INITIAL_HASH];
  const padded = padSha256Bytes(bytes);
  const words = new Uint32Array(64);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const wordOffset = offset + index * 4;
      words[index] =
        ((padded[wordOffset] ?? 0) << 24) |
        ((padded[wordOffset + 1] ?? 0) << 16) |
        ((padded[wordOffset + 2] ?? 0) << 8) |
        (padded[wordOffset + 3] ?? 0);
    }

    for (let index = 16; index < 64; index += 1) {
      const s0 =
        rotateRight(words[index - 15] ?? 0, 7) ^
        rotateRight(words[index - 15] ?? 0, 18) ^
        ((words[index - 15] ?? 0) >>> 3);
      const s1 =
        rotateRight(words[index - 2] ?? 0, 17) ^
        rotateRight(words[index - 2] ?? 0, 19) ^
        ((words[index - 2] ?? 0) >>> 10);
      words[index] = (((words[index - 16] ?? 0) + s0 + (words[index - 7] ?? 0) + s1) >>> 0) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;

    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e ?? 0, 6) ^ rotateRight(e ?? 0, 11) ^ rotateRight(e ?? 0, 25);
      const choice = ((e ?? 0) & (f ?? 0)) ^ (~(e ?? 0) & (g ?? 0));
      const temp1 = ((h ?? 0) + sum1 + choice + (SHA256_ROUND_CONSTANTS[index] ?? 0) + (words[index] ?? 0)) >>> 0;
      const sum0 = rotateRight(a ?? 0, 2) ^ rotateRight(a ?? 0, 13) ^ rotateRight(a ?? 0, 22);
      const majority = ((a ?? 0) & (b ?? 0)) ^ ((a ?? 0) & (c ?? 0)) ^ ((b ?? 0) & (c ?? 0));
      const temp2 = (sum0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = ((d ?? 0) + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    hash[0] = ((hash[0] ?? 0) + (a ?? 0)) >>> 0;
    hash[1] = ((hash[1] ?? 0) + (b ?? 0)) >>> 0;
    hash[2] = ((hash[2] ?? 0) + (c ?? 0)) >>> 0;
    hash[3] = ((hash[3] ?? 0) + (d ?? 0)) >>> 0;
    hash[4] = ((hash[4] ?? 0) + (e ?? 0)) >>> 0;
    hash[5] = ((hash[5] ?? 0) + (f ?? 0)) >>> 0;
    hash[6] = ((hash[6] ?? 0) + (g ?? 0)) >>> 0;
    hash[7] = ((hash[7] ?? 0) + (h ?? 0)) >>> 0;
  }

  return hash.map((word) => word.toString(16).padStart(8, "0")).join("");
}

function padSha256Bytes(bytes: Uint8Array): Uint8Array {
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  padded[paddedLength - 8] = (high >>> 24) & 0xff;
  padded[paddedLength - 7] = (high >>> 16) & 0xff;
  padded[paddedLength - 6] = (high >>> 8) & 0xff;
  padded[paddedLength - 5] = high & 0xff;
  padded[paddedLength - 4] = (low >>> 24) & 0xff;
  padded[paddedLength - 3] = (low >>> 16) & 0xff;
  padded[paddedLength - 2] = (low >>> 8) & 0xff;
  padded[paddedLength - 1] = low & 0xff;

  return padded;
}

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}
