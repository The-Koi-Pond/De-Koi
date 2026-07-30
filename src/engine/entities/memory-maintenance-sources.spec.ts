import { describe, expect, it } from "vitest";

import type { ChatMemoryChunk } from "../contracts/types/chat";
import type { CanonicalMemoryInput, CanonicalMemoryRecord } from "../contracts/types/memory";
import {
  canonicalInputCleanupSource,
  canonicalMemoryCleanupSource,
  chatMemoryCleanupInput,
  chatMemoryCleanupSource,
  cleanupScope,
  memoryScope,
} from "./memory-maintenance-sources";

function canonicalMemory(overrides: Partial<CanonicalMemoryRecord> = {}): CanonicalMemoryRecord {
  return {
    id: "memory-1",
    kind: "fact",
    status: "active",
    scope: { kind: "character", id: "character-1" },
    content: "Mira keeps the brass key.",
    confidence: 0.9,
    provenance: {
      sourceChatId: "chat-1",
      messageIds: ["message-1"],
      characterId: "character-1",
      timestamp: "2026-07-01T00:00:00.000Z",
    },
    title: null,
    tags: ["automatic"],
    payload: { automatic: true },
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

const baseChatMemory = {
  id: "chat-memory",
  chatId: "chat-1",
  content: "Memory",
  messageCount: 1,
  firstMessageAt: "2026-07-01T00:00:00.000Z",
  lastMessageAt: "2026-07-01T00:00:00.000Z",
  createdAt: "2026-07-01T00:00:00.000Z",
  hasEmbedding: true,
} satisfies ChatMemoryChunk;

describe("memory maintenance source adapters", () => {
  it.each([
    ["chat", { kind: "chat", id: "chat-1" }],
    ["scene", { kind: "scene", id: "scene-1" }],
    ["character", { kind: "character", id: "character-1" }],
  ] as const)("preserves canonical %s scope", (_label, scope) => {
    expect(canonicalMemoryCleanupSource(canonicalMemory({ scope })).scope).toEqual(scope);
  });

  it("maps canonical imported, cleanup, automatic, manual, pinned, and edited metadata", () => {
    expect(
      canonicalMemoryCleanupSource(
        canonicalMemory({
          tags: ["imported"],
          payload: { automatic: true, importedFromMemoryId: "source-memory" },
        }),
      ),
    ).toEqual(expect.objectContaining({ origin: "imported", userEdited: false }));
    expect(
      canonicalMemoryCleanupSource(canonicalMemory({ payload: { memoryCleanup: { role: "replacement" } } })),
    ).toEqual(expect.objectContaining({ origin: "cleanup", userEdited: false }));
    expect(canonicalMemoryCleanupSource(canonicalMemory())).toEqual(
      expect.objectContaining({ origin: "automatic", userEdited: false }),
    );
    expect(canonicalMemoryCleanupSource(canonicalMemory({ tags: [], payload: {} }))).toEqual(
      expect.objectContaining({ origin: "manual", userEdited: true }),
    );
    expect(
      canonicalMemoryCleanupSource(
        canonicalMemory({ status: "pinned", payload: { automatic: true, userEdited: true } }),
      ),
    ).toEqual(expect.objectContaining({ pinned: true, userEdited: true }));
  });

  it("adapts an ephemeral canonical input without inventing timestamps", () => {
    const input: CanonicalMemoryInput = {
      kind: "preference",
      scope: { kind: "scene", id: "scene-1" },
      content: "Mira prefers the window seat.",
      confidence: 0.92,
      provenance: { sourceChatId: "chat-1", messageIds: ["message-1"] },
      payload: { automatic: true },
    };

    expect(canonicalInputCleanupSource("candidate-1", input)).toEqual(
      expect.objectContaining({
        id: "candidate-1",
        scope: { kind: "scene", id: "scene-1" },
        origin: "automatic",
        createdAt: null,
        updatedAt: null,
      }),
    );
  });

  it.each([
    ["manual", { memoryKind: "manual" }, "manual"],
    ["imported", { memoryKind: "imported", sourceChatId: "other-chat" }, "imported"],
    ["corrected", { memoryKind: "correction" }, "correction"],
    ["command", { memoryKind: "command", commandMemoryKey: "key" }, "command"],
    ["automatic", { messageIds: ["message-1"] }, "automatic"],
  ] as const)("maps %s chat metadata", (_label, overrides, origin) => {
    expect(
      chatMemoryCleanupSource({ ...baseChatMemory, ...overrides } as ChatMemoryChunk, { kind: "chat", id: "chat-1" }),
    ).toEqual(expect.objectContaining({ origin }));
  });

  it("keeps chat and scene rows in separate cleanup inputs", () => {
    const input = chatMemoryCleanupInput(
      [
        { ...baseChatMemory, id: "chat-row", scopeType: "chat", scopeId: "chat-1" },
        { ...baseChatMemory, id: "scene-row", scopeType: "scene", scopeId: "chat-1" },
      ],
      "chat-1",
    );

    expect(input.scope).toEqual({ kind: "scene", id: "chat-1" });
    expect(input.sources.map((source) => source.id)).toEqual(["scene-row"]);
  });

  it("converts only cleanup-supported canonical scopes", () => {
    expect(cleanupScope({ kind: "chat", id: "chat-1" })).toEqual({ kind: "chat", id: "chat-1" });
    expect(memoryScope({ kind: "scene", id: "scene-1" })).toEqual({ kind: "scene", id: "scene-1" });
    expect(() => cleanupScope({ kind: "world", id: "world-1" })).toThrow("Unsupported memory cleanup scope");
  });
});
