import type { StorageGateway } from "../../../capabilities/storage";
import type { ContinuityDirectorSourceSnapshot } from "../../../contracts/types/roleplay-continuity-director";
import type { CanonicalMemoryRecord, KnowledgeEdge, StoryProjectionPayload } from "../../../contracts/types/memory";
import { sha256MemoryId } from "../../../generation/deterministic-memory-id";
import { eligibleStoryMessages, STORY_PROJECTION_VERSION } from "../../../generation/story-projections";
import { parseRecord, readString, stringArray, type JsonRecord } from "../../../generation/runtime-records";

export interface ContinuityDirectorTranscriptItem {
  id: string;
  role: "user" | "assistant" | "narrator";
  content: string;
}

export interface ContinuityDirectorStoryItem {
  id: string;
  level: "episode" | "arc";
  title: string;
  content: string;
  unresolvedHooks: string[];
  currentState: string[];
  updatedAt: string;
}

export interface ContinuityDirectorKnowledgeItem {
  edgeId: string;
  memoryId: string;
  holder: { kind: KnowledgeEdge["holder"]["kind"]; id: string; name: string };
  stance: KnowledgeEdge["stance"];
  fact: string;
}

export interface ContinuityDirectorSource {
  chat: JsonRecord;
  writerConnectionId: string | null;
  characterNames: string[];
  personaNames: string[];
  transcript: ContinuityDirectorTranscriptItem[];
  story: ContinuityDirectorStoryItem[];
  knowledge: ContinuityDirectorKnowledgeItem[];
  sourceSnapshot: ContinuityDirectorSourceSnapshot;
}

export interface ContinuityDirectorSourceOptions {
  now?: () => string;
  transcriptLimit?: number;
}

function storyPayload(memory: CanonicalMemoryRecord): StoryProjectionPayload | null {
  const payload = parseRecord(memory.payload);
  if (
    payload.storyProjectionVersion !== STORY_PROJECTION_VERSION ||
    (payload.level !== "episode" && payload.level !== "arc")
  ) {
    return null;
  }
  return memory.payload as StoryProjectionPayload;
}

function recordName(record: JsonRecord | null): string {
  if (!record) return "";
  return readString(record.name || parseRecord(record.data).name).trim();
}

