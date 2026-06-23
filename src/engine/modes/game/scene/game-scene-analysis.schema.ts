import { z } from "zod";
import { LOCATION_KINDS, MUSIC_GENRES, MUSIC_INTENSITIES } from "../../../shared/scoring/music-score";

export type GameSceneAnalysisJsonRecord = Record<string, unknown>;

const nullableString = z.string().nullable();
const finiteNumber = z.number().finite();

const weatherSchema = z.enum(["clear", "cloudy", "foggy", "rainy", "stormy", "snowy", "windy", "frost"]).nullable();
const timeOfDaySchema = z.enum(["dawn", "morning", "noon", "afternoon", "evening", "night", "midnight"]).nullable();

const directionSchema = z
  .object({
    effect: z.enum([
      "fade_from_black",
      "fade_to_black",
      "flash",
      "screen_shake",
      "blur",
      "vignette",
      "letterbox",
      "color_grade",
      "focus",
      "pulse",
      "slow_zoom",
      "impact_zoom",
      "tilt",
      "desaturate",
      "chromatic_aberration",
      "film_grain",
      "rain_streaks",
      "spotlight",
    ]),
    duration: finiteNumber.optional(),
    intensity: finiteNumber.optional(),
    target: z.enum(["background", "content", "all"]).optional(),
    params: z.record(z.string()).optional(),
  })
  .passthrough();

const segmentEffectSchema = z
  .object({
    segment: z.number().int().nonnegative(),
    background: nullableString.optional(),
    music: nullableString.optional(),
    ambient: nullableString.optional(),
    sfx: z.array(z.string().trim().min(1)).optional(),
    directions: z.array(directionSchema).optional(),
  })
  .passthrough();

const reputationChangeSchema = z
  .object({
    npcName: z.string().trim().min(1),
    action: z.string().trim().min(1),
  })
  .passthrough();

const illustrationSchema = z
  .object({
    segment: z.number().int().nonnegative().optional(),
    prompt: z.string().trim().min(1),
    characters: z.array(z.string().trim().min(1)).optional(),
    reason: z.string().optional(),
    slug: z.string().optional(),
  })
  .passthrough();

const spotifyTrackSchema = z.union([
  z.string().trim().min(1),
  z
    .object({
      uri: z.string().trim().min(1),
      name: z.string().optional().nullable(),
      artist: z.string().optional().nullable(),
      album: z.string().optional().nullable(),
    })
    .passthrough(),
]);

export const gameSceneAnalysisStructuredSchema = z
  .object({
    background: nullableString,
    weather: weatherSchema,
    timeOfDay: timeOfDaySchema,
    elapsedMinutes: finiteNumber.nullable().optional(),
    locationKind: z.enum(LOCATION_KINDS).nullable(),
    musicGenre: z.enum(MUSIC_GENRES).nullable().optional(),
    musicIntensity: z.enum(MUSIC_INTENSITIES).nullable().optional(),
    spotifyTrack: spotifyTrackSchema.nullable().optional(),
    reputationChanges: z.array(reputationChangeSchema),
    segmentEffects: z.array(segmentEffectSchema),
    directions: z.array(directionSchema).optional(),
    illustration: illustrationSchema.nullable().optional(),
  })
  .passthrough()
  .transform((value): GameSceneAnalysisJsonRecord => value as GameSceneAnalysisJsonRecord);

export const GAME_SCENE_ANALYSIS_SCHEMA_DESCRIPTION = JSON.stringify({
  background: "one provided background tag string or null",
  weather: "clear | cloudy | foggy | rainy | stormy | snowy | windy | frost | null",
  timeOfDay: "dawn | morning | noon | afternoon | evening | night | midnight | null",
  elapsedMinutes: "non-negative estimated in-world minutes for this player action, or null",
  locationKind: "interior | exterior | underground | urban | nature | null",
  musicGenre:
    "fantasy | horror | romance | mystery | scifi | modern | slice_of_life | adventure | drama | custom | null",
  musicIntensity: "calm | tense | intense | null",
  spotifyTrack: "one offered Spotify URI string/object or null",
  reputationChanges: [{ npcName: "non-empty string", action: "non-empty string" }],
  segmentEffects: [
    {
      segment: "non-negative integer",
      background: "string or null",
      sfx: ["string"],
      directions: [{ effect: "known direction effect", duration: "finite number" }],
    },
  ],
  directions: [{ effect: "known direction effect", duration: "finite number" }],
  illustration: null,
});
