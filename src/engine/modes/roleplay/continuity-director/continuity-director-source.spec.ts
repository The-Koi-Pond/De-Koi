import { describe, expect, it, vi } from "vitest";

import type { StorageGateway } from "../../../capabilities/storage";
import type { CanonicalMemoryRecord, KnowledgeEdge, StoryProjectionPayload } from "../../../contracts/types/memory";
import { loadContinuityDirectorSource } from "./continuity-director-source";

function story(id: string, level: "episode" | "arc", status: CanonicalMemoryRecord["status"]): CanonicalMemoryRecord {
  const payload: StoryProjectionPayload = {
    storyProjectionVersion: 1,
    level,
    ownerChatId: "chat-1",
    coverageId: `${id}-coverage`,
    sourceFingerprint: `${id}-fingerprint`,
    messageIds: ["m1", "m2"],
    firstMessageId: "m1",
    lastMessageId: "m2",
    sourceEpisodeIds: level === "arc" ? ["episode-1"] : [],
    sections: {
      events: [{ text: `${id} event`, sourceMessageIds: ["m1"] }],
      choices: [],
      relationshipShifts: [],
      promises: [],
      reveals: [],
      unresolvedHooks: [{ text: `${id} hook`, sourceMessageIds: ["m2"] }],
      currentState: [{ text: `${id} state`, sourceMessageIds: ["m2"] }],
    },
    summarizer: { version: "test", completedAt: "2026-09-02T10:00:00.000Z" },
  };
  return {
    id,
    kind: "summary",
    status,
    scope: { kind: "chat", id: "chat-1" },
    content: `${id} summary`,
    confidence: 1,
    provenance: { messageIds: ["m1", "m2"] },
    title: id,
    tags: [],
    payload,
    createdAt: level === "arc" ? "2026-09-01T10:00:00.000Z" : "2026-09-02T10:00:00.000Z",
    updatedAt: level === "arc" ? "2026-09-01T10:00:00.000Z" : "2026-09-02T10:00:00.000Z",
  };
}

function fact(): CanonicalMemoryRecord {
  return {
    id: "fact-1",
    kind: "fact",
    status: "active",
    scope: { kind: "chat", id: "chat-1" },
    content: "The watch captain forged the seal.",
    confidence: 0.9,
    provenance: { messageIds: ["m2"] },
    tags: [],
    payload: {},
    createdAt: "2026-09-02T10:00:00.000Z",
    updatedAt: "2026-09-02T10:00:00.000Z",
  };
}

describe("continuity director source", () => {
  it("loads bounded visible story and knowledge context without mutating it", async () => {
    const memories = [
      story("arc-1", "arc", "pinned"),
      story("episode-1", "episode", "active"),
      story("old", "episode", "superseded"),
      fact(),
    ];
    const edges: KnowledgeEdge[] = [
      {
        id: "edge-1",
        memoryId: "fact-1",
        holder: { kind: "character", id: "mara" },
        stance: "suspects",
        status: "active",
        provenance: [],
        createdAt: "2026-09-02T10:00:00.000Z",
        updatedAt: "2026-09-02T10:00:00.000Z",
      },
      {
        id: "edge-unrelated",
        memoryId: "fact-1",
        holder: { kind: "character", id: "outsider" },
        stance: "knows",
        status: "active",
        provenance: [],
        createdAt: "2026-09-02T10:00:00.000Z",
        updatedAt: "2026-09-02T10:00:00.000Z",
      },
    ];
    const get = vi.fn(async (entity: string, id: string) => {
      if (entity === "chats") {
        return {
          id,
          mode: "roleplay",
          connectionId: "writer",
          characterIds: ["mara"],
          personaId: "celia",
          metadata: {},
        };
      }
      if (entity === "characters" && id === "mara") return { id, data: { name: "Mara" } };
      if (entity === "personas" && id === "celia") return { id, name: "Celia" };
      return null;
    });
    const storage = {
      get,
      listChatMessages: vi.fn(async () => [
        { id: "m1", role: "user", content: "We enter the watch house." },
        { id: "hidden-ai", role: "assistant", content: "secret agent note", extra: { hiddenFromAI: true } },
        { id: "hidden-user", role: "assistant", content: "hidden command", extra: { hiddenFromUser: true } },
        { id: "m2", role: "assistant", content: "Mara studies the seal." },
      ]),
      queryMemories: vi.fn(async () => memories),
      queryKnowledgeEdges: vi.fn(async () => edges),
    } as unknown as StorageGateway;

    const source = await loadContinuityDirectorSource(storage, "chat-1");

    expect(source.transcript).toEqual([
      { id: "m1", role: "user", content: "We enter the watch house." },
      { id: "m2", role: "assistant", content: "Mara studies the seal." },
    ]);
    expect(source.story.map((item) => item.id)).toEqual(["arc-1", "episode-1"]);
    expect(source.knowledge).toEqual([
      {
        edgeId: "edge-1",
        memoryId: "fact-1",
        holder: { kind: "character", id: "mara", name: "Mara" },
        stance: "suspects",
        fact: "The watch captain forged the seal.",
      },
    ]);
    expect(source.personaNames).toEqual(["Celia"]);
    expect(source.sourceSnapshot).toMatchObject({
      storyProjectionIds: ["arc-1", "episode-1"],
      knowledgeEdgeIds: ["edge-1"],
      lastMessageId: "m2",
      visibleAssistantTurnCount: 1,
      generatedAt: expect.any(String),
      fingerprint: expect.stringMatching(/^continuity-source-/),
    });
    expect(storage.queryKnowledgeEdges).toHaveBeenCalledWith({
      memoryIds: ["arc-1", "episode-1", "fact-1"],
      statuses: ["active"],
    });
  });

  it("rejects missing and non-Roleplay chats", async () => {
    const missing = { get: vi.fn(async () => null) } as unknown as StorageGateway;
    await expect(loadContinuityDirectorSource(missing, "missing")).rejects.toThrow("Chat not found");

    const game = { get: vi.fn(async () => ({ id: "game", mode: "game" })) } as unknown as StorageGateway;
    await expect(loadContinuityDirectorSource(game, "game")).rejects.toThrow("Roleplay");
  });

  it("keeps the fingerprint stable when only source timestamps change", async () => {
    const projection = story("episode-1", "episode", "active");
    const storage = {
      get: vi.fn(async (entity: string, id: string) =>
        entity === "chats" ? { id, mode: "roleplay", characterIds: [], metadata: {} } : null,
      ),
      listChatMessages: vi.fn(async () => [{ id: "m2", role: "assistant", content: "Mara studies the seal." }]),
      queryMemories: vi.fn(async () => [projection]),
    } as unknown as StorageGateway;

    const first = await loadContinuityDirectorSource(storage, "chat-1");
    projection.updatedAt = "2026-09-02T11:00:00.000Z";
    const second = await loadContinuityDirectorSource(storage, "chat-1");

    expect(second.story[0]?.updatedAt).not.toBe(first.story[0]?.updatedAt);
    expect(second.sourceSnapshot.fingerprint).toBe(first.sourceSnapshot.fingerprint);
  });
});
