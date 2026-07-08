import type { CharacterMusicFavoriteSong, CharacterMusicProfile } from "../../../../engine/contracts/types/character";

export type ResolvedCharacterNowListening = {
  kind: "song" | "taste";
  title: string;
  artist: string | null;
  url: string | null;
  query: string;
  displayText: string;
};

export type CharacterMusicPlaybackCue = {
  query: string;
};

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const VIBE_SEARCH_STOPWORDS = new Set([
  "about",
  "after",
  "because",
  "before",
  "canon",
  "character",
  "could",
  "does",
  "exact",
  "extrapolates",
  "extrapolating",
  "from",
  "having",
  "hook",
  "into",
  "listening",
  "music",
  "notes",
  "play",
  "publicly",
  "read",
  "scene",
  "state",
  "states",
  "their",
  "them",
  "they",
  "this",
  "would",
]);

function compactVibeSearchTerms(value: string): string {
  const text = cleanText(value)
    .replace(/hook to cut\s*:.*/i, " ")
    .replace(/canon does not state[^.?!]*[.?!]?/gi, " ")
    .replace(/\bextrapolat(?:e|es|ed|ing)\b/gi, " ");
  const terms = text.match(/[a-z0-9][a-z0-9'-]{2,}/gi) ?? [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const term of terms) {
    const normalized = term.toLowerCase().replace(/^'+|'+$/g, "");
    if (!normalized || VIBE_SEARCH_STOPWORDS.has(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= 8) break;
  }
  return result.join(" ");
}

function uniqueTexts(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of entries) {
    const text = cleanText(readText(item));
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function readSong(value: unknown): CharacterMusicFavoriteSong | null {
  const record = readRecord(value);
  const title = cleanText(readText(record.title));
  if (!title) return null;
  const artist = cleanText(readText(record.artist));
  const url = cleanText(readText(record.url));
  return {
    title,
    ...(artist ? { artist } : {}),
    ...(url ? { url } : {}),
  };
}

function uniqueSongs(value: unknown): CharacterMusicFavoriteSong[] {
  const entries = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const result: CharacterMusicFavoriteSong[] = [];
  for (const entry of entries) {
    const song = readSong(entry);
    if (!song) continue;
    const key = `${song.title}\u0000${song.artist ?? ""}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(song);
  }
  return result;
}

export function readCharacterMusicProfile(value: unknown): CharacterMusicProfile {
  const record = readRecord(value);
  return {
    publicListeningEnabled: record.publicListeningEnabled === true,
    favoriteGenres: uniqueTexts(record.favoriteGenres),
    favoriteArtists: uniqueTexts(record.favoriteArtists),
    favoriteSongs: uniqueSongs(record.favoriteSongs),
    vibeNotes: cleanText(readText(record.vibeNotes)),
  };
}

function songDisplay(song: CharacterMusicFavoriteSong): string {
  return song.artist ? `${song.title} by ${song.artist}` : song.title;
}

function songQuery(song: CharacterMusicFavoriteSong): string {
  return [song.title, song.artist].filter(Boolean).join(" ");
}

function tasteQuery(profile: CharacterMusicProfile): string {
  const vibeSearchTerms = compactVibeSearchTerms(profile.vibeNotes ?? "");
  return [...(profile.favoriteArtists ?? []), ...(profile.favoriteGenres ?? []), vibeSearchTerms, "music"]
    .map((part) => cleanText(part ?? ""))
    .filter(Boolean)
    .join(" ");
}

export function characterMusicOptionCount(profile: CharacterMusicProfile): number {
  if (!profile.publicListeningEnabled) return 0;
  const songCount = profile.favoriteSongs?.length ?? 0;
  const artistCount = profile.favoriteArtists?.length ?? 0;
  const genreCount = profile.favoriteGenres?.length ?? 0;
  const vibeCount = profile.vibeNotes?.trim() ? 1 : 0;
  return songCount + artistCount + genreCount + vibeCount;
}

export function deriveCharacterMusicOptions(profile: CharacterMusicProfile): ResolvedCharacterNowListening[] {
  if (!profile.publicListeningEnabled) return [];
  const songs = profile.favoriteSongs ?? [];
  const artists = profile.favoriteArtists ?? [];
  const genres = profile.favoriteGenres ?? [];
  const vibeSearchTerms = compactVibeSearchTerms(profile.vibeNotes ?? "");
  const options: ResolvedCharacterNowListening[] = songs.map((song) => {
    const query = songQuery(song);
    return {
      kind: "song" as const,
      title: song.title,
      artist: song.artist ?? null,
      url: song.url ?? null,
      query,
      displayText: songDisplay(song),
    };
  });

  for (const artist of artists) {
    const title = `${artist} radio`;
    const query = [artist, ...genres, vibeSearchTerms, "music"]
      .map((part) => cleanText(part ?? ""))
      .filter(Boolean)
      .join(" ");
    if (!query) continue;
    options.push({ kind: "taste", title, artist: null, url: null, query, displayText: title });
  }

  for (const genre of genres) {
    const title = `${genre} mix`;
    const query = [...artists, genre, vibeSearchTerms, "music"]
      .map((part) => cleanText(part ?? ""))
      .filter(Boolean)
      .join(" ");
    if (!query) continue;
    options.push({ kind: "taste", title, artist: null, url: null, query, displayText: title });
  }

  if (profile.vibeNotes?.trim()) {
    const title = "music taste mix";
    const query = tasteQuery(profile);
    if (query.trim()) {
      options.push({ kind: "taste", title, artist: null, url: null, query, displayText: title });
    }
  }

  return options;
}

export function deriveCharacterNowListening(
  profile: CharacterMusicProfile,
  optionIndex = 0,
): ResolvedCharacterNowListening | null {
  const options = deriveCharacterMusicOptions(profile);
  if (options.length === 0) return null;
  const normalizedIndex = ((Math.trunc(optionIndex) % options.length) + options.length) % options.length;
  return options[normalizedIndex] ?? null;
}

export function formatNowListeningLine(listening: ResolvedCharacterNowListening | null | undefined): string | null {
  if (!listening) return null;
  return `Listening to: ${listening.displayText}`;
}

export function buildCharacterMusicPlaybackCue(
  listening: ResolvedCharacterNowListening | null | undefined,
): CharacterMusicPlaybackCue | null {
  if (!listening) return null;
  const query = listening.url || listening.query;
  return query ? { query } : null;
}

export function parseMusicTextList(value: string): string[] {
  return uniqueTexts(value.split(/[\n,]/g));
}

export function serializeMusicTextList(value: readonly string[] | undefined): string {
  return uniqueTexts(value ?? []).join(", ");
}

export function parseFavoriteSongsText(value: string): CharacterMusicFavoriteSong[] {
  return uniqueSongs(
    value
      .split(/\r?\n/g)
      .map((line) => {
        const [songPart = "", rawUrl = ""] = line.split("|");
        const [rawTitle = "", ...artistParts] = songPart.split(" - ");
        const title = cleanText(rawTitle);
        if (!title) return null;
        const artist = cleanText(artistParts.join(" - "));
        const url = cleanText(rawUrl);
        return {
          title,
          ...(artist ? { artist } : {}),
          ...(url ? { url } : {}),
        };
      })
      .filter(Boolean),
  );
}

export function serializeFavoriteSongsText(value: readonly CharacterMusicFavoriteSong[] | undefined): string {
  return uniqueSongs(value ?? [])
    .map((song) => {
      const title = song.artist ? `${song.title} - ${song.artist}` : song.title;
      return song.url ? `${title} | ${song.url}` : title;
    })
    .join("\n");
}


