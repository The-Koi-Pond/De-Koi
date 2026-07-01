import type { MusicDjIntent, MusicDjResolveResponse, MusicDjTrack, YouTubeSearcher, YouTubeSearchItem } from "./types";

const TOKEN_RE = /[a-z0-9]+/gi;
const STOP_WORDS = new Set(["with", "that", "this", "from", "they", "their", "player", "asks", "into"]);
const DURATION_LIMITS = {
  song: { min: 60, max: 12 * 60 },
  ambience: { min: 5 * 60, max: 3 * 60 * 60 },
  long_mix: { min: 20 * 60, max: 6 * 60 * 60 },
};

function words(value: string, limit: number): string[] {
  return Array.from(value.toLowerCase().matchAll(TOKEN_RE), (match) => match[0])
    .filter((word) => word.length > 3 && !STOP_WORDS.has(word))
    .slice(0, limit);
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildYouTubeQueries(intent: MusicDjIntent): string[] {
  const mood = intent.hints?.mood?.trim() || words(intent.sceneText, 3).join(" ") || "cinematic roleplay";
  const vocals = intent.hints?.vocals === "vocals" ? "" : "instrumental";
  const primaryCharacter = intent.characters?.[0];
  const characterWords = primaryCharacter
    ? words(`${primaryCharacter.description ?? ""} ${primaryCharacter.name}`, 8).filter((word) => word !== primaryCharacter.name.toLowerCase())
    : [];
  const roleWords = ["vampire", "prince", "queen", "king", "detective", "knight", "witch", "mage"];
  const characterRole = characterWords.filter((word) => roleWords.includes(word)).slice(0, 2);
  const characterColor = characterWords.find((word) => !characterRole.includes(word)) ?? "";
  const sceneWords = words(intent.sceneText, 6);
  const scene = sceneWords.includes("ballroom") ? "candlelit ballroom gothic waltz" : sceneWords.slice(0, 4).join(" ");
  const modeLabel = intent.mode === "game" ? "game soundtrack" : "roleplay soundtrack";

  return unique([
    `${mood} ${vocals} ${characterRole.join(" ")} ${sceneWords.includes("ballroom") ? "ballroom" : "music"} music`,
    `${sceneWords.slice(0, 1).join(" ")} ${characterColor} ${vocals} ${modeLabel}`,
    `${scene} ${vocals}`,
  ].map((query) => query.replace(/\s+/g, " ").trim()));
}

function durationMatches(intent: MusicDjIntent, durationSeconds: number): boolean {
  const desired = intent.hints?.duration ?? "song";
  const limits = DURATION_LIMITS[desired];
  return durationSeconds >= limits.min && durationSeconds <= limits.max;
}

function scoreCandidate(intent: MusicDjIntent, item: YouTubeSearchItem): number {
  const haystack = `${item.title} ${item.channel}`.toLowerCase();
  const moodTokens = words(intent.hints?.mood ?? "", 6);
  const sceneTokens = words(intent.sceneText, 12);
  const characterTokens = words(intent.characters?.map((c) => `${c.name} ${c.description ?? ""}`).join(" ") ?? "", 8);
  let score = 20;
  for (const token of moodTokens) if (haystack.includes(token)) score += 16;
  for (const token of sceneTokens) if (haystack.includes(token)) score += 8;
  for (const token of characterTokens) if (haystack.includes(token)) score += 5;
  if (/instrumental|ambient|ambience|ost|soundtrack|score|waltz|piano|orchestral/.test(haystack)) score += 12;
  if (/karaoke|reaction|cover|lyrics|tutorial|nightcore|slowed|bass boosted/.test(haystack)) score -= 25;
  if ((intent.hints?.vocals ?? "instrumental") === "instrumental" && /lyrics|vocal|singer/.test(haystack)) score -= 12;
  return score;
}

export function rankYouTubeCandidates(intent: MusicDjIntent, items: YouTubeSearchItem[]): MusicDjTrack[] {
  const avoided = new Set(intent.avoidVideoIds ?? []);
  const seen = new Set<string>();
  return items
    .filter((item) => item.embeddable && !avoided.has(item.videoId) && durationMatches(intent, item.durationSeconds))
    .filter((item) => {
      if (seen.has(item.videoId)) return false;
      seen.add(item.videoId);
      return true;
    })
    .map((item) => ({
      provider: "youtube" as const,
      videoId: item.videoId,
      title: item.title,
      channel: item.channel,
      durationSeconds: item.durationSeconds,
      thumbnailUrl: item.thumbnailUrl,
      score: scoreCandidate(intent, item),
      reason: `${intent.hints?.mood ?? "scene music"}: ${item.title}`,
    }))
    .filter((track) => track.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

export async function resolveMusicDjIntent(
  intent: MusicDjIntent,
  searcher: YouTubeSearcher,
): Promise<MusicDjResolveResponse> {
  try {
    const batches = await Promise.all(buildYouTubeQueries(intent).map((query) => searcher.search(query, intent)));
    return { available: true, provider: "youtube", tracks: rankYouTubeCandidates(intent, batches.flat()) };
  } catch (error) {
    return {
      available: false,
      provider: "youtube",
      tracks: [],
      error: error instanceof Error ? error.message : "YouTube resolver failed",
    };
  }
}
