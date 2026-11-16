// Prompts for the three encounter model calls: setup, one per turn, and the summary.
// Behavior spec: docs/provenance/roleplay-encounters.md ("Setting up the fight", "Turns", "Ending").
import type { LlmMessage } from "../../../capabilities/llm";
import type { EncounterCast, EncounterSpell, EncounterTrackedContext } from "./encounter-context";
import type { EncounterFight, EncounterNarrationStyle, EncounterResult, EncounterRound } from "./encounter-types";

const ATTACK_SHAPE = `{ "name": "string", "type": "single-target|AoE|both", "description": "string", "power": number, "cooldown": number, "element": "string", "statusEffect": "string" }`;
const STATUS_SHAPE = `{ "name": "string", "emoji": "one emoji", "duration": number of turns left, "modifier": number, "stat": "attack|defense|speed|hp" }`;
const PARTY_MEMBER_SHAPE = `{ "name": "string", "hp": number, "maxHp": number, "attacks": [${ATTACK_SHAPE}], "items": ["string"], "statuses": [${STATUS_SHAPE}], "isPlayer": boolean }`;
const ENEMY_SHAPE = `{ "name": "string", "hp": number, "maxHp": number, "attacks": [${ATTACK_SHAPE}], "statuses": [${STATUS_SHAPE}], "description": "string", "sprite": "one emoji" }`;

const SETUP_SHAPE = `{
  "party": [${PARTY_MEMBER_SHAPE}],
  "enemies": [${ENEMY_SHAPE}],
  "environment": "one sentence describing where the fight happens",
  "styleNotes": { "environmentType": "forest|dungeon|desert|cave|city|ruins|snow|water|castle|wasteland|plains|mountains|swamp|volcanic|spaceship|mansion", "atmosphere": "string", "timeOfDay": "string", "weather": "string" }
}`;

const TURN_SHAPE = `{
  "combatStats": { "party": [${PARTY_MEMBER_SHAPE}], "enemies": [${ENEMY_SHAPE}] },
  "playerActions": { "attacks": [${ATTACK_SHAPE}], "items": ["string"] },
  "enemyActions": [{ "enemyName": "string", "action": "what the enemy does", "target": "string" }],
  "partyActions": [{ "memberName": "string", "action": "what the ally does", "target": "string" }],
  "narrative": "the round's narration",
  "combatEnd": false,
  "result": "victory|defeat|fled (only when combatEnd is true)"
}`;

function playerName(cast: EncounterCast): string {
  return cast.persona?.name || "the player character";
}

function labeled(label: string, value: string): string[] {
  return value ? [`${label}: ${value}`] : [];
}

function personaBlock(cast: EncounterCast): string {
  const persona = cast.persona;
  if (!persona) return "The player (persona): no persona details.";
  const bars = persona.statBars.map((bar) => `${bar.name} (max ${bar.max})`).join(", ");
  return [
    "The player (persona):",
    ...labeled("Name", persona.name),
    ...labeled("Description", persona.description),
    ...labeled("Personality", persona.personality),
    ...labeled("Backstory", persona.backstory),
    ...labeled("Appearance", persona.appearance),
    ...labeled("Stat bars", bars),
    ...labeled("Max HP", persona.maxHp === null ? "" : String(persona.maxHp)),
  ].join("\n");
}

function charactersBlock(cast: EncounterCast): string {
  const characters = cast.characters.map((character) =>
    [
      `- ${character.name}`,
      ...labeled("  Description", character.description),
      ...labeled("  Personality", character.personality),
      ...labeled("  Scenario", character.scenario),
      ...labeled("  Max HP", character.maxHp === null ? "" : String(character.maxHp)),
      ...labeled("  Attributes", character.attributes.map((a) => `${a.name} ${a.value}`).join(", ")),
    ].join("\n"),
  );
  const cards = cast.legacyCards.map(
    (card, index) => `- ${card.name}${index === 0 ? " (the player)" : ""}${card.maxHp ? `, max HP ${card.maxHp}` : ""}`,
  );
  return [
    "Characters:",
    ...(characters.length ? characters : ["(none)"]),
    ...(cards.length ? ["Party cards from this chat:", ...cards] : []),
    ...labeled("Map", cast.legacyMapName),
  ].join("\n");
}

function trackedBlock(tracked: EncounterTrackedContext): string {
  const inventory = tracked.inventory.map((item) => (item.quantity > 1 ? `${item.name} x${item.quantity}` : item.name));
  const present = tracked.presentCharacters.map((character) =>
    [character.name, character.mood && `mood: ${character.mood}`, character.action && `doing: ${character.action}`]
      .filter(Boolean)
      .join(", "),
  );
  const lines = [
    ...labeled("Location", tracked.location),
    ...labeled("Weather", tracked.weather),
    ...labeled("Time", tracked.time),
    ...labeled("Date", tracked.date),
    ...labeled("Inventory", inventory.join(", ")),
    ...labeled("Player attributes", tracked.attributes.map((a) => `${a.name} ${a.value}`).join(", ")),
    ...labeled("Present characters", present.join("; ")),
  ];
  return ["Tracked scene:", ...(lines.length ? lines : ["(nothing tracked)"])].join("\n");
}

function spellbookBlock(spellbook: EncounterSpell[]): string {
  if (!spellbook.length) return "";
  return ["Spellbook (the spells and abilities available in this fight):", ...spellbook.map(spellLine)].join("\n");
}

