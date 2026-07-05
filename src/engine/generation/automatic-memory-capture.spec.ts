import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LlmGateway } from "../capabilities/llm";
import type { StorageGateway } from "../capabilities/storage";
import type { CanonicalMemoryInput, CanonicalMemoryPatch } from "../contracts/types/memory";
import {
  captureAutomaticMemoriesAfterAssistantTurn,
  captureAutomaticMemoriesSafely,
} from "./automatic-memory-capture";

function llmWithExtraction(raw: string): LlmGateway {
  return {
    complete: vi.fn(async () => raw),
    async *stream() {
      yield { type: "done" };
    },
    listModels: vi.fn(async () => []),
  };
}

function memoryStorage() {
  const created: CanonicalMemoryInput[] = [];
  const patches: Array<{ memoryId: string; patch: CanonicalMemoryPatch }> = [];
  const rebuilds: unknown[] = [];
  const storage = {
    createMemory: vi.fn(async (input: CanonicalMemoryInput) => {
      created.push(input);
      return {
        id: `memory-${created.length}`,
        status: input.status ?? "active",
        tags: input.tags ?? [],
        payload: input.payload ?? {},
        createdAt: "2026-07-04T12:00:00.000Z",
        updatedAt: "2026-07-04T12:00:00.000Z",
        ...input,
      };
    }),
    updateMemory: vi.fn(async (memoryId: string, patch: CanonicalMemoryPatch) => {
      patches.push({ memoryId, patch });
      return { id: memoryId, ...patch };
    }),
    rebuildMemoryIndex: vi.fn(async (query: unknown) => {
      rebuilds.push(query);
      return { rebuilt: 1 };
    }),
  } as unknown as StorageGateway;
  return { storage, created, patches, rebuilds };
}

describe("automatic memory capture", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("extracts stable facts, preferences, promises, plot state, and contradictions into canonical memories", async () => {
    const { storage, created, patches, rebuilds } = memoryStorage();
    const llm = llmWithExtraction(
      JSON.stringify({
        memories: [
          { category: "stable_fact", content: "Mira keeps a brass key.", confidence: 0.91 },
          { category: "preference", content: "The user prefers concise recaps.", confidence: 0.88 },
          { category: "promise", content: "Aki promised to guard the north door.", confidence: 0.81 },
          { category: "plot_state", content: "The north door is sealed.", confidence: 0.76 },
          {
            category: "contradiction",
            content: "The brass key is silver now.",
            confidence: 0.95,
            supersedesMemoryId: "memory-old-key",
          },
        ],
      }),
    );

    await captureAutomaticMemoriesAfterAssistantTurn({
      storage,
      llm,
      chat: {
        id: "scene-chat",
        mode: "roleplay",
        metadata: { sceneStatus: "active" },
      },
      message: {
        id: "message-1",
        chatId: "scene-chat",
        role: "assistant",
        characterId: "character-1",
        content: "Mira keeps a brass key. The north door is sealed.",
        createdAt: "2026-07-04T12:00:00.000Z",
      },
      connectionId: "conn-1",
    });

    expect(created.map((memory) => memory.kind)).toEqual([
      "fact",
      "preference",
      "promise",
      "plot_state",
      "contradiction",
    ]);
    expect(created.every((memory) => memory.provenance.messageIds.includes("message-1"))).toBe(true);
    expect(created.every((memory) => memory.provenance.sourceChatId === "scene-chat")).toBe(true);
    expect(created.every((memory) => memory.provenance.sceneId === "scene-chat")).toBe(true);
    expect(created.every((memory) => memory.provenance.characterId === "character-1")).toBe(true);
    expect(created.every((memory) => memory.scope.kind === "scene")).toBe(true);
    expect(created[4]?.supersedesMemoryId).toBe("memory-old-key");
    expect(patches).toEqual([
      {
        memoryId: "memory-old-key",
        patch: { status: "superseded", supersededByMemoryId: "memory-5" },
      },
    ]);
    expect(rebuilds).toEqual([{ scope: { kind: "scene", id: "scene-chat" } }]);
  });

  it("stores uncertain extracted memories as stale and keeps going when indexing is unavailable", async () => {
    const { storage, created } = memoryStorage();
    vi.mocked(storage.rebuildMemoryIndex!).mockRejectedValueOnce(new Error("embedding unavailable"));
    const llm = llmWithExtraction(
      JSON.stringify({
        memories: [{ category: "relationship_change", content: "Aki may distrust Mira.", confidence: 0.52 }],
      }),
    );

    await captureAutomaticMemoriesAfterAssistantTurn({
      storage,
      llm,
      chat: { id: "chat-1", mode: "conversation", metadata: {} },
      message: {
        id: "message-1",
        chatId: "chat-1",
        role: "assistant",
        content: "Aki may distrust Mira.",
        createdAt: "2026-07-04T12:00:00.000Z",
      },
    });

    expect(created).toHaveLength(1);
    expect(created[0]?.kind).toBe("relationship_state");
    expect(created[0]?.status).toBe("stale");
  });

  it("supports agent chat provenance", async () => {
    const { storage, created, rebuilds } = memoryStorage();
    const llm = llmWithExtraction(
      JSON.stringify({
        memories: [{ category: "promise", content: "The researcher will check the source tomorrow.", confidence: 0.8 }],
      }),
    );

    await captureAutomaticMemoriesAfterAssistantTurn({
      storage,
      llm,
      chat: { id: "agent-chat", mode: "agent", metadata: { agentType: "researcher" } },
      message: {
        id: "message-1",
        chatId: "agent-chat",
        role: "assistant",
        content: "I will check the source tomorrow.",
        createdAt: "2026-07-04T12:00:00.000Z",
      },
    });

    expect(created[0]?.kind).toBe("promise");
    expect(created[0]?.scope).toEqual({ kind: "agent", id: "researcher" });
    expect(created[0]?.provenance.sourceChatId).toBe("agent-chat");
    expect(rebuilds).toEqual([{ scope: { kind: "agent", id: "researcher" } }]);
  });

  it("swallows extraction failures", async () => {
    const { storage } = memoryStorage();
    const llm = llmWithExtraction("{not json");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(
      captureAutomaticMemoriesSafely({
        storage,
        llm,
        chat: { id: "agent-chat", mode: "agent", metadata: { agentType: "researcher" } },
        message: {
          id: "message-1",
          chatId: "agent-chat",
          role: "assistant",
          content: "I will check the source tomorrow.",
          createdAt: "2026-07-04T12:00:00.000Z",
        },
      }),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith("[generation] automatic memory capture failed", expect.any(Error));
    expect(storage.createMemory).not.toHaveBeenCalled();
  });
});
