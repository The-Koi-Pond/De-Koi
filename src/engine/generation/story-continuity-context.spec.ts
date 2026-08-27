import { describe, expect, it } from "vitest";
import type { StorageGateway } from "../capabilities/storage";
import type { CanonicalMemoryRecord, StoryProjectionPayload } from "../contracts/types/memory";
import { buildStoryContinuityContext } from "./story-continuity-context";

function projection(
  id: string,
  level: "episode" | "arc",
  messageIds: string[],
  content: string,
  options: { status?: CanonicalMemoryRecord["status"]; sourceEpisodeIds?: string[]; createdAt?: string } = {},
): CanonicalMemoryRecord {
  const payload: StoryProjectionPayload = {
    storyProjectionVersion: 1,
    level,
    ownerChatId: "chat-1",
    coverageId: `${id}-coverage`,
    sourceFingerprint: `${id}-fingerprint`,
    messageIds,
    firstMessageId: messageIds[0] ?? "",
    lastMessageId: messageIds.at(-1) ?? "",
    boundaryReason: level === "episode" ? "message_threshold" : null,
    sourceEpisodeIds: options.sourceEpisodeIds ?? [],
    sections: {
      events: [], choices: [], relationshipShifts: [], promises: [], reveals: [], unresolvedHooks: [], currentState: [],
    },
    summarizer: { version: "story-projection-v1", completedAt: options.createdAt ?? "2026-01-01T00:00:00.000Z" },
  };
  return {
    id,
    kind: level === "episode" ? "episode" : "summary",
    status: options.status ?? "active",
    scope: { kind: "chat", id: "chat-1" },
    title: id,
    content,
    confidence: 0.9,
    provenance: { sourceChatId: "chat-1", messageIds, timestamp: options.createdAt ?? "2026-01-01T00:00:00.000Z" },
    tags: ["story-continuity", level],
    payload,
    createdAt: options.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: options.createdAt ?? "2026-01-01T00:00:00.000Z",
  };
}

function storage(rows: CanonicalMemoryRecord[]): StorageGateway {
  return { queryMemories: async () => rows } as StorageGateway;
}

describe("story continuity prompt context", () => {
  it("selects a recent episode, relevant older episode, and a non-duplicating arc", async () => {
    const rows = [
      projection("ep-1", "episode", ["m1", "m2"], "Mara found the brass key.", { createdAt: "2026-01-01T00:00:00Z" }),
      projection("ep-2", "episode", ["m3", "m4"], "The party crossed the frozen lake.", { createdAt: "2026-01-02T00:00:00Z" }),
      projection("ep-3", "episode", ["m5", "m6"], "Mara promised to return the brass key.", { createdAt: "2026-01-03T00:00:00Z" }),
      projection("arc-1", "arc", ["m1", "m2", "m3", "m4"], "The northern journey began.", {
        sourceEpisodeIds: ["ep-1", "ep-2"], createdAt: "2026-01-04T00:00:00Z",
      }),
      projection("arc-2", "arc", ["m7", "m8"], "The court conspiracy deepened.", {
        sourceEpisodeIds: ["ep-4", "ep-5"], createdAt: "2026-01-05T00:00:00Z",
      }),
    ];
    const result = await buildStoryContinuityContext(storage(rows), {
      chat: { id: "chat-1", mode: "roleplay", metadata: { enableMemoryRecall: true } },
      storedMessages: [],
      latestUserInput: "Where is Mara's brass key?",
    });
    expect(result?.selectedMemoryIds).toEqual(["ep-3", "ep-1", "arc-2"]);
    expect(result?.attributionItems[0]?.kind).toBe("story_projection");
  });

  it("excludes stale projections and coverage overlapping retained raw history", async () => {
    const result = await buildStoryContinuityContext(
      storage([
        projection("recent", "episode", ["m9", "m10"], "Already visible."),
        projection("stale", "episode", ["m1", "m2"], "Old invalid text.", { status: "stale" }),
        projection("safe", "episode", ["m3", "m4"], "A distant promise remains."),
      ]),
      {
        chat: { id: "chat-1", mode: "roleplay", metadata: { enableMemoryRecall: true } },
        storedMessages: [{ id: "m9" }, { id: "m10" }],
        retainedRawMessageIds: ["m9", "m10"],
        latestUserInput: "promise",
      },
    );
    expect(result?.selectedMemoryIds).toEqual(["safe"]);
    expect(result?.block).not.toContain("Already visible");
    expect(result?.block).not.toContain("invalid");
  });

  it("removes sentences already supplied by summaries or atomic memories", async () => {
    const result = await buildStoryContinuityContext(
      storage([projection("ep", "episode", ["m1", "m2"], "Mara found the brass key. The vault remains sealed.")]),
      {
        chat: { id: "chat-1", mode: "roleplay", metadata: { enableMemoryRecall: true } },
        storedMessages: [],
        latestUserInput: "vault key",
        representedText: ["Mara found the brass key."],
      },
    );
    expect(result?.block).not.toContain("Mara found the brass key");
    expect(result?.block).toContain("The vault remains sealed");
  });

  it("is disabled outside Roleplay or Memory Recall but keeps existing projections when automatic building is off", async () => {
    const rows = [projection("ep", "episode", ["m1", "m2"], "Something happened.")];
    await expect(buildStoryContinuityContext(storage(rows), {
      chat: { id: "chat-1", mode: "conversation", metadata: { enableMemoryRecall: true } }, storedMessages: [], latestUserInput: "what",
    })).resolves.toBeNull();
    await expect(buildStoryContinuityContext(storage(rows), {
      chat: { id: "chat-1", mode: "roleplay", metadata: { enableMemoryRecall: true, enableStoryConsolidation: false } }, storedMessages: [], latestUserInput: "what",
    })).resolves.toEqual(expect.objectContaining({ selectedMemoryIds: ["ep"] }));
    await expect(buildStoryContinuityContext(storage(rows), {
      chat: { id: "chat-1", mode: "roleplay", metadata: { enableMemoryRecall: false } }, storedMessages: [], latestUserInput: "what",
    })).resolves.toBeNull();
  });
});
