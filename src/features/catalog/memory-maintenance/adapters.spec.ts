import { describe, expect, it } from "vitest";

import type { ChatMemoryChunk } from "../../../engine/contracts/types/chat";
import type { CanonicalMemoryRecord } from "../../../engine/contracts/types/memory";
import { canonicalMemoryCleanupSource, chatMemoryCleanupInput } from "./adapters";

function automaticMemory(payload: CanonicalMemoryRecord["payload"]): CanonicalMemoryRecord {
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
    payload,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  };
}

describe("canonicalMemoryCleanupSource", () => {
  it("protects imported records even when their portable payload retained automatic capture", () => {
    const source = canonicalMemoryCleanupSource(
      automaticMemory({
        automatic: true,
        importedFromMemoryId: "source-memory",
        importedAt: "2026-07-27T00:00:00.000Z",
      }),
    );

    expect(source.origin).toBe("imported");
    expect(source.userEdited).toBe(false);
  });

  it("protects an automatic record after its content was edited by the user", () => {
    const source = canonicalMemoryCleanupSource(
      automaticMemory({
        automatic: true,
        userEdited: true,
      }),
    );

    expect(source.origin).toBe("automatic");
    expect(source.userEdited).toBe(true);
  });
});

describe("chatMemoryCleanupInput", () => {
  it("never relabels chat-scoped rows as scene-scoped when a console contains both", () => {
    const base = {
      chatId: "chat-1",
      content: "Memory",
      messageCount: 1,
      messageIds: ["message-1"],
      firstMessageAt: "2026-07-01T00:00:00.000Z",
      lastMessageAt: "2026-07-01T00:00:00.000Z",
      createdAt: "2026-07-01T00:00:00.000Z",
      hasEmbedding: true,
    } satisfies Omit<ChatMemoryChunk, "id">;
    const input = chatMemoryCleanupInput(
      [
        { ...base, id: "chat-memory", scopeType: "chat", scopeId: "chat-1" },
        { ...base, id: "scene-memory", scopeType: "scene", scopeId: "chat-1" },
      ],
      "chat-1",
    );

    expect(input.scope).toEqual({ kind: "scene", id: "chat-1" });
    expect(input.sources.map((source) => source.id)).toEqual(["scene-memory"]);
  });
});
