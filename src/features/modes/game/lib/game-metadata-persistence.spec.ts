import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Chat } from "../../../../engine/contracts/types/chat";

const storageApiMock = vi.hoisted(() => ({
  patchChatMetadata: vi.fn(),
}));

vi.mock("../../../../shared/api/storage-api", () => ({
  storageApi: storageApiMock,
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

type GameMetadataPersistenceModule = typeof import("./game-metadata-persistence");

function chat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: "chat-1",
    title: "Game Chat",
    mode: "game",
    characterIds: [],
    metadata: {},
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
    ...overrides,
  } as Chat;
}

describe("game metadata persistence", () => {
  let persistence: GameMetadataPersistenceModule;

  beforeEach(async () => {
    vi.resetModules();
    storageApiMock.patchChatMetadata.mockReset();
    persistence = await import("./game-metadata-persistence");
  });

  it("releases persisted chat handlers after a successful flush", async () => {
    const onPersisted = vi.fn();
    storageApiMock.patchChatMetadata.mockResolvedValueOnce(
      chat({ metadata: { round: 1 } as unknown as Chat["metadata"] }),
    );

    await persistence.persistGameMetadataPatch("chat-1", { round: 1 }, { onPersisted });

    expect(onPersisted).toHaveBeenCalledTimes(1);

    storageApiMock.patchChatMetadata.mockResolvedValueOnce(
      chat({ metadata: { round: 2 } as unknown as Chat["metadata"] }),
    );

    await persistence.persistGameMetadataPatch("chat-1", { round: 2 });

    expect(onPersisted).toHaveBeenCalledTimes(1);
  });
});
