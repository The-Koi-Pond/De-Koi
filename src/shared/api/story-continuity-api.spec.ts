import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CanonicalMemoryRecord, StoryProjectionPayload } from "../../engine/contracts/types/memory";
import { storyContinuityApi } from "./story-continuity-api";
import { storageApi } from "./storage-api";

vi.mock("./llm-api", () => ({ llmApi: {} }));

vi.mock("./storage-api", () => ({
  storageApi: {
    get: vi.fn(),
    updateMemory: vi.fn(),
  },
}));

function episode(status: CanonicalMemoryRecord["status"] = "active"): CanonicalMemoryRecord {
  const payload: StoryProjectionPayload = {
    storyProjectionVersion: 1,
    level: "episode",
    ownerChatId: "chat-1",
    coverageId: "coverage-1",
    messageIds: ["message-1", "message-2"],
    firstMessageId: "message-1",
    lastMessageId: "message-2",
    sourceFingerprint: "fingerprint-1",
    boundaryReason: "message_threshold",
    sourceEpisodeIds: [],
    sections: {
      events: [{ text: "Old event", sourceMessageIds: ["message-1"] }],
      choices: [{ text: "Old choice", sourceMessageIds: ["message-2"] }],
      relationshipShifts: [],
      promises: [],
      reveals: [],
      unresolvedHooks: [],
      currentState: [],
    },
    summarizer: { version: "story-projection-v1", completedAt: "2026-08-27T00:00:00.000Z" },
  };
  return {
    id: "episode-1",
    kind: "episode",
    status,
    scope: { kind: "chat", id: "chat-1" },
    title: "Episode 1",
    content: "Old prose",
    confidence: 0.9,
    provenance: { sourceChatId: "chat-1", messageIds: payload.messageIds },
    tags: ["story-continuity", "episode"],
    payload,
    supersedesMemoryId: null,
    supersededByMemoryId: null,
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
  };
}

describe("storyContinuityApi", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps edited prose and structured sections in the same provenance-backed revision", async () => {
    const memory = episode("stale");
    vi.mocked(storageApi.get).mockResolvedValue(memory);
    vi.mocked(storageApi.updateMemory!).mockResolvedValue({ ...memory, content: "Edited prose" });

    await storyContinuityApi.edit(memory.id, "  Edited prose  ");

    expect(storageApi.updateMemory).toHaveBeenCalledOnce();
    expect(storageApi.updateMemory).toHaveBeenCalledWith(
      memory.id,
      expect.objectContaining({
        content: "Edited prose",
        payload: expect.objectContaining({
          editedAt: expect.any(String),
          sections: {
            events: [{ text: "Edited prose", sourceMessageIds: ["message-1", "message-2"] }],
            choices: [],
            relationshipShifts: [],
            promises: [],
            reveals: [],
            unresolvedHooks: [],
            currentState: [{ text: "Edited prose", sourceMessageIds: ["message-1", "message-2"] }],
          },
        }),
      }),
    );
    expect(vi.mocked(storageApi.updateMemory!).mock.calls[0]?.[1]).not.toHaveProperty("status");
  });

  it("delegates supersession and its dependent cascade to one atomic storage command", async () => {
    const memory = episode();
    vi.mocked(storageApi.updateMemory!).mockResolvedValue({ ...memory, status: "superseded" });

    await expect(storyContinuityApi.supersede(memory)).resolves.toMatchObject({ status: "superseded" });

    expect(storageApi.updateMemory).toHaveBeenCalledOnce();
    expect(storageApi.updateMemory).toHaveBeenCalledWith(memory.id, { status: "superseded" });
  });
});