function timestamp(memory: CanonicalMemoryRecord): number {
  const parsed = Date.parse(memory.updatedAt || memory.createdAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function citations(payload: StoryProjectionPayload, key: "unresolvedHooks" | "currentState"): string[] {
  return payload.sections[key].map((citation) => citation.text.trim()).filter(Boolean);
}

export async function loadContinuityDirectorSource(
  storage: StorageGateway,
  chatId: string,
  options: ContinuityDirectorSourceOptions = {},
): Promise<ContinuityDirectorSource> {
  const chat = await storage.get<JsonRecord>("chats", chatId);
  if (!chat) throw new Error("Chat not found");
  if (readString(chat.mode).trim() !== "roleplay") {
    throw new Error("Continuity Director is available only for Roleplay chats");
  }

  const characterIds = stringArray(chat.characterIds);
  const personaId = readString(chat.personaId).trim();
  const [storedMessages, queriedMemories, characterRows, personaRow] = await Promise.all([
    storage.listChatMessages<JsonRecord>(chatId),
    storage.queryMemories?.({ scope: { kind: "chat", id: chatId }, includeInactive: true }) ?? [],
    Promise.all(characterIds.map((id) => storage.get<JsonRecord>("characters", id).catch(() => null))),
    personaId ? storage.get<JsonRecord>("personas", personaId).catch(() => null) : Promise.resolve(null),
  ]);

  const visibleMessages = eligibleStoryMessages(storedMessages);
  const transcript = visibleMessages.slice(-Math.max(1, options.transcriptLimit ?? 12)).map((message) => ({
    id: readString(message.id).trim(),
    role: readString(message.role).trim() as ContinuityDirectorTranscriptItem["role"],
    content: readString(message.content).trim(),
  }));

  const activeMemories = queriedMemories.filter((memory) => memory.status === "active" || memory.status === "pinned");
  const projections = activeMemories
    .map((memory) => ({ memory, payload: storyPayload(memory) }))
    .filter((entry): entry is { memory: CanonicalMemoryRecord; payload: StoryProjectionPayload } => !!entry.payload);
  const newestArc = projections
    .filter((entry) => entry.payload.level === "arc")
    .sort((left, right) => timestamp(right.memory) - timestamp(left.memory))[0];
  const newestEpisodes = projections
    .filter((entry) => entry.payload.level === "episode")
    .sort((left, right) => timestamp(right.memory) - timestamp(left.memory))
    .slice(0, 3);
  const selectedProjections = [newestArc, ...newestEpisodes].filter(
    (entry): entry is { memory: CanonicalMemoryRecord; payload: StoryProjectionPayload } => !!entry,
  );
  const story = selectedProjections.map(({ memory, payload }) => ({
    id: memory.id,
    level: payload.level,
    title: memory.title?.trim() || `${payload.level === "arc" ? "Arc" : "Episode"} projection`,
    content: memory.content.trim(),
    unresolvedHooks: citations(payload, "unresolvedHooks"),
    currentState: citations(payload, "currentState"),
    updatedAt: memory.updatedAt || memory.createdAt,
  }));

  const activeMemoryIds = activeMemories.map((memory) => memory.id);
  const edges = storage.queryKnowledgeEdges
    ? await storage.queryKnowledgeEdges({ memoryIds: activeMemoryIds, statuses: ["active"] }).catch(() => [])
    : [];
  const memoryById = new Map(activeMemories.map((memory) => [memory.id, memory]));
  const characterNamesById = new Map(
    characterIds.map((id, index) => [id, recordName(characterRows[index] ?? null) || id]),
  );
  const personaName = recordName(personaRow);
  const allowedHolders = new Set(characterIds.map((id) => `character:${id}`));
  if (personaId) allowedHolders.add(`persona:${personaId}`);
  const knowledge = edges
    .filter(
      (edge) =>
        edge.status === "active" &&
        (edge.holder.kind === "world" || allowedHolders.has(`${edge.holder.kind}:${edge.holder.id}`)) &&
        memoryById.has(edge.memoryId),
    )
    .slice(0, 24)
    .map((edge) => ({
      edgeId: edge.id,
      memoryId: edge.memoryId,
      holder: {
        kind: edge.holder.kind,
        id: edge.holder.id,
        name:
          edge.holder.kind === "character"
            ? characterNamesById.get(edge.holder.id) || edge.holder.id
            : edge.holder.kind === "persona"
              ? personaName || edge.holder.id
              : edge.holder.id || "World",
      },
      stance: edge.stance,
      fact: memoryById.get(edge.memoryId)!.content.trim(),
    }));

  const fingerprintIdentity = JSON.stringify({
    transcript,
    story: story.map((item) => ({
      id: item.id,
      level: item.level,
      title: item.title,
      content: item.content,
      unresolvedHooks: item.unresolvedHooks,
      currentState: item.currentState,
    })),
    knowledge,
  });
  const generatedAt = options.now?.() ?? new Date().toISOString();
  const sourceSnapshot: ContinuityDirectorSourceSnapshot = {
    storyProjectionIds: story.map((item) => item.id),
    knowledgeEdgeIds: knowledge.map((item) => item.edgeId),
    lastMessageId: transcript.at(-1)?.id ?? null,
    visibleAssistantTurnCount: visibleMessages.filter((message) => readString(message.role).trim() === "assistant")
      .length,
    fingerprint: await sha256MemoryId("continuity-source", fingerprintIdentity),
    generatedAt,
  };

  return {
    chat,
    writerConnectionId: readString(chat.connectionId).trim() || null,
    characterNames: characterIds.map((id) => characterNamesById.get(id) || id),
    personaNames: personaName ? [personaName] : [],
    transcript,
    story,
    knowledge,
    sourceSnapshot,
  };
}
