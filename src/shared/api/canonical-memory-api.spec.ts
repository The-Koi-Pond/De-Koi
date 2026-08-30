import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CanonicalMemoryInput, KnowledgeEdgeInput, MemoryIndexRowInput } from "../../engine/contracts/types/memory";

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
    await canonicalMemoryApi.index.health();

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
    expect(mocks.invokeTauri).toHaveBeenNthCalledWith(5, "memory_index_health");
  });

  it("routes provider-backed semantic retrieval through one focused command", async () => {
    const { canonicalMemoryApi } = await import("./canonical-memory-api");
    const body = {
      queryText: "Do you still know what happened that night?",
      queries: [{ scope: { kind: "character" as const, id: "jester" } }],
      connectionId: "generation-connection",
      limit: 24,
      similarityThreshold: 0.28,
    };

    await canonicalMemoryApi.querySemantic(body);

    expect(mocks.invokeTauri).toHaveBeenCalledWith("memory_query_semantic", { body });
  });

  it("routes knowledge-edge lifecycle through focused commands", async () => {
    const { canonicalMemoryApi } = await import("./canonical-memory-api");
    const body: KnowledgeEdgeInput = {
      memoryId: "memory-1",
      holder: { kind: "character", id: "alice" },
      stance: "believes",
      provenance: [
        {
          kind: "user_edit",
          author: "user",
          messageIds: [],
          createdAt: "2026-08-30T12:00:00.000Z",
        },
      ],
    };

    await canonicalMemoryApi.knowledge.upsert(body);
    await canonicalMemoryApi.knowledge.query({ memoryIds: ["memory-1"], statuses: ["active"] });
    await canonicalMemoryApi.knowledge.approve("edge-1");
    await canonicalMemoryApi.knowledge.invalidate("edge-1", "source_message_deleted");

    expect(mocks.invokeTauri).toHaveBeenNthCalledWith(1, "knowledge_edge_upsert", { body });
    expect(mocks.invokeTauri).toHaveBeenNthCalledWith(2, "knowledge_edge_query", {
      body: { memoryIds: ["memory-1"], statuses: ["active"] },
    });
    expect(mocks.invokeTauri).toHaveBeenNthCalledWith(3, "knowledge_edge_approve", { edgeId: "edge-1" });
    expect(mocks.invokeTauri).toHaveBeenNthCalledWith(4, "knowledge_edge_invalidate", {
      edgeId: "edge-1",
      reason: "source_message_deleted",
    });
  });
});
