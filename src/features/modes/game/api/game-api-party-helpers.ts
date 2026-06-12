import * as g from "./game-api-support";

export function gameCardName(card: Record<string, unknown>, fallback: string): string {
  const value = card.name;
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function gameCardTextList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function gameCardRpgStatsPrompt(value: unknown): Record<string, unknown> {
  const stats = g.asRecord(value);
  const promptStats: Record<string, unknown> = {};
  const attributes = Array.isArray(stats.attributes)
    ? stats.attributes
        .map(g.asRecord)
        .map((attribute) => {
          const name = typeof attribute.name === "string" ? attribute.name.trim() : "";
          const numericValue = Number(attribute.value);
          const next: Record<string, unknown> = {};
          if (name) next.name = name;
          if (Number.isFinite(numericValue)) next.value = numericValue;
          return next;
        })
        .filter((attribute) => Object.keys(attribute).length > 0)
    : [];
  if (attributes.length) promptStats.attributes = attributes;

  const hp = g.asRecord(stats.hp);
  const promptHp: Record<string, number> = {};
  const hpValue = Number(hp.value);
  const hpMax = Number(hp.max);
  if (Number.isFinite(hpValue)) promptHp.value = hpValue;
  if (Number.isFinite(hpMax)) promptHp.max = hpMax;
  if (Object.keys(promptHp).length) promptStats.hp = promptHp;

  return promptStats;
}

export function gameCardPromptText(card: Record<string, unknown>): string {
  return JSON.stringify(
    {
      name: gameCardName(card, "Party member"),
      shortDescription: typeof card.shortDescription === "string" ? card.shortDescription : "",
      class: typeof card.class === "string" ? card.class : "",
      abilities: gameCardTextList(card.abilities),
      strengths: gameCardTextList(card.strengths),
      weaknesses: gameCardTextList(card.weaknesses),
      rpgStats: gameCardRpgStatsPrompt(card.rpgStats),
    },
    null,
    2,
  );
}

const PARTY_CARD_ATTRIBUTE_NAMES = ["STR", "DEX", "CON", "INT", "WIS", "CHA"] as const;

export function buildGameCard(characterName: string): Record<string, unknown> {
  return {
    name: characterName,
    shortDescription: "",
    class: "Adventurer",
    abilities: ["Attack", "Assist"],
    strengths: [],
    weaknesses: [],
    extra: {},
    rpgStats: {
      attributes: [
        { name: "STR", value: 10 },
        { name: "DEX", value: 10 },
        { name: "CON", value: 10 },
        { name: "INT", value: 10 },
        { name: "WIS", value: 10 },
        { name: "CHA", value: 10 },
      ],
      hp: { value: 20, max: 20 },
    },
  };
}

export function normalizedName(value: string): string {
  return value.trim().toLowerCase();
}

export function partyCardNameMatches(card: unknown, normalizedTargetName: string): boolean {
  return normalizedName(g.readTrimmed(g.asRecord(card).name)) === normalizedTargetName;
}

function gameCardTextListWithFallback(value: unknown, fallback: string[]): string[] {
  const entries = Array.isArray(value)
    ? value
        .map((entry) => (typeof entry === "string" || typeof entry === "number" ? String(entry).trim() : ""))
        .filter(Boolean)
    : [];
  return entries.length ? entries : fallback;
}

function gameCardExtra(value: unknown, fallback: Record<string, unknown>): Record<string, string> {
  const raw = g.asRecord(value);
  const fallbackRecord = g.asRecord(fallback);
  const entries = Object.entries(Object.keys(raw).length ? raw : fallbackRecord)
    .map(([key, entry]) => {
      const cleanKey = key.trim();
      const cleanValue =
        typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean"
          ? String(entry).trim()
          : "";
      return cleanKey && cleanValue ? ([cleanKey, cleanValue] as const) : null;
    })
    .filter((entry): entry is readonly [string, string] => entry !== null);
  return Object.fromEntries(entries);
}

function normalizePartyCardAttributes(value: unknown, fallback: unknown): Array<{ name: string; value: number }> {
  const fallbackAttributes = g.sheetAttributes(fallback) ?? [];
  const fallbackByName = new Map(fallbackAttributes.map((attr) => [normalizedName(attr.name), attr.value]));
  const generatedByName = new Map(
    (g.sheetAttributes(value) ?? []).map((attr) => [normalizedName(attr.name), attr.value]),
  );

  return PARTY_CARD_ATTRIBUTE_NAMES.map((name) => {
    const key = normalizedName(name);
    const rawValue = generatedByName.get(key) ?? fallbackByName.get(key) ?? 10;
    return { name, value: Math.max(1, Math.min(30, Math.round(rawValue))) };
  });
}

function normalizePartyCardHp(value: unknown, fallback: unknown): { value: number; max: number } {
  const record = g.asRecord(value);
  const fallbackRecord = g.asRecord(fallback);
  const max = Math.max(1, Math.min(999, Math.round(g.readNumber(record.max, g.readNumber(fallbackRecord.max, 20)))));
  const current = Math.max(
    0,
    Math.min(max, Math.round(g.readNumber(record.value, g.readNumber(fallbackRecord.value, max)))),
  );
  return { value: current, max };
}

export function normalizeGeneratedPartyCard(
  raw: Record<string, unknown>,
  fallback: Record<string, unknown>,
  characterName: string,
): Record<string, unknown> {
  const rawStats = g.asRecord(raw.rpgStats);
  const fallbackStats = g.asRecord(fallback.rpgStats);
  return {
    name: characterName,
    shortDescription: g.readTrimmed(raw.shortDescription) || g.readTrimmed(fallback.shortDescription),
    class: g.readTrimmed(raw.class) || g.readTrimmed(fallback.class) || "Companion",
    abilities: gameCardTextListWithFallback(raw.abilities, gameCardTextListWithFallback(fallback.abilities, [])),
    strengths: gameCardTextListWithFallback(raw.strengths, gameCardTextListWithFallback(fallback.strengths, [])),
    weaknesses: gameCardTextListWithFallback(raw.weaknesses, gameCardTextListWithFallback(fallback.weaknesses, [])),
    extra: gameCardExtra(raw.extra, g.asRecord(fallback.extra)),
    rpgStats: {
      attributes: normalizePartyCardAttributes(rawStats.attributes, fallbackStats.attributes),
      hp: normalizePartyCardHp(rawStats.hp, fallbackStats.hp),
    },
  };
}

export function gameCardByName(cards: unknown[], characterName: string): Record<string, unknown> | null {
  const targetName = normalizedName(characterName);
  for (const item of cards) {
    const record = g.asRecord(item);
    if (normalizedName(g.readTrimmed(record.name)) === targetName) return record;
  }
  return null;
}

function compactCharacterPromptRecord(record: Record<string, unknown>, fallbackName: string): string {
  const data = g.asRecord(record.data);
  const extensions = g.asRecord(data.extensions);
  const promptRecord = {
    name: g.recordName(record) || fallbackName,
    description: g.readTrimmed(data.description),
    personality: g.readTrimmed(data.personality),
    scenario: g.readTrimmed(data.scenario),
    systemPrompt: g.readTrimmed(data.system_prompt),
    backstory: g.readTrimmed(extensions.backstory),
    appearance: g.readTrimmed(extensions.appearance),
    tags: g.stringArray(data.tags),
  };
  return JSON.stringify(promptRecord, null, 2);
}

function compactNpcPromptRecord(record: Record<string, unknown>, fallbackName: string): string {
  return JSON.stringify(
    {
      name: g.readTrimmed(record.name) || fallbackName,
      description: g.readTrimmed(record.description),
      location: g.readTrimmed(record.location),
      notes: Array.isArray(record.notes) ? record.notes.map(String).filter(Boolean).slice(0, 8) : [],
      reputation: Number.isFinite(Number(record.reputation)) ? Number(record.reputation) : null,
    },
    null,
    2,
  );
}

export async function targetPartyCardPromptContext(
  chat: g.Chat,
  meta: Record<string, unknown>,
  characterName: string,
  characterId?: string,
): Promise<string> {
  const candidateIds = [
    ...(characterId ? [characterId] : []),
    ...(Array.isArray(chat.characterIds) ? chat.characterIds : []),
  ].filter((id): id is string => typeof id === "string" && id.trim().length > 0 && !id.startsWith("npc:"));
  const uniqueIds = [...new Set(candidateIds)];
  const characterRows = await Promise.all(
    uniqueIds.map((id) => g.storageApi.get<Record<string, unknown>>("characters", id).catch(() => null)),
  );
  const targetName = normalizedName(characterName);
  const characterRecord =
    characterRows.find(
      (row): row is Record<string, unknown> => !!row && normalizedName(g.recordName(row)) === targetName,
    ) ?? null;
  if (characterRecord) return compactCharacterPromptRecord(characterRecord, characterName);

  const npcs = Array.isArray(meta.gameNpcs) ? meta.gameNpcs.map(g.asRecord) : [];
  const npc = npcs.find((row) => normalizedName(g.readTrimmed(row.name)) === targetName);
  if (npc) return compactNpcPromptRecord(npc, characterName);

  return JSON.stringify(
    {
      name: characterName,
      note: "No library character or tracked NPC record was found. Infer the new companion from campaign context and recent transcript.",
    },
    null,
    2,
  );
}

export function currentPartyNames(cards: unknown[]): string[] {
  return cards.map((item) => g.readTrimmed(g.asRecord(item).name)).filter(Boolean);
}

export function partyCardCurrentState(chat: g.Chat, meta: Record<string, unknown>): string {
  const gameState = g.asRecord((chat as { gameState?: unknown }).gameState);
  const activeMap = g.asRecord(meta.gameMap);
  return JSON.stringify(
    {
      sessionNumber: Number(meta.gameSessionNumber ?? 1),
      activeState: g.readTrimmed(meta.gameActiveState),
      location: g.readTrimmed(gameState.location) || g.readTrimmed(activeMap.name),
      time: g.readTrimmed(gameState.time) || g.readTrimmed(meta.gameTimeFormatted),
      weather: gameState.weather ?? meta.gameWeather ?? null,
      playerNotes: g.readTrimmed(meta.gamePlayerNotes),
    },
    null,
    2,
  );
}

export async function partySpriteSubjects(
  partyIds: string[],
  cards: Array<Record<string, unknown>>,
): Promise<g.CharacterSpriteSubject[]> {
  const subjects: g.CharacterSpriteSubject[] = [];
  let cardIndex = 0;

  for (const id of partyIds) {
    if (id.startsWith("npc:")) continue;

    const cardName = gameCardName(cards[cardIndex] ?? {}, `Party member ${cardIndex + 1}`);
    cardIndex += 1;
    const character = await g.storageApi.get<Record<string, unknown>>("characters", id).catch(() => null);
    const name = character ? g.recordName(character) || cardName : cardName;
    if (name) subjects.push({ id, name });
  }

  return subjects;
}
