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
  const baseChatMemory = {
    chatId: "chat-1",
    content: "Memory",
    messageCount: 1,
    firstMessageAt: "2026-07-01T00:00:00.000Z",
    lastMessageAt: "2026-07-01T00:00:00.000Z",
    createdAt: "2026-07-01T00:00:00.000Z",
    hasEmbedding: true,
  } satisfies Omit<ChatMemoryChunk, "id">;

  it.each([
    ["missing", undefined],
    ["empty", []],
  ])("protects a manual chat row with %s messageIds", (_label, messageIds) => {
    const input = chatMemoryCleanupInput(
      [{ ...baseChatMemory, id: "manual-memory", messageIds }],
      "chat-1",
    );

    expect(input.sources).toEqual([
      expect.objectContaining({
        id: "manual-memory",
        origin: "manual",
      }),
    ]);
  });

  it("normalizes imported and edited local rows as protected cleanup sources", () => {
    const input = chatMemoryCleanupInput(
      [
        {
          ...baseChatMemory,
          id: "imported-memory",
          messageIds: ["message-1"],
          sourceChatId: "other-chat",
        },
        {
          ...baseChatMemory,
          id: "edited-memory",
          messageIds: ["message-2"],
          userEdited: true,
        },
      ],
      "chat-1",
    );

    expect(input.sources).toEqual([
      expect.objectContaining({ id: "imported-memory", origin: "imported" }),
      expect.objectContaining({ id: "edited-memory", origin: "automatic", userEdited: true }),
    ]);
  });

  it("never relabels chat-scoped rows as scene-scoped when a console contains both", () => {
    const input = chatMemoryCleanupInput(
      [
        { ...baseChatMemory, id: "chat-memory", messageIds: ["message-1"], scopeType: "chat", scopeId: "chat-1" },
        {
          ...baseChatMemory,
          id: "scene-memory",
          messageIds: ["message-1"],
          scopeType: "scene",
          scopeId: "chat-1",
        },
      ],
      "chat-1",
    );

    expect(input.scope).toEqual({ kind: "scene", id: "chat-1" });
    expect(input.sources.map((source) => source.id)).toEqual(["scene-memory"]);
  });
});
