import type { ChatMemoryChunk } from "../contracts/types/chat";
import type { CanonicalMemoryInput, CanonicalMemoryRecord, MemoryScope } from "../contracts/types/memory";
import type { MemoryCleanupScope, MemoryCleanupSource } from "../contracts/types/memory-maintenance";

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

function isCleanupReplacement(payload: Record<string, unknown>): boolean {
  return (
    typeof payload.memoryCleanup === "object" &&
    payload.memoryCleanup !== null &&
    (payload.memoryCleanup as { role?: unknown }).role === "replacement"
  );
}

function canonicalCleanupOrigin(tags: string[], payload: Record<string, unknown>): MemoryCleanupSource["origin"] {
  if (isCleanupReplacement(payload)) return "cleanup";
  if (tags.includes("imported") || typeof payload.importedFromMemoryId === "string") return "imported";
  if (tags.includes("correction") || payload.correctionOfMemoryId || payload.correctedByMemoryId) {
    return "correction";
  }
  if (tags.includes("command") || payload.commandMemoryKey || payload.commandId) return "command";
  return payload.automatic === true ? "automatic" : "manual";
}

export function cleanupScope(scope: MemoryScope): MemoryCleanupScope {
  if (scope.kind === "chat" || scope.kind === "scene" || scope.kind === "character") {
    return { kind: scope.kind, id: scope.id };
  }
  throw new Error(`Unsupported memory cleanup scope: ${scope.kind}`);
}

export function memoryScope(scope: MemoryCleanupScope): MemoryScope {
  return { kind: scope.kind, id: scope.id };
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
  const origin = canonicalCleanupOrigin(memory.tags, payload);
  return {
    id: memory.id,
    scope: cleanupScope(memory.scope),
    content: memory.content,
    kind: memory.kind,
    status: memory.status,
    origin,
    confidence: memory.confidence,
    messageIds: [...memory.provenance.messageIds],
    sourceChatIds: memory.provenance.sourceChatId ? [memory.provenance.sourceChatId] : [],
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
    pinned: memory.status === "pinned",
    userEdited: payload.userEdited === true || (origin === "manual" && !isCleanupReplacement(payload)),
  };
}

export function canonicalInputCleanupSource(id: string, input: CanonicalMemoryInput): MemoryCleanupSource {
  const payload = input.payload ?? {};
  const tags = input.tags ?? [];
  const origin = canonicalCleanupOrigin(tags, payload);
  return {
    id,
    scope: cleanupScope(input.scope),
    content: input.content,
    kind: input.kind,
    status: input.status ?? "active",
    origin,
    confidence: input.confidence,
    messageIds: [...input.provenance.messageIds],
    sourceChatIds: input.provenance.sourceChatId ? [input.provenance.sourceChatId] : [],
    createdAt: input.createdAt ?? null,
    updatedAt: input.updatedAt ?? null,
    pinned: input.status === "pinned",
    userEdited: payload.userEdited === true || (origin === "manual" && !isCleanupReplacement(payload)),
  };
}