function spellLine(spell: EncounterSpell): string {
  return `- ${spell.name}${spell.content ? `: ${spell.content}` : ""}`;
}

function narrationStyle(style: EncounterNarrationStyle): string {
  return `Write in the ${style.tense} tense, in the ${style.person} person, with ${style.narration} narration, from the point of view of ${style.pov.trim() || "narrator"}.`;
}

function roundsBlock(rounds: EncounterRound[]): string {
  if (!rounds.length) return "No detailed combat rounds were recorded.";
  return rounds
    .map((round, index) =>
      [
        `Round ${index + 1}`,
        `Player action: ${round.action}`,
        ...labeled("Enemy actions", round.enemyActions.join("; ")),
        ...labeled("Ally actions", round.partyActions.join("; ")),
        `Narration: ${round.narrative}`,
      ].join("\n"),
    )
    .join("\n\n");
}

function joinBlocks(blocks: string[]): string {
  return blocks.filter(Boolean).join("\n\n");
}

export interface EncounterSetupPromptInput {
  cast: EncounterCast;
  tracked: EncounterTrackedContext;
  spellbook: EncounterSpell[];
  history: LlmMessage[];
}

export function buildSetupMessages(input: EncounterSetupPromptInput): LlmMessage[] {
  const player = playerName(input.cast);
  const system = joinBlocks([
    `You are the game master starting a turn-based combat encounter inside an ongoing roleplay. The user plays ${player}.`,
    [
      "Build the fight from the context and the recent story:",
      `- party: ${player} (with "isPlayer": true) plus the allies who would fight alongside them.`,
      "- enemies: who the party is fighting. Give each enemy one emoji as its sprite.",
      "- When the context gives a combatant's max HP, use it exactly as maxHp.",
      "- Everyone starts at full HP: hp equals maxHp.",
      "- Attack types are single-target, AoE (hits every enemy) or both.",
      "- Write names, descriptions and the environment in the same language as the chat.",
    ].join("\n"),
    personaBlock(input.cast),
    charactersBlock(input.cast),
    trackedBlock(input.tracked),
    spellbookBlock(input.spellbook),
    `Reply with one JSON object in this shape and nothing else:\n${SETUP_SHAPE}`,
  ]);
  return [
    { role: "system", content: system },
    ...input.history,
    { role: "user", content: "Start the combat encounter now. Reply with the JSON object only." },
  ];
}

export interface EncounterTurnPromptInput {
  cast: EncounterCast;
  spellbook: EncounterSpell[];
  history: LlmMessage[];
  rounds: EncounterRound[];
  fight: EncounterFight;
  action: string;
  style: EncounterNarrationStyle;
}

function fightStateBlock(fight: EncounterFight): string {
  return `Current state:\n${JSON.stringify(
    {
      environment: fight.environment,
      party: fight.party,
      enemies: fight.enemies,
      playerActions: fight.playerActions,
    },
    null,
    2,
  )}`;
}

export function buildTurnMessages(input: EncounterTurnPromptInput): LlmMessage[] {
  const player = playerName(input.cast);
  const system = joinBlocks([
    `You are the game master of a turn-based combat encounter inside an ongoing roleplay. The user plays ${player}. Never act, speak, think or decide for ${player}: their action for this round is given to you.`,
    [
      "Resolve the player's action, then decide what every enemy and every ally does this round.",
      "Return every combatant with updated hp and statuses. Lower each status's duration as turns pass and leave out statuses that wore off. Leave out items that were used up.",
      "playerActions lists the attacks and items the player can use next round.",
      'End rules: when every enemy is at 0 HP, set "combatEnd": true and "result": "victory". When every party member is at 0 HP, set "combatEnd": true and "result": "defeat". When the player escapes, set "combatEnd": true and "result": "fled". Otherwise set "combatEnd": false.',
      `Narration: ${narrationStyle(input.style)} Keep it under 150 words, use no asterisks, and write in the same language as the chat.`,
    ].join("\n"),
    personaBlock(input.cast),
    charactersBlock(input.cast),
    spellbookBlock(input.spellbook),
  ]);
  const request = joinBlocks([
    `Earlier rounds of this fight:\n${roundsBlock(input.rounds)}`,
    fightStateBlock(input.fight),
    `${player}'s action: ${input.action}`,
    `Reply with one JSON object in this shape and nothing else:\n${TURN_SHAPE}`,
  ]);
  return [{ role: "system", content: system }, ...input.history, { role: "user", content: request }];
}

export interface EncounterSummaryPromptInput {
  cast: EncounterCast;
  result: EncounterResult;
  rounds: EncounterRound[];
  style: EncounterNarrationStyle;
}

export function buildSummaryMessages(input: EncounterSummaryPromptInput): LlmMessage[] {
  const player = playerName(input.cast);
  const system = joinBlocks([
    `You write the story of a combat encounter that just ended inside an ongoing roleplay. The user plays ${player}.`,
    [
      "Write a narrative summary of the whole fight, from the first round to the outcome.",
      `Tell ${player}'s actions in indirect speech; never quote ${player}.`,
      "Include dialogue only when the fight record has it.",
      narrationStyle(input.style),
      "Write in the same language as the fight record.",
      "Reply with only the summary text: no title, notes or markers.",
    ].join("\n"),
    personaBlock(input.cast),
    charactersBlock(input.cast),
  ]);
  const request = joinBlocks([`Result: ${input.result}`, `Fight record:\n${roundsBlock(input.rounds)}`]);
  return [
    { role: "system", content: system },
    { role: "user", content: request },
  ];
}
