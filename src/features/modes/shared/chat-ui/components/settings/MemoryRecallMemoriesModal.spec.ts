import { describe, expect, it } from "vitest";

import type { ChatMemoryChunk } from "../../../../../../engine/contracts/types/chat";
import { filterMemories, memoryScope, memoryStatus, memoryType } from "./MemoryRecallMemoriesModal";

function memory(overrides: Partial<ChatMemoryChunk>): ChatMemoryChunk {
  return {
    id: "memory-1",
    chatId: "chat-1",
    content: "Mira keeps the blue key under the lantern.",
    messageCount: 1,
    firstMessageAt: "2026-01-01T00:00:00.000Z",
    lastMessageAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    hasEmbedding: true,
    ...overrides,
  };
}

describe("MemoryRecallMemoriesModal helpers", () => {
  it("classifies status, type, and scope from memory metadata", () => {
    expect(memoryStatus(memory({}))).toBe("active");
    expect(memoryStatus(memory({ deletedAt: "2026-01-02T00:00:00.000Z" }))).toBe("deleted");
    expect(memoryStatus(memory({ status: "wrong" }))).toBe("wrong");

    expect(memoryType(memory({ messageIds: ["m1"] }))).toBe("transcript");
    expect(memoryType(memory({ sourceChatId: "other-chat" }))).toBe("imported");
    expect(memoryType(memory({ commandMemoryKey: "char:fact" }))).toBe("command");
    expect(memoryType(memory({ correctionOfMemoryId: "old-memory" }))).toBe("correction");
    expect(memoryType(memory({ messageIds: [] }))).toBe("manual");
    expect(memoryType(memory({ memoryKind: "character" }))).toBe("character");
    expect(memoryType(memory({ memoryKind: "scene_summary" }))).toBe("scene_summary");
    expect(memoryType(memory({ memoryKind: "summary" }))).toBe("summary");

    expect(memoryScope(memory({}))).toBe("current");
    expect(memoryScope(memory({ sourceChatId: "other-chat" }))).toBe("imported");
    expect(memoryScope(memory({ targetCharacterName: "Mira" }))).toBe("targeted");
  });

  it("filters memories by search, scope, type, and status", () => {
    const memories = [
      memory({ id: "active-transcript", messageIds: ["m1"], content: "Blue lantern key" }),
      memory({ id: "deleted-import", sourceChatId: "other-chat", status: "deleted", content: "Old bridge note" }),
      memory({ id: "wrong-command", commandMemoryKey: "mira:key", status: "wrong", content: "Wrong silver key" }),
    ];

    expect(filterMemories(memories, { query: "key", status: "active", type: "all", scope: "all" }).map((item) => item.id)).toEqual([
      "active-transcript",
    ]);
    expect(filterMemories(memories, { query: "bridge", status: "deleted", type: "imported", scope: "imported" }).map((item) => item.id)).toEqual([
      "deleted-import",
    ]);
    expect(filterMemories(memories, { query: "mira:key", status: "wrong", type: "command", scope: "all" }).map((item) => item.id)).toEqual([
      "wrong-command",
    ]);
  });
});