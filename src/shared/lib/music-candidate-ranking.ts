import type { MusicCandidate } from "../api/music-api";
import type { MusicDjIntent } from "./music-dj-intent";

export interface MusicCandidateRankingOptions {
  query?: string | null;
  intent?: MusicDjIntent | null;
  currentTrackId?: string | null;
  recentTrackIds?: string[] | null;
  fresh?: boolean;
}

const POSITIVE_BACKGROUND_TERMS = new Set([
  "ambient",
  "ambience",
  "background",
  "instrumental",
  "ost",
  "score",
  "soundtrack",
  "no vocals",
  "music only",
]);

const DISTRACTING_TERMS = ["lyrics", "lyric video", "karaoke", "cover", "official music video", "vocals", "vocal"];
const TOKEN_STOPWORDS = new Set(["a", "an", "and", "for", "in", "of", "on", "or", "the", "to", "with"]);

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function candidateText(candidate: MusicCandidate): string {
  return normalizeText(
    [candidate.title, candidate.channelOrArtist, candidate.url, ...(candidate.reasonTags ?? [])]
      .filter((value): value is string => typeof value === "string" && !!value.trim())
      .join(" "),
  );
}

function tokenize(value: string | null | undefined): string[] {
  return normalizeText(value ?? "")
    .split(" ")
    .filter((token) => token.length > 2 && !TOKEN_STOPWORDS.has(token));
}

function intentNeedles(options: MusicCandidateRankingOptions): string[] {
  const constraints = Array.isArray(options.intent?.constraints) ? options.intent.constraints : [];
  return [options.query, options.intent?.mood, options.intent?.intensity, options.intent?.setting, ...constraints]
    .flatMap((value) => tokenize(value ?? ""));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function youtubeVideoIdFromText(raw: string): string | null {
  const text = raw.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(text)) return text;
  const patterns = [
    /youtube:([a-zA-Z0-9_-]{11})/,
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /embed\/([a-zA-Z0-9_-]{11})/,
    /shorts\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function candidateId(candidate: MusicCandidate): string {
  const raw = `${candidate.id} ${candidate.url ?? ""}`;
  return youtubeVideoIdFromText(raw) ?? candidate.id ?? candidate.url ?? candidate.title;
}

function scoreCandidate(candidate: MusicCandidate, options: MusicCandidateRankingOptions): number {
  const text = candidateText(candidate);
  let score = (typeof candidate.confidence === "number" ? candidate.confidence : 0.5) * 20;

  let matchedIntentTokens = 0;
  for (const token of unique(intentNeedles(options))) {
    if (text.includes(token)) {
      matchedIntentTokens += 1;
      score += 10;
    }
  }
  if (intentNeedles(options).length > 0 && matchedIntentTokens === 0) score -= 12;

  for (const term of POSITIVE_BACKGROUND_TERMS) {
    if (text.includes(term)) score += 12;
  }

  const wantsVocals = options.intent?.constraints?.some((entry) => /\bvocals?\b/i.test(entry));
  if (!wantsVocals) {
    for (const term of DISTRACTING_TERMS) {
      if (text.includes(term)) score -= 24;
    }
  }

  const id = candidateId(candidate);
  if (options.fresh && options.currentTrackId && id === options.currentTrackId) score -= 100;
  if (options.fresh && options.recentTrackIds?.includes(id)) score -= 70;

  return score;
}

export function rankMusicCandidates(
  candidates: MusicCandidate[],
  options: MusicCandidateRankingOptions = {},
): MusicCandidate[] {
  return candidates
    .map((candidate, index) => ({ candidate, index, score: scoreCandidate(candidate, options) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.candidate);
}