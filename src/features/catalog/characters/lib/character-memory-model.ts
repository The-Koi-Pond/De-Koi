import type {
  CanonicalMemoryInput,
  CanonicalMemoryRecord,
  MemoryStatus,
} from "../../../../engine/contracts/types/memory";

export type CharacterMemoryExportV1 = {
  type: "de_koi_character_memories";
  version: 1;
  exportedAt: string;
  character: { id: string; name: string };
  memories: CanonicalMemoryRecord[];
};

type CharacterMemoryImportInput = CanonicalMemoryInput & { id: string };

const NON_PORTABLE_KEYS = new Set([
  "vector",
  "embedding",
  "provider",
  "model",
  "dimensions",
  "contentHash",
  "projectionHash",
  "canonicalUpdatedAt",
  "embeddingConnectionId",
  "embeddingModel",
  "embeddingSource",
]);

function portableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(portableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !NON_PORTABLE_KEYS.has(key))
      .map(([key, child]) => [key, portableValue(child)]),
  );
}

function portableMemory(memory: CanonicalMemoryRecord): CanonicalMemoryRecord {
  return {
    id: memory.id,
    kind: memory.kind,
    status: memory.status,
    scope: { ...memory.scope },
    content: memory.content,
    confidence: memory.confidence,
    provenance: {
      ...memory.provenance,
      messageIds: [...memory.provenance.messageIds],
    },
    title: memory.title ?? null,
    tags: [...memory.tags],
    supersedesMemoryId: memory.supersedesMemoryId ?? null,
    supersededByMemoryId: memory.supersededByMemoryId ?? null,
    payload: portableValue(memory.payload) as Record<string, unknown>,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
  };
}

export function createCharacterMemoryExport(input: {
  character: { id: string; name: string };
  memories: CanonicalMemoryRecord[];
  exportedAt?: string;
}): CharacterMemoryExportV1 {
  return {
    type: "de_koi_character_memories",
    version: 1,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    character: { ...input.character },
    memories: input.memories.map(portableMemory),
  };
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validEnvelope(value: unknown): value is CharacterMemoryExportV1 {
  if (!isRecord(value) || value.type !== "de_koi_character_memories" || value.version !== 1) return false;
  if (!isRecord(value.character) || typeof value.character.id !== "string") return false;
  return Array.isArray(value.memories);
}

export function normalizeCharacterMemoryImport(
  value: unknown,
  target: { characterId: string; importedAt?: string },
): CharacterMemoryImportInput[] {
  if (!validEnvelope(value)) {
    throw new Error("Import must be a De-Koi character memories v1 file.");
  }
  const characterId = target.characterId.trim();
  if (!characterId) throw new Error("Choose a character before importing memories.");
  const importedAt = target.importedAt ?? new Date().toISOString();

  return value.memories.flatMap((memory) => {
    if (
      !isRecord(memory) ||
      typeof memory.id !== "string" ||
      typeof memory.content !== "string" ||
      typeof memory.kind !== "string" ||
      !isRecord(memory.provenance) ||
      !Array.isArray(memory.provenance.messageIds)
    ) {
      return [];
    }
    const sourceScope: Record<string, unknown> = isRecord(memory.scope) ? memory.scope : {};
    const sourceCharacterId =
      sourceScope.kind === "character" && typeof sourceScope.id === "string"
        ? sourceScope.id
        : value.character.id;
    const id = `character-memory-import-${stableHash(`${characterId}\u001f${memory.id}\u001f${memory.content}`)}`;
    const payload = isRecord(memory.payload) ? portableValue(memory.payload) as Record<string, unknown> : {};
    return [{
      id,
      kind: memory.kind as CanonicalMemoryRecord["kind"],
      status: "active" as const,
      scope: { kind: "character" as const, id: characterId },
      content: memory.content.trim(),
      confidence:
        typeof memory.confidence === "number" && Number.isFinite(memory.confidence)
          ? Math.max(0, Math.min(1, memory.confidence))
          : 1,
      provenance: {
        sourceChatId:
          typeof memory.provenance.sourceChatId === "string" ? memory.provenance.sourceChatId : null,
        messageIds: memory.provenance.messageIds.filter(
          (messageId): messageId is string => typeof messageId === "string",
        ),
        sceneId: typeof memory.provenance.sceneId === "string" ? memory.provenance.sceneId : null,
        characterId,
        timestamp: typeof memory.provenance.timestamp === "string" ? memory.provenance.timestamp : null,
      },
      title: typeof memory.title === "string" ? memory.title : null,
      tags: Array.isArray(memory.tags)
        ? memory.tags.filter((tag): tag is string => typeof tag === "string")
        : [],
      payload: {
        ...payload,
        importedFromMemoryId: memory.id,
        importedFromCharacterId: sourceCharacterId,
        importedAt,
      },
      createdAt: typeof memory.createdAt === "string" ? memory.createdAt : importedAt,
      updatedAt: importedAt,
    }];
  }).filter((memory) => memory.content);
}

export function characterMemoryStatusLabel(status: MemoryStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1).replaceAll("_", " ");
}

export function normalizeChatMemoriesForCharacter(
  values: unknown[],
  target: { characterId: string; copiedAt?: string },
): CharacterMemoryImportInput[] {
  const characterId = target.characterId.trim();
  if (!characterId) return [];
  const copiedAt = target.copiedAt ?? new Date().toISOString();

  return values.flatMap((value) => {
    if (!isRecord(value) || typeof value.id !== "string" || typeof value.content !== "string") return [];
    const content = value.content.trim();
    if (!content) return [];
    const sourceChatId =
      typeof value.chatId === "string"
        ? value.chatId
        : typeof value.sourceChatId === "string"
          ? value.sourceChatId
          : null;
    const messageIds = Array.isArray(value.messageIds)
      ? value.messageIds.filter((messageId): messageId is string => typeof messageId === "string")
      : [];
    return [{
      id: `character-memory-copy-${stableHash(`${characterId}\u001f${sourceChatId ?? ""}\u001f${value.id}\u001f${content}`)}`,
      kind: "episode" as const,
      status: "active" as const,
      scope: { kind: "character" as const, id: characterId },
      content,
      confidence: 1,
      provenance: {
        sourceChatId,
        messageIds,
        sceneId: typeof value.sceneChatId === "string" ? value.sceneChatId : null,
        characterId,
        timestamp:
          typeof value.lastMessageAt === "string"
            ? value.lastMessageAt
            : typeof value.createdAt === "string"
              ? value.createdAt
              : copiedAt,
      },
      tags: ["copied-from-chat"],
      payload: {
        copiedFromChatMemoryId: value.id,
        copiedAt,
      },
      createdAt: copiedAt,
      updatedAt: copiedAt,
    }];
  });
}
