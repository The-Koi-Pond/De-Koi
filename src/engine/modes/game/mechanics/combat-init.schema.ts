import { z } from "zod";

export type CombatInitJsonRecord = Record<string, unknown>;

const nonEmptyString = z.string().trim().min(1);
const finiteNumber = z.number().finite();
const positiveFiniteNumber = finiteNumber.positive();

const combatAttackSchema = z
  .object({
    name: nonEmptyString,
    type: z.enum(["single-target", "AoE", "both"]).optional(),
    description: z.string().optional(),
    power: finiteNumber.optional(),
    cooldown: finiteNumber.optional(),
    element: z.string().optional(),
    statusEffect: z.string().optional(),
  })
  .passthrough();

const combatStatusSchema = z
  .object({
    name: nonEmptyString,
    emoji: z.string().optional(),
    duration: finiteNumber.optional(),
    modifier: finiteNumber.optional(),
    stat: z.enum(["attack", "defense", "speed", "hp"]).optional(),
  })
  .passthrough();

const combatPartyMemberSchema = z
  .object({
    name: nonEmptyString,
    hp: finiteNumber,
    maxHp: positiveFiniteNumber,
    attacks: z.array(combatAttackSchema).optional(),
    items: z.array(z.string()).optional(),
    statuses: z.array(combatStatusSchema).optional(),
    isPlayer: z.boolean().optional(),
  })
  .passthrough();

const combatEnemySchema = z
  .object({
    name: nonEmptyString,
    hp: finiteNumber,
    maxHp: positiveFiniteNumber,
    attacks: z.array(combatAttackSchema).optional(),
    statuses: z.array(combatStatusSchema).optional(),
    description: z.string().optional(),
    sprite: z.string().optional(),
  })
  .passthrough();

const combatStyleNotesSchema = z
  .object({
    environmentType: z.string().optional(),
    atmosphere: z.string().optional(),
    timeOfDay: z.string().optional(),
    weather: z.string().optional(),
  })
  .passthrough();

const combatItemEffectSchema = z
  .object({
    name: nonEmptyString,
    target: z.enum(["self", "ally", "enemy", "any"]),
    type: z.enum(["heal", "damage", "buff", "debuff", "status", "utility"]),
    description: nonEmptyString,
    power: finiteNumber.optional(),
    element: z.string().optional(),
    status: combatStatusSchema.optional(),
    consumes: z.boolean().optional(),
  })
  .passthrough();

const combatDialogueCueSchema = z
  .object({
    speaker: nonEmptyString,
    content: nonEmptyString,
    type: z.enum(["main", "side", "extra", "thought", "whisper"]),
    expression: z.string().optional(),
    target: z.string().optional(),
    trigger: z.enum([
      "intro",
      "round",
      "attack",
      "hit",
      "charge",
      "phase_75",
      "phase_50",
      "phase_25",
      "low_hp",
      "victory",
      "defeat",
    ]),
    round: finiteNumber.optional(),
    everyNRounds: finiteNumber.optional(),
  })
  .passthrough();

const combatMechanicSchema = z
  .object({
    name: nonEmptyString,
    description: nonEmptyString,
    ownerName: z.string().optional(),
    trigger: z.enum(["round_interval", "hp_threshold", "on_hit", "on_attack", "passive"]),
    interval: finiteNumber.optional(),
    hpThreshold: finiteNumber.optional(),
    counterplay: z.string().optional(),
    effectType: z
      .enum(["damage_all", "damage_one", "buff_self", "debuff_party", "status_party", "status_enemy"])
      .optional(),
    power: finiteNumber.optional(),
    element: z.string().optional(),
    status: combatStatusSchema.optional(),
  })
  .passthrough();

const combatVisualRequestSchema = z
  .object({
    isBossFight: z.boolean().optional(),
    enemyImagePrompts: z.array(z.object({ name: nonEmptyString, prompt: nonEmptyString }).passthrough()).optional(),
    backgroundPrompt: z.string().optional(),
    illustrationPrompt: z.string().optional(),
    slug: z.string().optional(),
  })
  .passthrough();

const combatInitStateSchema = z
  .object({
    party: z.array(combatPartyMemberSchema).min(1),
    enemies: z.array(combatEnemySchema).min(1),
    environment: z.string().optional(),
    styleNotes: combatStyleNotesSchema.optional(),
    itemEffects: z.array(combatItemEffectSchema).optional(),
    dialogueCues: z.array(combatDialogueCueSchema).optional(),
    mechanics: z.array(combatMechanicSchema).optional(),
    visuals: combatVisualRequestSchema.optional(),
  })
  .passthrough();

export const combatInitStructuredSchema = z
  .union([z.object({ combatState: combatInitStateSchema }).passthrough(), combatInitStateSchema])
  .transform(
    (value): CombatInitJsonRecord => ("combatState" in value ? value.combatState : value) as CombatInitJsonRecord,
  );

export const COMBAT_INIT_SCHEMA_DESCRIPTION = JSON.stringify({
  party: [
    {
      name: "non-empty string",
      hp: "finite number",
      maxHp: "positive finite number",
      attacks: [{ name: "non-empty string", type: "single-target | AoE | both" }],
      items: ["string"],
      statuses: [],
      isPlayer: true,
    },
  ],
  enemies: [
    {
      name: "non-empty string",
      hp: "finite number",
      maxHp: "positive finite number",
      attacks: [{ name: "non-empty string", type: "single-target | AoE | both" }],
      statuses: [],
      description: "string",
      sprite: "string",
    },
  ],
  environment: "string",
  styleNotes: {
    environmentType: "string",
    atmosphere: "string",
    timeOfDay: "string",
    weather: "string",
  },
  itemEffects: [],
  mechanics: [],
  dialogueCues: [],
  visuals: { isBossFight: false, enemyImagePrompts: [] },
});
