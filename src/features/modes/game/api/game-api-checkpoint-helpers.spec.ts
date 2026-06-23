import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const storageApi = {
    get: vi.fn(),
    list: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  };
  return { storageApi };
});

vi.mock("./game-api-support", () => ({
  storageApi: mocks.storageApi,
  getChat: vi.fn(async () => ({
    id: "chat-7",
    metadata: { gameTimeFormatted: "Dusk" },
    gameState: { location: "Old Gate", weather: "rain" },
  })),
  chatMeta: vi.fn((chat: { metadata?: Record<string, unknown> } | null | undefined) => chat?.metadata ?? {}),
  asRecord: vi.fn((value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {},
  ),
  readTrimmed: vi.fn((value: unknown) => (typeof value === "string" ? value.trim() : "")),
  listMessages: vi.fn(async () => [
    { id: "latest-message", createdAt: "2026-06-23T15:00:00.000Z" },
  ]),
}));

import { createGameCheckpoint } from "./game-api-checkpoint-helpers";

describe("createGameCheckpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.storageApi.create.mockImplementation(async (collection: string) => {
      if (collection === "game-state-snapshots") return { id: "snapshot-1" };
      if (collection === "game-checkpoints") return { id: "checkpoint-1" };
      return { id: "record-1" };
    });
  });

  it("anchors manual checkpoints to the selected source message when provided", async () => {
    await createGameCheckpoint({
      chatId: "chat-7",
      label: "Gate choice",
      triggerType: "manual",
      sourceMessageId: "msg-42",
    });

    expect(mocks.storageApi.create).toHaveBeenCalledWith(
      "game-state-snapshots",
      expect.objectContaining({ messageId: "msg-42" }),
    );
    expect(mocks.storageApi.create).toHaveBeenCalledWith(
      "game-checkpoints",
      expect.objectContaining({ messageId: "msg-42" }),
    );
  });
});