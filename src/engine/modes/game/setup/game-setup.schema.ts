import { z } from "zod";

export type GameSetupJsonRecord = Record<string, unknown>;

const nonEmptyString = z.string().trim().min(1);
const finiteNumber = z.number().finite();

const mapRegionSchema = z
  .object({
    id: z.string().optional(),
    name: nonEmptyString,
    description: z.string().optional(),
    type: z.string().optional(),
    connectedTo: z.array(z.string()).optional(),
    discovered: z.boolean().optional(),
  })
  .passthrough();

const startingMapSchema = z
  .object({
    name: nonEmptyString,
    description: z.string().optional(),
    regions: z.array(mapRegionSchema).optional(),
  })
  .passthrough();

const startingNpcSchema = z
  .object({
    name: nonEmptyString,
    role: z.string().optional(),
    description: z.string().optional(),
    location: z.string().optional(),
    reputation: finiteNumber.optional(),
  })
  .passthrough();

const partyArcSchema = z
  .object({
    name: nonEmptyString,
    arc: z.string().optional(),
    goal: z.string().optional(),
  })
  .passthrough();

const characterCardSchema = z
  .object({
    name: nonEmptyString,
    shortDescription: z.string().optional(),
    class: z.string().optional(),
    abilities: z.array(z.string()).optional(),
    strengths: z.array(z.string()).optional(),
    weaknesses: z.array(z.string()).optional(),
    extra: z.record(z.unknown()).optional(),
  })
  .passthrough();

const pressureClockSchema = z
  .object({
    name: nonEmptyString,
    steps: z.number().int().min(1).max(12),
    current: z.number().int().min(0),
    failure: z.string().optional(),
  })
  .passthrough()
  .refine((clock) => clock.current <= clock.steps, {
    message: "current must be less than or equal to steps",
    path: ["current"],
  });

const factionSchema = z
  .object({
    name: nonEmptyString,
    goal: z.string().optional(),
    method: z.string().optional(),
    secret: z.string().optional(),
  })
  .passthrough();

const campaignPlanSchema = z
  .object({
    openingSituation: z.string().optional(),
    pressureClocks: z.array(pressureClockSchema).max(2).optional(),
    factions: z.array(factionSchema).max(2).optional(),
    questSeeds: z.array(z.string()).max(3).optional(),
    encounterPrinciples: z.array(z.string()).max(2).optional(),
  })
  .passthrough();

const blueprintSchema = z
  .object({
    campaignPlan: campaignPlanSchema.optional(),
    hudWidgets: z.array(z.record(z.unknown())).optional(),
    introSequence: z.array(z.record(z.unknown())).optional(),
    visualTheme: z.record(z.unknown()).optional(),
  })
  .passthrough();

export const gameSetupStructuredSchema = z
  .object({
    worldOverview: nonEmptyString,
    storyArc: z.string().nullable(),
    plotTwists: z.array(z.string()),
    startingMap: startingMapSchema,
    startingNpcs: z.array(startingNpcSchema),
    partyArcs: z.array(partyArcSchema),
    characterCards: z.array(characterCardSchema),
    artStylePrompt: z.string().optional().nullable(),
    blueprint: blueprintSchema,
  })
  .passthrough()
  .transform((value): GameSetupJsonRecord => value as GameSetupJsonRecord);

export const GAME_SETUP_SCHEMA_DESCRIPTION = JSON.stringify({
  worldOverview: "non-empty string",
  storyArc: "string or null",
  plotTwists: ["string"],
  startingMap: {
    name: "non-empty string",
    description: "string",
    regions: [{ id: "string", name: "non-empty string", connectedTo: ["string"], discovered: true }],
  },
  startingNpcs: [{ name: "non-empty string", role: "string", description: "string", reputation: "finite number" }],
  partyArcs: [{ name: "non-empty string", arc: "string", goal: "string" }],
  characterCards: [{ name: "non-empty string", abilities: ["string"], strengths: ["string"], weaknesses: ["string"] }],
  artStylePrompt: "string or null",
  blueprint: {
    campaignPlan: {
      pressureClocks: "max 2, steps 1-12, current <= steps",
      factions: "max 2",
      questSeeds: "max 3 strings",
      encounterPrinciples: "max 2 strings",
    },
    hudWidgets: [],
    introSequence: [],
    visualTheme: {},
  },
});
