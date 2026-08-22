import type { StorageGateway } from "../capabilities/storage";
import type { CharacterMemoryScopeCharacter } from "./character-memory-scope";
import { hiddenFromAi, parseRecord, readString, type JsonRecord } from "./runtime-records";

const MAX_REFERENCE_MESSAGES = 6;
const REFERENCE_MESSAGE_PAGE_SIZE = 24;
const MAX_REFERENCE_MESSAGES_SCANNED = 120;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export interface AutomaticMemorySourceMessage {
  id: string;
  chatId: string;
  role: string;
  content: string;
  characterId: string | null;
  createdAt: string;
  speakerLabel: string;
}

export interface AutomaticMemoryCaptureContext {
  userLabel: string;
  characterLabels: Record<string, string>;
  sourceMessages: AutomaticMemorySourceMessage[];
  referenceMessages: AutomaticMemorySourceMessage[];
}

export interface AutomaticMemorySpeakerContext {
  userLabel: string;
  characterLabels: Record<string, string>;
}

function displayName(value: unknown): string {
  const record = parseRecord(value);
  return readString(parseRecord(record.data).name || record.name).trim();
}

function characterName(character: CharacterMemoryScopeCharacter): string {
  return readString(character.name || parseRecord(character.data).name).trim();
}

function speakerLabel(
  message: JsonRecord,
  userLabel: string,
  characterLabels: Readonly<Record<string, string>>,
): string {
  const role = readString(message.role).trim();
  if (role === "user") return userLabel;
  if (role === "narrator") return "Narrator";
  const characterId = readString(message.characterId).trim();
  if (characterId && characterLabels[characterId]) return characterLabels[characterId];
  if (role === "assistant") return "Unattributed assistant";
  return role || "Message";
}

export function automaticMemorySourceSnapshot(
  value: unknown,
  context: AutomaticMemorySpeakerContext,
): AutomaticMemorySourceMessage | null {
  const record = parseRecord(value);
  const id = readString(record.id).trim();
  const chatId = readString(record.chatId).trim();
  const role = readString(record.role).trim();
  const content = readString(record.content).trim();
  if (!id || !chatId || !role || !content) return null;
  return {
    id,
    chatId,
    role,
    content,
    characterId: readString(record.characterId).trim() || null,
    createdAt: readString(record.createdAt).trim(),
    speakerLabel: speakerLabel(record, context.userLabel, context.characterLabels),
  };
}

export async function resolveAutomaticMemorySpeakerContext(
  storage: StorageGateway,
  chat: JsonRecord,
  characters: CharacterMemoryScopeCharacter[],
): Promise<AutomaticMemorySpeakerContext> {
  const personaId = readString(chat.personaId).trim();
  const persona = personaId ? await storage.get<JsonRecord>("personas", personaId).catch(() => null) : null;
  const userLabel = displayName(persona) || "{{user}}";
  const characterLabels = Object.fromEntries(
    characters
      .map((character) => [readString(character.id).trim(), characterName(character)] as const)
      .filter(([id, name]) => id && name),
  );
  return { userLabel, characterLabels };
}

function chronological(left: AutomaticMemorySourceMessage, right: AutomaticMemorySourceMessage): number {
  const leftAt = parseIsoTimestamp(left.createdAt);
  const rightAt = parseIsoTimestamp(right.createdAt);
  return (leftAt !== null && rightAt !== null ? leftAt - rightAt : 0) || left.id.localeCompare(right.id);
}

function parseIsoTimestamp(value: string): number | null {
  if (!ISO_TIMESTAMP.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export async function buildAutomaticMemoryCaptureContext(
  storage: StorageGateway,
  input: {
    chat: JsonRecord;
    characters: CharacterMemoryScopeCharacter[];
    savedUserMessage?: unknown;
    savedAssistantMessage: unknown;
  },
): Promise<AutomaticMemoryCaptureContext | null> {
  const chatId = readString(input.chat.id).trim();
  if (!chatId) return null;
  const { userLabel, characterLabels } = await resolveAutomaticMemorySpeakerContext(
    storage,
    input.chat,
    input.characters,
  );
  const speakerContext = { userLabel, characterLabels };
  const sourceMessages = [input.savedUserMessage, input.savedAssistantMessage]
    .map((message) => automaticMemorySourceSnapshot(message, speakerContext))
    .filter((message): message is AutomaticMemorySourceMessage => message !== null)
    .filter((message) => message.chatId === chatId);
  if (
    sourceMessages.length === 0 ||
    sourceMessages.at(-1)?.role !== "assistant" ||
    sourceMessages.some((message) => message.chatId !== chatId)
  ) {
    return null;
  }

  const sourceIds = new Set(sourceMessages.map((message) => message.id));
  const firstSourceAt = parseIsoTimestamp(sourceMessages[0]?.createdAt ?? "");
  const referenceMessages: AutomaticMemorySourceMessage[] = [];
  const seenReferenceIds = new Set<string>();
  let scanned = 0;
  let before = sourceMessages[0]?.createdAt ?? "";
  while (
    firstSourceAt !== null &&
    before &&
    scanned < MAX_REFERENCE_MESSAGES_SCANNED &&
    referenceMessages.length < MAX_REFERENCE_MESSAGES
  ) {
    const remaining = MAX_REFERENCE_MESSAGES_SCANNED - scanned;
    const limit = Math.min(REFERENCE_MESSAGE_PAGE_SIZE, remaining);
    const page = await storage
      .listChatMessages<JsonRecord>(chatId, {
        orderBy: "createdAt",
        descending: true,
        before,
        limit,
        fields: ["id", "chatId", "role", "content", "characterId", "createdAt", "extra"],
      })
      .catch(() => []);
    if (page.length === 0) break;
    const orderedPage = page.slice(0, limit).sort((left, right) => {
      const leftAt = parseIsoTimestamp(readString(left.createdAt).trim());
      const rightAt = parseIsoTimestamp(readString(right.createdAt).trim());
      return (
        (leftAt !== null && rightAt !== null ? rightAt - leftAt : 0) ||
        readString(right.id).localeCompare(readString(left.id))
      );
    });
    scanned += orderedPage.length;
    for (const message of orderedPage) {
      const id = readString(message.id).trim();
      if (
        !id ||
        seenReferenceIds.has(id) ||
        readString(message.chatId).trim() !== chatId ||
        sourceIds.has(id) ||
        hiddenFromAi(message)
      ) {
        continue;
      }
      seenReferenceIds.add(id);
      const snapshot = automaticMemorySourceSnapshot(message, speakerContext);
      const createdAt = snapshot ? parseIsoTimestamp(snapshot.createdAt) : null;
      if (!snapshot || createdAt === null || createdAt >= firstSourceAt) continue;
      referenceMessages.push(snapshot);
      if (referenceMessages.length === MAX_REFERENCE_MESSAGES) break;
    }
    const nextBefore = orderedPage
      .map((message) => readString(message.createdAt).trim())
      .filter((value) => parseIsoTimestamp(value) !== null)
      .at(-1);
    if (page.length < limit || !nextBefore || nextBefore >= before) break;
    before = nextBefore;
  }
  referenceMessages.sort(chronological);

  return { userLabel, characterLabels, sourceMessages, referenceMessages };
}
