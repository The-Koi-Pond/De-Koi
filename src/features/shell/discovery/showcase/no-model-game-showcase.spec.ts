import { beforeEach, describe, expect, it, vi } from "vitest";

import { storageApi } from "../../../../shared/api/storage-api";
import {
  ensureNoModelGameShowcase,
  NO_MODEL_GAME_SHOWCASE_CHAT_ID,
  NO_MODEL_GAME_SHOWCASE_ID,
} from "./no-model-game-showcase";

const storageStore = vi.hoisted(() => new Map<string, Record<string, unknown>>());

function storageKey(entity: string, id: string) {
  return `${entity}:${id}`;
}

vi.mock("../../../../shared/api/storage-api", () => ({
  storageApi: {
    get: vi.fn(async (entity: string, id: string) => storageStore.get(storageKey(entity, id)) ?? null),
    create: vi.fn(async (entity: string, value: Record<string, unknown>) => {
      storageStore.set(storageKey(entity, String(value.id)), { ...value });
      return value;
    }),
    patchChatMetadata: vi.fn(async (chatId: string, patch: Record<string, unknown>) => {
      const current = storageStore.get(storageKey("chats", chatId)) ?? { id: chatId, metadata: {} };
      const metadata = { ...((current.metadata as Record<string, unknown> | undefined) ?? {}), ...patch };
      const next = { ...current, metadata };
      storageStore.set(storageKey("chats", chatId), next);
      return next;
    }),
    delete: vi.fn(async (entity: string, id: string) => {
      storageStore.delete(storageKey(entity, id));
    }),
    createChatMessage: vi.fn(async (chatId: string, value: Record<string, unknown>) => {
      const record = { ...value, chatId };
      storageStore.set(storageKey("messages", String(value.id)), record);
      return record;
    }),
    listChatMessages: vi.fn(async (chatId: string) =>
      Array.from(storageStore.entries())
        .filter(([key, value]) => key.startsWith("messages:") && value.chatId === chatId)
        .map(([, value]) => value),
    ),
  },
}));

const mockedStorageApi = vi.mocked(storageApi);

describe("ensureNoModelGameShowcase", () => {
  beforeEach(() => {
    storageStore.clear();
    vi.clearAllMocks();
  });

  it("seeds deterministic showcase records once and marks the game chat ready", async () => {
    const first = await ensureNoModelGameShowcase();
    const createCallsAfterFirstOpen = mockedStorageApi.create.mock.calls.length;
    const messageCallsAfterFirstOpen = mockedStorageApi.createChatMessage.mock.calls.length;

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
          showcaseSeedStatus: "pending",
        }),
      }),
    );
    expect(mockedStorageApi.patchChatMetadata).toHaveBeenCalledWith(NO_MODEL_GAME_SHOWCASE_CHAT_ID, {
      showcaseSeedStatus: "ready",
    });
    expect(storageStore.get(storageKey("chats", NO_MODEL_GAME_SHOWCASE_CHAT_ID))?.metadata).toEqual(
      expect.objectContaining({
        showcaseKey: NO_MODEL_GAME_SHOWCASE_ID,
        showcaseVersion: 1,
        showcaseSeedStatus: "ready",
      }),
    );
    expect(mockedStorageApi.createChatMessage).toHaveBeenCalledWith(
      NO_MODEL_GAME_SHOWCASE_CHAT_ID,
      expect.objectContaining({
        role: "assistant",
        content: expect.stringContaining("Glasswake"),
      }),
    );
    expect(mockedStorageApi.create.mock.calls).toHaveLength(createCallsAfterFirstOpen);
    expect(mockedStorageApi.createChatMessage.mock.calls).toHaveLength(messageCallsAfterFirstOpen);
  });

  it("repairs missing child records for an existing showcase chat before marking it ready", async () => {
    storageStore.set(storageKey("chats", NO_MODEL_GAME_SHOWCASE_CHAT_ID), {
      id: NO_MODEL_GAME_SHOWCASE_CHAT_ID,
      metadata: {
        showcaseKey: NO_MODEL_GAME_SHOWCASE_ID,
        showcaseVersion: 1,
        showcaseSeedStatus: "pending",
        userEditedNote: "keep me",
      },
    });

    await ensureNoModelGameShowcase();

    expect(mockedStorageApi.create).not.toHaveBeenCalledWith(
      "chats",
      expect.objectContaining({ id: NO_MODEL_GAME_SHOWCASE_CHAT_ID }),
    );
    expect(mockedStorageApi.createChatMessage).toHaveBeenCalledTimes(4);
    expect(storageStore.get(storageKey("personas", "showcase-no-model-game-v1-persona"))).toBeTruthy();
    expect(storageStore.get(storageKey("lorebooks", "showcase-no-model-game-v1-lorebook"))).toBeTruthy();
    expect(storageStore.get(storageKey("lorebook-entries", "showcase-no-model-game-v1-lore-entry-bells"))).toBeTruthy();
    expect(storageStore.get(storageKey("lorebook-entries", "showcase-no-model-game-v1-lore-entry-token"))).toBeTruthy();
    expect(storageStore.get(storageKey("messages", "showcase-no-model-game-v1-message-4"))).toBeTruthy();

    const readyPatchOrder = mockedStorageApi.patchChatMetadata.mock.invocationCallOrder.at(-1);
    const lorebookEntryCreateOrder = mockedStorageApi.create.mock.invocationCallOrder.at(-1);
    expect(lorebookEntryCreateOrder).toBeLessThan(readyPatchOrder ?? 0);
    expect(storageStore.get(storageKey("chats", NO_MODEL_GAME_SHOWCASE_CHAT_ID))?.metadata).toEqual(
      expect.objectContaining({
        showcaseSeedStatus: "ready",
        userEditedNote: "keep me",
      }),
    );
  });

  it("rolls back newly-created showcase rows if message seeding fails", async () => {
    mockedStorageApi.createChatMessage.mockImplementation(async (chatId, value) => {
      if (value.id === "showcase-no-model-game-v1-message-2") throw new Error("message write failed");
      const record = { ...value, chatId };
      storageStore.set(storageKey("messages", String(value.id)), record);
      return record;
    });

    await expect(ensureNoModelGameShowcase()).rejects.toThrow("message write failed");

    expect(mockedStorageApi.patchChatMetadata).not.toHaveBeenCalled();
    expect(mockedStorageApi.delete).toHaveBeenCalledWith("messages", "showcase-no-model-game-v1-message-1");
    expect(mockedStorageApi.delete).toHaveBeenCalledWith("chats", NO_MODEL_GAME_SHOWCASE_CHAT_ID);
    expect(storageStore.get(storageKey("chats", NO_MODEL_GAME_SHOWCASE_CHAT_ID))).toBeUndefined();
  });
});
