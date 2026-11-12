/**
 * The sounds Roleplay scene sound can play. Each one is a fixed description that ElevenLabs turns into audio once
 * and the device keeps, so a chat never pays for the same rain twice and the total a user can be charged is bounded
 * by this list (plus the rare "[SFX: …]" cue a reply writes itself).
 */

export type SceneAmbientId =
  | "tavern"
  | "carnival"
  | "cave"
  | "storm"
  | "rain"
  | "wind"
  | "ocean"
  | "forest"
  | "city"
  | "fireplace"
  | "night";

export interface SceneSound {
  /** Stable id: the cache key and the "don't repeat" check use it. */
  id: string;
  /** What ElevenLabs is asked to make. */
  description: string;
}

export interface SceneAmbientSound extends SceneSound {
  id: SceneAmbientId;
  label: string;
}

/** Length of one ambient clip. The player loops it with a crossfade, so 20 seconds rarely sounds repeated. */
export const SCENE_AMBIENT_CLIP_SECONDS = 20;

/** In priority order: when two beds match equally, the earlier one wins (a tavern in the rain sounds like a tavern). */
export const SCENE_AMBIENT_SOUNDS: readonly SceneAmbientSound[] = [
  {
    id: "tavern",
    label: "Tavern",
    description: "Crowded tavern interior, murmuring voices and clinking mugs, continuous ambience, no music",
  },
  {
    id: "carnival",
    label: "Carnival",
    description: "Carnival grounds, distant crowd chatter and laughter outdoors, continuous ambience, no music",
  },
  {
    id: "cave",
    label: "Cave",
    description: "Water dripping in a large echoing cave, low distant rumble, continuous ambience, no music",
  },
  {
    id: "storm",
    label: "Storm",
    description: "Heavy rainstorm with gusting wind and distant rolling thunder, continuous ambience, no music",
  },
  {
    id: "rain",
    label: "Rain",
    description: "Steady rain falling outdoors, soft continuous patter, no thunder, continuous ambience, no music",
  },
  {
    id: "wind",
    label: "Wind",
    description: "Cold wind howling across open ground, continuous ambience, no music",
  },
  {
    id: "ocean",
    label: "Ocean",
    description: "Ocean waves rolling onto a beach, gulls far away, continuous ambience, no music",
  },
  {
    id: "forest",
    label: "Forest",
    description: "Daytime forest, birdsong and leaves rustling in a light breeze, continuous ambience, no music",
  },
  {
    id: "city",
    label: "City",
    description: "Busy city street, distant traffic, footsteps and indistinct voices, continuous ambience, no music",
  },
  {
    id: "fireplace",
    label: "Fireplace",
    description: "Crackling fireplace in a quiet room, continuous ambience, no music",
  },
  {
    id: "night",
    label: "Night",
    description: "Quiet night outdoors, crickets chirping, faint breeze, continuous ambience, no music",
  },
];

export function sceneAmbientSound(id: SceneAmbientId): SceneAmbientSound {
  return SCENE_AMBIENT_SOUNDS.find((sound) => sound.id === id)!;
}

export interface SceneEffectSound extends SceneSound {
  /** Matches the event in narration (quoted dialogue is removed first). */
  pattern: RegExp;
}

const NEAR = "[^.!?\\n]{0,40}";
const GLASS = "(?:glass|window|windowpane|mirror|bottle|vase|goblet|cup|plate)";

/** One-shot effects for clear story events. Checked against narration only, so talking about a gunshot plays none. */
export const SCENE_EFFECT_SOUNDS: readonly SceneEffectSound[] = [
  {
    id: "door-slam",
    description: "A heavy wooden door slamming shut",
    pattern: new RegExp(
      `\\bdoors?\\b${NEAR}\\b(?:slam(?:s|med|ming)?|bang(?:s|ed)? shut)\\b|\\bslam(?:s|med|ming)?\\b${NEAR}\\bdoors?\\b`,
      "i",
    ),
  },
  {
    id: "knock",
    description: "Three firm knocks on a wooden door",
    pattern: new RegExp(`\\bknock(?:s|ed|ing)?\\b${NEAR}\\bdoors?\\b|\\bdoor\\b${NEAR}\\bknock`, "i"),
  },
  {
    id: "door-creak",
    description: "An old wooden door creaking slowly open",
    pattern: new RegExp(`\\bdoors?\\b${NEAR}\\bcreak|\\bcreak\\w*${NEAR}\\bdoors?\\b`, "i"),
  },
  {
    id: "thunder",
    description: "A loud crack of thunder that rolls away into the distance",
    pattern: new RegExp(
      `\\bthunder\\b${NEAR}\\b(?:crack|boom|rumbl|roar|crash|clap)\\w*|\\b(?:crack|clap|boom|roll|peal)s? of thunder\\b|\\bthunderclap\\b`,
      "i",
    ),
  },
  {
    id: "glass-shatter",
    description: "Glass shattering on a hard floor",
    // The object has to be named: "her heart shattered" breaks no glass.
    pattern: new RegExp(
      `\\b${GLASS}\\b${NEAR}\\b(?:shatter|smash)\\w*|\\b(?:shatter|smash)\\w*${NEAR}\\b${GLASS}\\b`,
      "i",
    ),
  },
  {
    id: "gunshot",
    description: "A single gunshot echoing outdoors",
    pattern:
      /\b(?:gunshots?|gunfire|(?:gun|pistol|rifle|revolver)\s+(?:goes off|went off|fires|fired|cracks|cracked)|pull(?:s|ed)? the trigger|a shot rings? out|a shot rang out)\b/i,
  },
  {
    id: "explosion",
    description: "A loud explosion followed by falling debris",
    // Not "an explosion of color" or "she exploded with anger".
    pattern: /\b(?:explosions?(?! of)|explode[sd](?! (?:with|in|into))|detonat(?:es|ed|ion))\b/i,
  },
  {
    id: "sword-clash",
    description: "Two steel swords clashing together",
    pattern: new RegExp(`\\b(?:blades?|swords?|steel)\\b${NEAR}\\b(?:clash|clang|ring)\\w*`, "i"),
  },
  {
    id: "bell",
    description: "A large bell tolling once",
    // A bell has to be named: "it takes its toll" rings nothing.
    pattern: new RegExp(`\\bbells?\\b${NEAR}\\b(?:toll|ring|rang|chime)\\w*`, "i"),
  },
  {
    id: "phone",
    description: "A mobile phone ringing",
    pattern: new RegExp(`\\b(?:phone|cellphone)\\b${NEAR}\\b(?:rings?|rang|ringing|buzz\\w*|vibrat\\w*)`, "i"),
  },
  {
    id: "applause",
    description: "An audience applauding and cheering",
    pattern:
      /\b(?:applause|applaud(?:s|ed|ing)?|(?:crowd|audience)\s+(?:claps|clapped|cheers|cheered|erupts|erupted))\b/i,
  },
  {
    id: "whip",
    description: "A single sharp whip crack",
    pattern: new RegExp(`\\bwhip\\b${NEAR}\\bcrack\\w*|\\bcrack\\w* (?:of )?(?:the|a|his|her|their) whip\\b`, "i"),
  },
];
