// ──────────────────────────────────────────────
// Scene backgrounds: a character's own backgrounds that follow the story
// ──────────────────────────────────────────────
// A character card can name a few backgrounds from the library, each with the words that put the story there
// (`extensions.sceneBackgrounds`; the first is where the story opens). A reply that clearly moves the scene to
// one of them switches the chat's background, with no model call. A background the user picked themselves is
// never replaced: switching only happens while the chat shows none, or one of these scenes.

import type { CharacterSceneBackground } from "../../../contracts/types/character";

/** Distinct keywords a reply must mention before the scene moves; one stray word is not a scene change. */
const MIN_KEYWORD_HITS = 2;

function readKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const keywords = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const keyword = item.trim().toLowerCase();
    if (keyword) keywords.add(keyword);
  }
  return [...keywords];
}

/** The usable scene backgrounds stored on a card, in order. Entries without a background or keywords are dropped. */
export function normalizeSceneBackgrounds(value: unknown): CharacterSceneBackground[] {
  if (!Array.isArray(value)) return [];
  const scenes: CharacterSceneBackground[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const background = typeof record.background === "string" ? record.background.trim() : "";
    const keywords = readKeywords(record.keywords);
    if (!background || keywords.length === 0 || seen.has(background)) continue;
    seen.add(background);
    const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : background;
    scenes.push({ background, name, keywords });
  }
  return scenes;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function keywordPattern(keyword: string): RegExp {
  // Whole words, any spacing between the words of a phrase, an optional plural "s".
  const body = keyword.split(/\s+/).map(escapeRegExp).join("\\s+");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${body}s?(?=$|[^\\p{L}\\p{N}])`, "iu");
}

/** How many of a scene's keywords the text mentions. */
export function sceneKeywordHits(scene: CharacterSceneBackground, text: string): number {
  let hits = 0;
  for (const keyword of scene.keywords) {
    if (keywordPattern(keyword).test(text)) hits += 1;
  }
  return hits;
}

/**
 * The background a reply moves the scene to, or null to keep the current one. `current` is the chat's stored
 * background (a library filename, or null for none).
 */
export function pickSceneBackground(
  scenes: readonly CharacterSceneBackground[],
  current: string | null,
  replyText: string,
): string | null {
  if (scenes.length === 0 || !replyText.trim()) return null;
  const currentScene = current ? scenes.find((scene) => scene.background === current) : undefined;
  if (current && !currentScene) return null;

  const currentHits = currentScene ? sceneKeywordHits(currentScene, replyText) : 0;
  let best: { background: string; hits: number } | null = null;
  for (const scene of scenes) {
    if (scene.background === current) continue;
    const hits = sceneKeywordHits(scene, replyText);
    if (hits < MIN_KEYWORD_HITS || hits <= currentHits) continue;
    if (!best || hits > best.hits) best = { background: scene.background, hits };
  }
  return best?.background ?? null;
}
