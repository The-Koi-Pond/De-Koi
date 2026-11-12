// What an encounter's model calls read from the chat: persona, characters, tracker, spellbook and
// recent history. Everything here is read-only; an encounter never writes these.
import type { LlmMessage } from "../../../capabilities/llm";
import type { StorageGateway } from "../../../capabilities/storage";
import {
  boolish,
  hiddenFromAi,
  isRecord,
  parseArray,
  parseRecord,
  readNumber,
  readString,
  stringArray,
  type JsonRecord,
} from "../../../generation/runtime-records";

interface EncounterPersona {
  name: string;
  description: string;
  personality: string;
  backstory: string;
  appearance: string;
  statBars: Array<{ name: string; max: number }>;
  maxHp: number | null;
}

interface EncounterCharacter {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  maxHp: number | null;
  attributes: Array<{ name: string; value: number }>;
}

export interface EncounterCast {
  persona: EncounterPersona | null;
  characters: EncounterCharacter[];
  /** Old Game-mode chats keep their party in `metadata.gameCharacterCards`; the first card is the player. */
  legacyCards: Array<{ name: string; maxHp: number | null }>;
  legacyMapName: string;
}

const PLAYER_ATTRIBUTE_KEYS = ["str", "dex", "con", "int", "wis", "cha"] as const;

export interface EncounterTrackedContext {
  location: string;
  weather: string;
  time: string;
  date: string;
  inventory: Array<{ name: string; quantity: number }>;
  attributes: Array<{ name: string; value: number }>;
  presentCharacters: Array<{ name: string; mood: string; action: string }>;
}

export interface EncounterSpell {
  name: string;
  content: string;
}

const HP_BAR_NAME = /^(hp|health|hit points?)$/i;

function text(value: unknown): string {
  return readString(value).trim();
}

function positiveNumber(value: unknown): number | null {
  const parsed = readNumber(value, NaN);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function loadPersona(storage: StorageGateway, chat: JsonRecord): Promise<EncounterPersona | null> {
  const personaId = text(chat.personaId);
  const row = personaId
    ? await storage.get<unknown>("personas", personaId)
    : (await storage.list<unknown>("personas")).find((persona) => isRecord(persona) && boolish(persona.isActive));
  if (!isRecord(row)) return null;

  const stats = parseRecord(row.personaStats);
  const statBars = boolish(stats.enabled)
    ? parseArray(stats.bars)
        .filter(isRecord)
        .map((bar) => ({ name: text(bar.name), max: readNumber(bar.max, 0) }))
        .filter((bar) => bar.name)
    : [];
  const hpBar = statBars.find((bar) => HP_BAR_NAME.test(bar.name));
  return {
    name: text(row.name),
    description: text(row.description),
    personality: text(row.personality),
    backstory: text(row.backstory),
    appearance: text(row.appearance),
    statBars,
    maxHp: hpBar ? positiveNumber(hpBar.max) : null,
  };
}

async function loadCharacter(storage: StorageGateway, id: string): Promise<EncounterCharacter | null> {
  const row = await storage.get<unknown>("characters", id);
  if (!isRecord(row)) return null;
  const data = parseRecord(row.data);
  const rpgStats = parseRecord(parseRecord(data.extensions).rpgStats);
  const rpgEnabled = boolish(rpgStats.enabled);
  return {
    name: text(data.name) || "Unknown",
    description: text(data.description),
    personality: text(data.personality),
    scenario: text(data.scenario),
    maxHp: rpgEnabled ? positiveNumber(parseRecord(rpgStats.hp).max) : null,
    attributes: rpgEnabled
      ? parseArray(rpgStats.attributes)
          .filter(isRecord)
          .map((attribute) => ({ name: text(attribute.name), value: readNumber(attribute.value, 0) }))
          .filter((attribute) => attribute.name)
      : [],
  };
}

export async function loadEncounterCast(storage: StorageGateway, chat: JsonRecord): Promise<EncounterCast> {
  const characters = await Promise.all(stringArray(chat.characterIds).map((id) => loadCharacter(storage, id)));
  const metadata = parseRecord(chat.metadata);
  return {
    persona: await loadPersona(storage, chat),
    characters: characters.filter((character): character is EncounterCharacter => character !== null),
    legacyCards: parseArray(metadata.gameCharacterCards)
      .filter(isRecord)
      .map((card) => ({
        name: text(card.name),
        maxHp: positiveNumber(parseRecord(parseRecord(card.rpgStats).hp).max),
      }))
      .filter((card) => card.name),
    legacyMapName: text(parseRecord(metadata.gameMap).name),
  };
}

export async function loadEncounterTracked(storage: StorageGateway, chatId: string): Promise<EncounterTrackedContext> {
  const world = parseRecord(await storage.getWorldState<unknown>(chatId));
  const player = parseRecord(world.playerStats);
  const attributes = parseRecord(player.attributes);
  return {
    location: text(world.location),
    weather: text(world.weather),
    time: text(world.time),
    date: text(world.date),
    inventory: parseArray(player.inventory)
      .filter(isRecord)
      .map((item) => ({ name: text(item.name), quantity: readNumber(item.quantity, 1) }))
      .filter((item) => item.name),
    attributes: PLAYER_ATTRIBUTE_KEYS.filter((key) => key in attributes).map((key) => ({
      name: key.toUpperCase(),
      value: readNumber(attributes[key], 0),
    })),
    presentCharacters: parseArray(world.presentCharacters)
      .filter(isRecord)
      .map((character) => ({ name: text(character.name), mood: text(character.mood), action: text(character.action) }))
      .filter((character) => character.name),
  };
}

export async function loadEncounterSpellbook(
  storage: StorageGateway,
  spellbookId: string | null,
): Promise<EncounterSpell[]> {
  if (!spellbookId) return [];
  const entries = await storage.listLorebookEntries<unknown>(spellbookId);
  return entries
    .filter(isRecord)
    .filter((entry) => boolish(entry.enabled, true))
    .map((entry) => ({ name: text(entry.name), content: text(entry.content) }))
    .filter((entry) => entry.name || entry.content);
}

/** The last `depth` messages as model messages; anything that isn't assistant or system is sent as user. */
export async function loadEncounterHistory(
  storage: StorageGateway,
  chatId: string,
  depth: number,
): Promise<LlmMessage[]> {
  const limit = Math.max(1, Math.trunc(depth));
  const rows = await storage.listChatMessages<unknown>(chatId, {
    orderBy: "createdAt",
    descending: true,
    limit,
    fields: ["id", "role", "content", "extra"],
  });
  // The page comes newest first; reversing it (not re-sorting by createdAt) keeps equal timestamps in order.
  return rows
    .filter(isRecord)
    .slice(0, limit)
    .reverse()
    .filter((message) => !hiddenFromAi(message) && text(message.content))
    .map((message) => {
      const role = readString(message.role);
      return {
        role: role === "assistant" || role === "system" ? role : "user",
        content: text(message.content),
      };
    });
}
