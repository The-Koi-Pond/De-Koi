/**
 * Picks the ambient bed for a Roleplay scene without a model call. World State (location, weather, time) decides when
 * the chat has it. Without it, the scene's setup text and the latest replies vote, and the bed only changes when the
 * text clearly moved somewhere else: a passing mention of rain never swaps the tavern out.
 */
import { SCENE_AMBIENT_SOUNDS, type SceneAmbientId } from "./scene-sound-catalog";

/** Hits a bed needs in the text before it plays or replaces another. */
const SCENE_AMBIENT_MIN_SCORE = 2;

const AMBIENT_WORDS: Record<SceneAmbientId, RegExp> = {
  tavern: /\b(?:tavern|inn|pub|alehouse|saloon|taproom|barkeep|tankards?)\b/gi,
  carnival: /\b(?:circus|carnival|big top|fairground|funfair|midway|ringmaster|sideshow)\b/gi,
  cave: /\b(?:caves?|caverns?|grotto|stalactites?|stalagmites?)\b/gi,
  storm: /\b(?:thunder\w*|lightning|storm(?:s|y|ing)?)\b/gi,
  rain: /\b(?:rain(?:s|ing|ed|fall|drops?|y|water)?|drizzl\w*|downpour)\b/gi,
  wind: /\b(?:wind(?:s|y|swept)?|gales?|gusts?|blizzard|snowstorm|snow(?:fall|ing|drifts?)?)\b/gi,
  ocean: /\b(?:ocean|seas?|beach|shore(?:line)?|surf|coast(?:line)?|harbou?r|docks?|pier|tide)\b/gi,
  forest: /\b(?:forest|woods|woodland|jungle|grove|glade|birdsong|treetops)\b/gi,
  city: /\b(?:city|streets?|traffic|sidewalks?|downtown|marketplace|plaza|alley(?:way)?s?)\b/gi,
  fireplace: /\b(?:fireplace|hearth|campfire|bonfire)\b/gi,
  night: /\b(?:crickets?|cicadas?|moonlit|moonlight|starlit|starry|night air|night sky)\b/gi,
};

const NIGHT_TIME = /\b(?:night|midnight|late evening)\b/i;
const INDOORS =
  /\b(?:room|house|home|inside|interior|bedroom|kitchen|office|hall|apartment|flat|tent|trailer|cabin|chamber|study|library|basement|attic|bathroom)\b/i;

export interface SceneAmbientTracker {
  location?: string | null;
  weather?: string | null;
  time?: string | null;
}

export interface SceneAmbientInput {
  /** World State for the visible reply, when the chat has it. */
  tracker?: SceneAmbientTracker | null;
  /** The scene's setup text, like a Scene chat's description. */
  sceneText?: string | null;
  /** The latest replies, oldest first. */
  recentReplies: readonly string[];
}

function countHits(pattern: RegExp, text: string): number {
  return text.match(pattern)?.length ?? 0;
}

/** Hits per bed in `text`. */
function scoreSceneAmbience(text: string): Map<SceneAmbientId, number> {
  const scores = new Map<SceneAmbientId, number>();
  for (const sound of SCENE_AMBIENT_SOUNDS) {
    const hits = countHits(AMBIENT_WORDS[sound.id], text);
    if (hits > 0) scores.set(sound.id, hits);
  }
  return scores;
}

/** The bed World State describes, or null when its fields name nothing the catalog has. */
export function sceneAmbientFromTracker(tracker: SceneAmbientTracker): SceneAmbientId | null {
  const place = [tracker.location, tracker.weather].filter(Boolean).join(" ");
  for (const sound of SCENE_AMBIENT_SOUNDS) {
    if (countHits(AMBIENT_WORDS[sound.id], place) > 0) return sound.id;
  }
  const location = tracker.location ?? "";
  if (tracker.time && NIGHT_TIME.test(tracker.time) && location && !INDOORS.test(location)) return "night";
  return null;
}

function trackerHasScene(tracker: SceneAmbientTracker | null | undefined): tracker is SceneAmbientTracker {
  return Boolean(tracker && (tracker.location?.trim() || tracker.weather?.trim()));
}

/**
 * The bed to play now, given the one playing (`current`). Same input, same answer, so a reply that doesn't move the
 * scene never restarts or swaps the bed.
 */
export function pickSceneAmbient(input: SceneAmbientInput, current: SceneAmbientId | null): SceneAmbientId | null {
  if (trackerHasScene(input.tracker)) {
    const fromTracker = sceneAmbientFromTracker(input.tracker);
    if (fromTracker) return fromTracker;
  }

  const text = [input.sceneText ?? "", ...input.recentReplies].join("\n");
  const scores = scoreSceneAmbience(text);
  let winner: SceneAmbientId | null = null;
  let best = 0;
  for (const sound of SCENE_AMBIENT_SOUNDS) {
    const score = scores.get(sound.id) ?? 0;
    if (score > best) {
      winner = sound.id;
      best = score;
    }
  }
  if (!winner || best < SCENE_AMBIENT_MIN_SCORE) return current;
  if (current && (scores.get(current) ?? 0) >= best) return current;
  return winner;
}
