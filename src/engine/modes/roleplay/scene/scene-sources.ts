// What scene planning and summaries read from storage: recent messages, the participant cards, the persona, and the
// origin context a new scene carries.
import type { StorageGateway } from "../../../capabilities/storage";
import {
  boolish,
  hiddenFromAi,
  isRecord,
  parseRecord,
  readString,
  type JsonRecord,
} from "../../../generation/runtime-records";
import { collapseWhitespace } from "./scene-text";

const ORIGIN_CONTEXT_MESSAGE_LIMIT = 24;
const ORIGIN_CONTEXT_CHARACTER_LIMIT = 12_000;
const CARD_TAG_LIMIT = 12;

/** The chat's last `limit` messages, oldest first. */
export async function loadRecentMessages(
  storage: StorageGateway,
  chatId: string,
  limit: number,
): Promise<JsonRecord[]> {
  const rows = await storage.listChatMessages<unknown>(chatId, {
    orderBy: "createdAt",
    descending: true,
    limit,
  });
  // The page comes newest first; reversing it keeps messages with equal timestamps in their stored order.
  return rows.filter(isRecord).slice(0, limit).reverse();
}

/** `role: content` for each message the model may see, skipping empty ones and ones hidden from the AI. */
export function messageLines(messages: readonly JsonRecord[]): string[] {
  return messages.flatMap((message) => {
    const content = readString(message.content).trim();
    if (!content || hiddenFromAi(message)) return [];
    return [`${readString(message.role).trim() || "user"}: ${content}`];
  });
}

/** The origin's recent visible conversation a scene starts from, newest part kept when it runs long. */
export async function buildOriginContext(storage: StorageGateway, originChatId: string): Promise<string> {
  const lines = messageLines(await loadRecentMessages(storage, originChatId, ORIGIN_CONTEXT_MESSAGE_LIMIT));
  const kept: string[] = [];
  let length = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]!;
    const added = line.length + (kept.length > 0 ? 2 : 0);
    if (length + added > ORIGIN_CONTEXT_CHARACTER_LIMIT) {
      if (kept.length === 0) kept.unshift(line.slice(line.length - ORIGIN_CONTEXT_CHARACTER_LIMIT));
      break;
    }
    kept.unshift(line);
    length += added;
  }
  return kept.join("\n\n");
}

function cappedField(value: string, max: number): string {
  const text = collapseWhitespace(value);
  if (text.length <= max) return text;
  const room = text.slice(0, max - 3);
  const lastSpace = room.lastIndexOf(" ");
  return `${(lastSpace > max / 2 ? room.slice(0, lastSpace) : room).trimEnd()}...`;
}

function parseCardData(value: unknown): JsonRecord {
  const parsed = parseRecord(value);
  // A full V2 card ({ spec, data: { name, ... } }) keeps its fields one level down.
  return isRecord(parsed.data) && !readString(parsed.name).trim() ? parsed.data : parsed;
}

function snakeCase(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/** Reads a card field from the card's data, its extensions, then the row, under camelCase or snake_case names. */
function cardFieldReader(row: JsonRecord): (...keys: string[]) => string {
  const data = parseCardData(row.data);
  const extensions = parseRecord(data.extensions);
  const sources = [data, extensions, row];
  return (...keys) => {
    for (const key of keys) {
      for (const name of new Set([key, snakeCase(key)])) {
        for (const source of sources) {
          const text = readString(source[name]).trim();
          if (text) return text;
        }
      }
    }
    return "";
  };
}

function cardTags(row: JsonRecord): string[] {
  const data = parseCardData(row.data);
  const raw = data.tags ?? row.tags;
  const tags = Array.isArray(raw)
    ? raw.map((tag) => readString(tag).trim())
    : readString(raw)
        .split(",")
        .map((tag) => tag.trim());
  return tags.filter(Boolean).slice(0, CARD_TAG_LIMIT);
}

const CARD_FIELDS: Array<{ label: string; keys: string[]; max: number }> = [
  { label: "Description", keys: ["description"], max: 1_200 },
  { label: "Personality", keys: ["personality"], max: 900 },
  { label: "Appearance", keys: ["appearance"], max: 900 },
  { label: "Backstory", keys: ["backstory", "comment"], max: 900 },
  { label: "Scenario", keys: ["scenario"], max: 900 },
  { label: "First message", keys: ["firstMes", "firstMessage"], max: 600 },
  { label: "Example dialogue", keys: ["mesExample", "exampleDialogue"], max: 900 },
  { label: "System prompt", keys: ["systemPrompt"], max: 900 },
  { label: "Post-history instructions", keys: ["postHistoryInstructions"], max: 900 },
];

/** One participant card: id, name and whichever card fields are set. */
function participantCard(row: JsonRecord): string {
  const read = cardFieldReader(row);
  const lines = [`ID: ${readString(row.id).trim()}`, `Name: ${cappedField(read("name") || "Unnamed", 120)}`];
  for (const field of CARD_FIELDS) {
    const value = read(...field.keys);
    if (value) lines.push(`${field.label}: ${cappedField(value, field.max)}`);
  }
  const tags = cardTags(row);
  if (tags.length > 0) lines.push(`Tags: ${tags.join(", ")}`);
  return lines.join("\n");
}

export async function loadParticipantRows(storage: StorageGateway, characterIds: readonly string[]) {
  const rows = await Promise.all(characterIds.map((id) => storage.get<unknown>("characters", id)));
  return rows.filter(isRecord);
}

export function participantCards(rows: readonly JsonRecord[]): string {
  return rows.length > 0 ? rows.map(participantCard).join("\n\n") : "(none)";
}

/** The chat's persona, else the one marked active, as a short card; "(none)" without one. */
export async function loadScenePersona(storage: StorageGateway, chat: JsonRecord): Promise<string> {
  const personaId = readString(chat.personaId).trim();
  let persona = personaId ? await storage.get<unknown>("personas", personaId) : null;
  if (!isRecord(persona)) {
    const personas = (await storage.list<unknown>("personas")).filter(isRecord);
    persona = personas.find((row) => boolish(row.isActive, false) || boolish(row.active, false)) ?? null;
  }
  if (!isRecord(persona)) return "(none)";
  const read = cardFieldReader(persona);
  const lines = [`Name: ${cappedField(read("name") || "Unnamed", 120)}`];
  for (const [label, key] of [
    ["Description", "description"],
    ["Personality", "personality"],
    ["Appearance", "appearance"],
    ["Backstory", "backstory"],
  ] as const) {
    const value = read(key);
    if (value) lines.push(`${label}: ${cappedField(value, 900)}`);
  }
  return lines.join("\n");
}
