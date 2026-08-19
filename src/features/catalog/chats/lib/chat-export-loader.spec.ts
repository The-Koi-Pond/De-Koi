import { describe, expect, it, vi } from "vitest";

import type { StorageGateway } from "../../../../engine/capabilities/storage";
import { listChatIdsForExport, loadChatsForExport } from "./chat-export-loader";

function exportStorage(overrides: Partial<StorageGateway> = {}): StorageGateway {
  return {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockImplementation(async (_entity, id) => ({ id, name: id })),
    listChatMessages: vi.fn().mockImplementation(async (chatId) => [{ id: `message-${chatId}`, chatId }]),
    ...overrides,
  } as unknown as StorageGateway;
}

describe("chat export loading", () => {
  it("projects only chat IDs when discovering an all-chat export", async () => {
    const storage = exportStorage({ list: vi.fn().mockResolvedValue([{ id: "chat-1" }, { id: "chat-2" }]) });

    await expect(listChatIdsForExport(storage)).resolves.toEqual(["chat-1", "chat-2"]);
    expect(storage.list).toHaveBeenCalledWith("chats", { fields: ["id"] });
  });

  it("deduplicates IDs while preserving caller order", async () => {
    const storage = exportStorage();

    const records = await loadChatsForExport(storage, [" chat-2 ", "chat-1", "chat-2"]);

    expect(records.map(({ chat }) => chat.id)).toEqual(["chat-2", "chat-1"]);
  });

  it("runs no more than four chat loads at once", async () => {
    let active = 0;
    let maximum = 0;
    const storage = exportStorage({
      get: vi.fn().mockImplementation(async (_entity, id) => {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return { id, name: id };
      }),
    });

    await loadChatsForExport(
      storage,
      Array.from({ length: 12 }, (_, index) => `chat-${index}`),
    );

    expect(maximum).toBe(4);
  });

  it("rejects a missing chat instead of producing a partial export", async () => {
    const storage = exportStorage({ get: vi.fn().mockResolvedValue(null) });

    await expect(loadChatsForExport(storage, ["missing-chat"])).rejects.toThrow("Chat was not found.");
  });
});
