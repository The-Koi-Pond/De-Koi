import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CanonicalMemoryInput, MemoryIndexRowInput } from "../../engine/contracts/types/memory";

const mocks = vi.hoisted(() => ({
  invokeTauri: vi.fn(),
}));

vi.mock("./tauri-client", () => ({
  invokeTauri: mocks.invokeTauri,
}));

describe("canonicalMemoryApi", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.invokeTauri.mockReset();
    mocks.invokeTauri.mockResolvedValue({ ok: true });
  });

  it("routes canonical memory CRUD through focused commands", async () => {
    const { canonicalMemoryApi } = await import("./canonical-memory-api");
    const input: CanonicalMemoryInput = {
      kind: "fact",
      scope: { kind: "chat", id: "chat-1" },
      content: "Mira remembers the brass key.",
      confidence: 0.9,
      provenance: { sourceChatId: "chat-1", messageIds: ["message-1"] },
    };

    await canonicalMemoryApi.create(input);
    await canonicalMemoryApi.get("memory-1");
    await canonicalMemoryApi.update("memory-1", { status: "pinned" });
    await canonicalMemoryApi.delete("memory-1");
    await canonicalMemoryApi.query({ scope: { kind: "chat", id: "chat-1" } });

    expect(mocks.invokeTauri).toHaveBeenNthCalledWith(1, "memory_create", { body: input });
    expect(mocks.invokeTauri).toHaveBeenNthCalledWith(2, "memory_get", { memoryId: "memory-1" });
    expect(mocks.invokeTauri).toHaveBeenNthCalledWith(3, "memory_update", {
      memoryId: "memory-1",
      patch: { status: "pinned" },
    });
    expect(mocks.invokeTauri).toHaveBeenNthCalledWith(4, "memory_delete", { memoryId: "memory-1" });
    expect(mocks.invokeTauri).toHaveBeenNthCalledWith(5, "memory_query", {
      body: { scope: { kind: "chat", id: "chat-1" } },
    });
  });

  it("routes index projection operations through focused commands", async () => {
    const { canonicalMemoryApi } = await import("./canonical-memory-api");
    const row: MemoryIndexRowInput = {
      memoryId: "memory-1",
      provider: "lexical",
      model: "de-koi-lexical-v1",
      dimensions: 64,
      contentHash: "content-hash",
      projectionHash: "projection-hash",
      canonicalUpdatedAt: "2026-07-04T12:00:00.000Z",
      vector: [0.1, 0.2],
    };

    await canonicalMemoryApi.index.upsert(row);
    await canonicalMemoryApi.index.deleteForMemory("memory-1");
    await canonicalMemoryApi.index.rebuildLexical({ scope: { kind: "chat", id: "chat-1" } });
    await canonicalMemoryApi.index.query({ scope: { kind: "chat", id: "chat-1" } });

    expect(mocks.invokeTauri).toHaveBeenNthCalledWith(1, "memory_index_upsert", { row });
    expect(mocks.invokeTauri).toHaveBeenNthCalledWith(2, "memory_index_delete_for_memory", {
      memoryId: "memory-1",
    });
    expect(mocks.invokeTauri).toHaveBeenNthCalledWith(3, "memory_index_rebuild_lexical", {
      body: { scope: { kind: "chat", id: "chat-1" } },
    });
    expect(mocks.invokeTauri).toHaveBeenNthCalledWith(4, "memory_index_query", {
      body: { scope: { kind: "chat", id: "chat-1" } },
    });
  });
});
