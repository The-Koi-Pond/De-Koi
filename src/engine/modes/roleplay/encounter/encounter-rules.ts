// Response checks and fight rules for Roleplay encounters. A response is checked once, here; nothing
// made up stands in for missing results: a fight ends only on the model's word or on HP.
// Behavior spec: docs/provenance/roleplay-encounters.md ("Response contract", "Turns", decisions 1-4).
import { extractLeadingThinkingBlocks } from "../../../generation-core/llm/inline-thinking";
import { boolish, isRecord, readNumber, readString, type JsonRecord } from "../../../generation/runtime-records";
import { parseGameJsonish } from "../../../shared/parsing-jsonish";
import type { EncounterCast, EncounterSpell, EncounterTrackedContext } from "./encounter-context";
import type {
  EncounterAttack,
  EncounterAttackType,
  EncounterEnemy,
  EncounterFight,
  EncounterLogLine,
  EncounterPartyMember,
  EncounterPlayerActions,
  EncounterResult,
  EncounterStatus,
  EncounterStatusStat,
  EncounterStyleNotes,
  EncounterTurnOutcome,
} from "./encounter-types";

export const ENCOUNTER_HISTORY_DEPTH = 8;

export const DEFAULT_ENEMY_GLYPH = "👹";

const DEFAULT_MAX_HP = 24;
const MAX_ALLIES = 3;
const MAX_SPELL_ATTACKS = 6;
const SPELL_DESCRIPTION_LENGTH = 120;

const DEFAULT_STYLE_NOTES: EncounterStyleNotes = {
  environmentType: "plains",
  atmosphere: "tense",
  timeOfDay: "day",
  weather: "clear",
};

const ATTACK_TYPES: Record<string, EncounterAttackType> = {
  "single-target": "single-target",
  aoe: "AoE",
  both: "both",
};

const STATUS_STATS: readonly EncounterStatusStat[] = ["attack", "defense", "speed", "hp"];
const RESULTS: readonly EncounterResult[] = ["victory", "defeat", "fled", "interrupted"];
const TURN_KEYS = ["combatStats", "playerActions", "enemyActions", "partyActions", "narrative", "combatEnd", "result"];

function text(value: unknown): string {
  return readString(value).trim();
}

