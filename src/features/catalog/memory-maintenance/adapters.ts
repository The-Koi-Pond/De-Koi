import type { ChatMemoryChunk } from "../../../engine/contracts/types/chat";
import type { CanonicalMemoryRecord } from "../../../engine/contracts/types/memory";
import type { MemoryCleanupScope, MemoryCleanupSource } from "../../../engine/contracts/types/memory-maintenance";

function chatMemoryCleanupOrigin(memory: ChatMemoryChunk): MemoryCleanupSource["origin"] {
  if (memory.source === "memory_cleanup") return "cleanup";
  if (memory.memoryKind === "imported" || (memory.sourceChatId && memory.sourceChatId !== memory.chatId)) {
    return "imported";
  }
  if (
    memory.memoryKind === "correction" ||
    memory.source === "correction" ||
    memory.correctionOfMemoryId ||
    memory.correctedByMemoryId
  ) {
    return "correction";
  }
  if (memory.memoryKind === "command" || memory.source === "connected_command" || memory.commandMemoryKey) {
    return "command";
  }
  const hasMessageProvenance = Array.isArray(memory.messageIds) && memory.messageIds.length > 0;
  if (memory.memoryKind === "manual" || memory.source === "manual" || !hasMessageProvenance) {
    return "manual";
  }
  return "automatic";
}

export function chatMemoryCleanupSource(memory: ChatMemoryChunk, scope: MemoryCleanupScope): MemoryCleanupSource {
  return {
    id: memory.id,
    scope,
    content: memory.content,
    kind: memory.memoryKind ?? "transcript",
    status: memory.status ?? "active",
    origin: chatMemoryCleanupOrigin(memory),
    confidence: memory.confidence ?? null,
    messageIds: [...(memory.messageIds ?? [])],
    sourceChatIds: memory.sourceChatId ? [memory.sourceChatId] : [],
    createdAt: memory.createdAt ?? null,
    updatedAt: memory.updatedAt ?? null,
    pinned: memory.pinned === true,
    userEdited: memory.userEdited === true,
    ...(Array.isArray(memory.embedding) ? { embedding: memory.embedding } : {}),
  };
}

export function chatMemoryCleanupInput(
  memories: ChatMemoryChunk[],
  chatId: string,
): { scope: MemoryCleanupScope; sources: MemoryCleanupSource[] } {
  const belongsToChat = (memory: ChatMemoryChunk) => !memory.scopeId?.trim() || memory.scopeId === chatId;
  const kind = memories.some((memory) => memory.scopeType === "scene" && belongsToChat(memory)) ? "scene" : "chat";
  const scope: MemoryCleanupScope = { kind, id: chatId };
  const sources = memories
    .filter((memory) => belongsToChat(memory) && (memory.scopeType === "scene" ? "scene" : "chat") === kind)
    .map((memory) => chatMemoryCleanupSource(memory, scope));
  return { scope, sources };
}

export function canonicalMemoryCleanupSource(memory: CanonicalMemoryRecord): MemoryCleanupSource {
  const payload = memory.payload ?? {};
  const automatic = payload.automatic === true;
  const cleanupGenerated =
    typeof payload.memoryCleanup === "object" &&
    payload.memoryCleanup !== null &&
    (payload.memoryCleanup as { role?: unknown }).role === "replacement";
  const imported = memory.tags.includes("imported") || typeof payload.importedFromMemoryId === "string";
  return {
    id: memory.id,
    scope: { kind: "character", id: memory.scope.id },
    content: memory.content,
    kind: memory.kind,
    status: memory.status,
    origin: cleanupGenerated ? "cleanup" : imported ? "imported" : automatic ? "automatic" : "manual",
    confidence: memory.confidence,
    messageIds: [...memory.provenance.messageIds],
    sourceChatIds: memory.provenance.sourceChatId ? [memory.provenance.sourceChatId] : [],
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
    pinned: memory.status === "pinned",
    userEdited: payload.userEdited === true || (!automatic && !cleanupGenerated),
  };
}
