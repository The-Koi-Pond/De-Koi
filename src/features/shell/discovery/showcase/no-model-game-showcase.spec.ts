import { beforeEach, describe, expect, it, vi } from "vitest";

import { storageApi } from "../../../../shared/api/storage-api";
import {
  ensureNoModelGameShowcase,
  NO_MODEL_GAME_SHOWCASE_CHAT_ID,
  NO_MODEL_GAME_SHOWCASE_ID,
} from "./no-model-game-showcase";

vi.mock("../../../../shared/api/storage-api", () => ({
  storageApi: {
    get: vi.fn(),
    create: vi.fn(async (_entity: string, value: Record<string, unknown>) => value),
    createChatMessage: vi.fn(async (_chatId: string, value: Record<string, unknown>) => value),
    listChatMessages: vi.fn(async () => []),
  },
}));

const mockedStorageApi = vi.mocked(storageApi);

describe("ensureNoModelGameShowcase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedStorageApi.get.mockResolvedValue(null);
    mockedStorageApi.listChatMessages.mockResolvedValue([]);
  });

  it("seeds deterministic showcase records once and returns the game chat id", async () => {
    const first = await ensureNoModelGameShowcase();
    const second = await ensureNoModelGameShowcase();

    expect(first).toEqual({ chatId: NO_MODEL_GAME_SHOWCASE_CHAT_ID });
    expect(second).toEqual({ chatId: NO_MODEL_GAME_SHOWCASE_CHAT_ID });
    expect(mockedStorageApi.create).toHaveBeenCalledWith(
      "chats",
      expect.objectContaining({
        id: NO_MODEL_GAME_SHOWCASE_CHAT_ID,
        mode: "game",
        connectionId: null,
        metadata: expect.objectContaining({
          showcaseKey: NO_MODEL_GAME_SHOWCASE_ID,
          showcaseVersion: 1,
        }),
      }),
    );
    expect(mockedStorageApi.createChatMessage).toHaveBeenCalledWith(
      NO_MODEL_GAME_SHOWCASE_CHAT_ID,
      expect.objectContaining({
        role: "assistant",
        content: expect.stringContaining("Glasswake"),
      }),
    );

    const createCallsAfterFirstOpen = mockedStorageApi.create.mock.calls.length;
    mockedStorageApi.get.mockImplementation(async (entity, id) => ({ id, entity }));
    mockedStorageApi.listChatMessages.mockResolvedValue([{ id: "existing-message" }]);

    await ensureNoModelGameShowcase();

    expect(mockedStorageApi.create.mock.calls).toHaveLength(createCallsAfterFirstOpen);
  });
});