function optionalNumber(value: unknown): number | undefined {
  const parsed = readNumber(value, NaN);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isStatusStat(value: string): value is EncounterStatusStat {
  return STATUS_STATS.some((stat) => stat === value);
}

function isEncounterResult(value: string): value is EncounterResult {
  return RESULTS.some((result) => result === value);
}

/** The response's JSON object after leading thinking blocks, unwrapped from `wrapperKey`; null for junk. */
function readResponseObject(raw: string, wrapperKey: string): JsonRecord | null {
  let parsed: unknown;
  try {
    parsed = parseGameJsonish(extractLeadingThinkingBlocks(raw).cleanText);
  } catch {
    // Unparseable output is junk; the caller reports it without changing the fight.
    return null;
  }
  if (!isRecord(parsed)) return null;
  const wrapped = parsed[wrapperKey];
  return isRecord(wrapped) ? wrapped : parsed;
}

/** A checked list, or null when the field is missing so the caller keeps the old value (decision 2). */
function readList<T>(value: unknown, read: (entry: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  return value.map(read).filter((entry): entry is T => entry !== null);
}

function readAttack(value: unknown): EncounterAttack | null {
  const record = isRecord(value) ? value : { name: value };
  const name = text(record.name);
  if (!name) return null;
  const attack: EncounterAttack = { name, type: ATTACK_TYPES[text(record.type).toLowerCase()] ?? "single-target" };
  const description = text(record.description);
  const power = optionalNumber(record.power);
  const cooldown = optionalNumber(record.cooldown);
  const element = text(record.element);
  const statusEffect = text(record.statusEffect);
  if (description) attack.description = description;
  if (power !== undefined) attack.power = power;
  if (cooldown !== undefined) attack.cooldown = cooldown;
  if (element) attack.element = element;
  if (statusEffect) attack.statusEffect = statusEffect;
  return attack;
}

function readStatus(value: unknown): EncounterStatus | null {
  const record = isRecord(value) ? value : { name: value };
  const name = text(record.name);
  if (!name) return null;
  const status: EncounterStatus = { name, emoji: text(record.emoji), duration: optionalNumber(record.duration) ?? 1 };
  const modifier = optionalNumber(record.modifier);
  const stat = text(record.stat).toLowerCase();
  if (modifier !== undefined) status.modifier = modifier;
  if (isStatusStat(stat)) status.stat = stat;
  return status;
}

function readItem(value: unknown): string | null {
  return text(isRecord(value) ? value.name : value) || null;
}

function positive(value: number | undefined): number | undefined {
  return value !== undefined && value > 0 ? value : undefined;
}

function readHp(raw: JsonRecord, previous: { hp: number; maxHp: number } | undefined) {
  const returnedHp = optionalNumber(raw.hp);
  // A new combatant starts at full HP, so a usable hp stands in for a missing max before the last-resort 1.
  const maxHp = positive(optionalNumber(raw.maxHp)) ?? previous?.maxHp ?? positive(returnedHp) ?? 1;
  const hp = returnedHp ?? previous?.hp ?? maxHp;
  return { hp: Math.min(Math.max(hp, 0), maxHp), maxHp };
}

function mergePartyMember(raw: JsonRecord, previous?: EncounterPartyMember): EncounterPartyMember {
  return {
    // A matched combatant keeps its spelling; matching ignores case.
    name: previous?.name || text(raw.name) || "Unknown",
    ...readHp(raw, previous),
    attacks: readList(raw.attacks, readAttack) ?? previous?.attacks ?? [],
    items: readList(raw.items, readItem) ?? previous?.items ?? [],
    statuses: readList(raw.statuses, readStatus) ?? previous?.statuses ?? [],
    isPlayer: previous ? previous.isPlayer : boolish(raw.isPlayer),
  };
}

function mergeEnemy(raw: JsonRecord, previous?: EncounterEnemy): EncounterEnemy {
  return {
    name: previous?.name || text(raw.name) || "Enemy",
    ...readHp(raw, previous),
    attacks: readList(raw.attacks, readAttack) ?? previous?.attacks ?? [],
    statuses: readList(raw.statuses, readStatus) ?? previous?.statuses ?? [],
    description: text(raw.description) || previous?.description || "",
    sprite: text(raw.sprite) || previous?.sprite || "",
  };
}

/**
 * Matches returned combatants to current ones by name, any case (decision 3). A nameless entry falls back to its
 * position, and is dropped when that matches nobody. Left-out combatants stay unchanged; unmatched named ones come
 * back in `added`. Null when the field is missing.
 */
function matchCombatants<T extends { name: string }>(
  current: T[],
  returned: unknown,
  merge: (raw: JsonRecord, previous?: T) => T,
): { matched: T[]; added: T[] } | null {
  if (!Array.isArray(returned)) return null;
  const matched = [...current];
  const used = new Set<number>();
  const added: T[] = [];
  returned.filter(isRecord).forEach((raw, position) => {
    const name = text(raw.name).toLowerCase();
    const index = name
      ? current.findIndex((combatant, i) => !used.has(i) && combatant.name.toLowerCase() === name)
      : position < current.length && !used.has(position)
        ? position
        : -1;
    if (index < 0) {
      if (name) added.push(merge(raw));
      return;
    }
    used.add(index);
    matched[index] = merge(raw, current[index]);
  });
  return { matched, added };
}

/** Exactly one player: the first flagged one, else the one named like the persona, else the first (decision 4). */
function withOnePlayer(party: EncounterPartyMember[], personaName: string): EncounterPartyMember[] {
  const persona = personaName.toLowerCase();
  let index = party.findIndex((member) => member.isPlayer);
  if (index < 0 && persona) index = party.findIndex((member) => member.name.toLowerCase() === persona);
  if (index < 0) index = 0;
  return party.map((member, i) => ({ ...member, isPlayer: i === index }));
}

function playerActionsOf(party: EncounterPartyMember[]): EncounterPlayerActions {
  const player = party.find((member) => member.isPlayer);
  return { attacks: player?.attacks ?? [], items: player?.items ?? [] };
}

function readStyleNotes(value: unknown): EncounterStyleNotes {
  const notes = isRecord(value) ? value : {};
  return {
    environmentType: text(notes.environmentType) || DEFAULT_STYLE_NOTES.environmentType,
    atmosphere: text(notes.atmosphere) || DEFAULT_STYLE_NOTES.atmosphere,
    timeOfDay: text(notes.timeOfDay) || DEFAULT_STYLE_NOTES.timeOfDay,
    weather: text(notes.weather) || DEFAULT_STYLE_NOTES.weather,
  };
}

const BASIC_ATTACK: EncounterAttack = { name: "Attack", type: "single-target" };

export interface EncounterSetupGaps {
  party: EncounterPartyMember[];
  environment: string;
  personaName: string;
}

/** What fills a setup answer that parses but leaves the party or the environment out. */
export function encounterSetupGaps(
  cast: EncounterCast,
  tracked: EncounterTrackedContext,
  spellbook: EncounterSpell[],
): EncounterSetupGaps {
  const [playerCard, ...allyCards] = cast.legacyCards;
  const personaName = cast.persona?.name ?? "";
  const playerHp = cast.persona?.maxHp ?? playerCard?.maxHp ?? DEFAULT_MAX_HP;
  const spellAttacks = spellbook
    .filter((spell) => spell.name)
    .slice(0, MAX_SPELL_ATTACKS)
    .map((spell) => ({
      name: spell.name,
      type: "single-target" as const,
      ...(spell.content ? { description: spell.content.slice(0, SPELL_DESCRIPTION_LENGTH) } : {}),
    }));
  const inventory = tracked.inventory.map((item) => (item.quantity > 1 ? `${item.name} x${item.quantity}` : item.name));
  const player: EncounterPartyMember = {
    name: personaName || playerCard?.name || "Player",
    hp: playerHp,
    maxHp: playerHp,
    attacks: spellAttacks.length ? spellAttacks : [BASIC_ATTACK],
    items: inventory.length ? inventory : ["Healing Potion x1"],
    statuses: [],
    isPlayer: true,
  };
  const allySources = [
    ...cast.characters.map((character) => ({ name: character.name, maxHp: character.maxHp })),
    ...allyCards,
  ];
  const allies = allySources.slice(0, MAX_ALLIES).map((ally) => {
    const maxHp = ally.maxHp ?? DEFAULT_MAX_HP;
    return { name: ally.name, hp: maxHp, maxHp, attacks: [BASIC_ATTACK], items: [], statuses: [], isPlayer: false };
  });
  return {
    party: [player, ...allies],
    environment: tracked.location || cast.legacyMapName || "the current area",
    personaName,
  };
}

function defaultEnemy(): EncounterEnemy {
  return {
    name: "Enemy 1",
    hp: 18,
    maxHp: 18,
    attacks: [{ name: "Strike", type: "single-target" }],
    statuses: [],
    description: "",
    sprite: "",
  };
}

/** A checked fight from the setup answer, with gaps filled; null when the answer is junk. */
export function readSetupResponse(raw: string, gaps: EncounterSetupGaps): EncounterFight | null {
  const response = readResponseObject(raw, "combatState");
  if (!response) return null;
  const returnedParty = Array.isArray(response.party) ? response.party.filter(isRecord) : [];
  const returnedEnemies = Array.isArray(response.enemies) ? response.enemies.filter(isRecord) : [];
  const party = returnedParty.length
    ? withOnePlayer(
        returnedParty.map((member) => mergePartyMember(member)),
        gaps.personaName,
      )
    : gaps.party;
  return {
    party,
    enemies: returnedEnemies.length ? returnedEnemies.map((enemy) => mergeEnemy(enemy)) : [defaultEnemy()],
    environment: text(response.environment) || gaps.environment,
    styleNotes: readStyleNotes(response.styleNotes),
    playerActions: playerActionsOf(party),
  };
}

function readActions(value: unknown, nameKey: string, kind: "enemy" | "ally"): EncounterLogLine[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((entry) => ({ name: text(entry[nameKey]), action: text(entry.action) }))
    .filter((entry) => entry.name && entry.action)
    .map((entry) => ({ kind, text: `${entry.name}: ${entry.action}` }));
}

/**
 * Decision 1: the model's own `combatEnd` with a valid result, else HP alone. Only Conclude ends a fight as
 * interrupted, so a turn declaring it is ignored.
 */
function turnResult(response: JsonRecord, fight: EncounterFight): EncounterResult | null {
  const declared = text(response.result).toLowerCase();
  if (boolish(response.combatEnd) && isEncounterResult(declared) && declared !== "interrupted") return declared;
  if (fight.enemies.length > 0 && fight.enemies.every((enemy) => enemy.hp <= 0)) return "victory";
  if (fight.party.length > 0 && fight.party.every((member) => member.hp <= 0)) return "defeat";
  return null;
}

/** What the turn leaves out comes from the updated player, so a used-up item can't stay on a button. */
function nextPlayerActions(value: unknown, party: EncounterPartyMember[]): EncounterPlayerActions {
  const returned = isRecord(value) ? value : {};
  const fromPlayer = playerActionsOf(party);
  return {
    attacks: readList(returned.attacks, readAttack) ?? fromPlayer.attacks,
    items: readList(returned.items, readItem) ?? fromPlayer.items,
  };
}

/** The fight after one turn's answer; null when the answer is junk, so the caller changes nothing. */
export function readTurnResponse(raw: string, fight: EncounterFight, action: string): EncounterTurnOutcome | null {
  const response = readResponseObject(raw, "result");
  if (!response || !TURN_KEYS.some((key) => key in response)) return null;
  const stats = isRecord(response.combatStats) ? response.combatStats : {};
  const party = matchCombatants(fight.party, stats.party, mergePartyMember);
  const enemies = matchCombatants(fight.enemies, stats.enemies, mergeEnemy);
  const nextParty = party
    ? [...party.matched, ...party.added.map((member) => ({ ...member, isPlayer: false }))]
    : fight.party;
  const next: EncounterFight = {
    ...fight,
    party: nextParty,
    enemies: enemies ? [...enemies.matched, ...enemies.added] : fight.enemies,
    playerActions: nextPlayerActions(response.playerActions, nextParty),
  };
  const enemyLines = readActions(response.enemyActions, "enemyName", "enemy");
  const allyLines = readActions(response.partyActions, "memberName", "ally");
  const narrative = text(response.narrative);
  const narrationLines = narrative
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ kind: "narration" as const, text: line }));
  return {
    fight: next,
    round: {
      action,
      enemyActions: enemyLines.map((line) => line.text),
      partyActions: allyLines.map((line) => line.text),
      narrative: narrative || "Action resolved",
    },
    log: [...enemyLines, ...allyLines, ...narrationLines],
    result: turnResult(response, next),
  };
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const EMOJI_ONLY =
  /^(?=.*[\p{Extended_Pictographic}\p{Regional_Indicator}])[\p{Extended_Pictographic}\p{Emoji_Component}]+$/u;

/** The enemy's glyph: its `sprite` when that is one emoji, else the default (decision 8). */
export function encounterEnemyGlyph(sprite: string): string {
  const value = sprite.trim();
  const single = EMOJI_ONLY.test(value) && Array.from(graphemes.segment(value)).length === 1;
  return single ? value : DEFAULT_ENEMY_GLYPH;
}
