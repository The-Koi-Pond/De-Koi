import { z } from "zod";

export type CombatInitJsonRecord = Record<string, unknown>;

const nonEmptyString = z.string().trim().min(1);
const finiteNumber = z.number().finite();
const positiveFiniteNumber = finiteNumber.positive();

// Only the encounter core (who fights, with what HP) is validated strictly.
// Attacks, statuses, item effects, dialogue cues, mechanics and visuals are
// optional per-entry extras: the service sanitizer coerces or drops entries
// that don't fit, so one off-list enum value can't reject a whole encounter.
const optionalEntries = z.array(z.unknown()).optional();

const combatPartyMemberSchema = z
  .object({
    name: nonEmptyString,
    hp: finiteNumber,
    maxHp: positiveFiniteNumber,
    attacks: optionalEntries,
    items: z.array(z.unknown()).optional(),
    statuses: optionalEntries,
    isPlayer: z.boolean().optional(),
  })
  .passthrough();

const combatEnemySchema = z
  .object({
    name: nonEmptyString,
    hp: finiteNumber,
    maxHp: positiveFiniteNumber,
    attacks: optionalEntries,
    statuses: optionalEntries,
    description: z.string().optional(),
    sprite: z.string().optional(),
  })
  .passthrough();

const combatInitStateSchema = z
  .object({
    party: z.array(combatPartyMemberSchema).min(1),
    enemies: z.array(combatEnemySchema).min(1),
    environment: z.string().optional(),
    styleNotes: z.record(z.unknown()).optional(),
    itemEffects: optionalEntries,
    dialogueCues: optionalEntries,
    mechanics: optionalEntries,
    visuals: z.record(z.unknown()).optional(),
  })
  .passthrough();

export const combatInitStructuredSchema = z.union([
  combatInitStateSchema.transform((value): CombatInitJsonRecord => value as CombatInitJsonRecord),
  z
    .object({ combatState: combatInitStateSchema })
    .passthrough()
    .transform((value): CombatInitJsonRecord => value.combatState as CombatInitJsonRecord),
]);

const COMBAT_STATUS_DESCRIPTION = {
  name: "non-empty string",
  emoji: "string",
  duration: "rounds, finite number",
  modifier: "finite number",
  stat: "attack | defense | speed | hp",
};

export const COMBAT_INIT_SCHEMA_DESCRIPTION = JSON.stringify({
  party: [
    {
      name: "non-empty string",
      hp: "finite number",
      maxHp: "positive finite number",
      attacks: [
        {
          name: "non-empty string",
          type: "single-target | AoE | both (targeting only; describe heals or buffs in description)",
          description: "string",
          power: "finite number",
          cooldown: "finite number",
        },
      ],
      items: ["string"],
      statuses: [COMBAT_STATUS_DESCRIPTION],
      isPlayer: true,
    },
  ],
  enemies: [
    {
      name: "non-empty string",
      hp: "finite number",
      maxHp: "positive finite number",
      attacks: [{ name: "non-empty string", type: "single-target | AoE | both" }],
      statuses: [COMBAT_STATUS_DESCRIPTION],
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
  itemEffects: [
    {
      name: "item name, matching a party item",
      target: "self | ally | enemy | any",
      type: "heal | damage | buff | debuff | status | utility",
      description: "non-empty string",
      power: "finite number",
      consumes: true,
    },
  ],
  mechanics: [
    {
      name: "non-empty string",
      description: "non-empty string",
      ownerName: "enemy name",
      trigger: "round_interval | hp_threshold | on_hit | on_attack | passive",
      interval: "finite number",
      hpThreshold: "finite number",
      counterplay: "string",
      effectType: "damage_all | damage_one | buff_self | debuff_party | status_party | status_enemy",
      power: "finite number",
    },
  ],
  dialogueCues: [
    {
      speaker: "non-empty string",
      content: "non-empty string",
      type: "main | side | extra | thought | whisper",
      trigger: "intro | round | attack | hit | charge | phase_75 | phase_50 | phase_25 | low_hp | victory | defeat",
      round: "finite number",
    },
  ],
  visuals: { isBossFight: false, enemyImagePrompts: [{ name: "enemy name", prompt: "string" }] },
});
