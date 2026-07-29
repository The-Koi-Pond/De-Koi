import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invokeTauri: vi.fn(),
}));

vi.mock("./tauri-client", () => ({
  invokeTauri: mocks.invokeTauri,
}));

describe("chatCommandApi", () => {
  beforeEach(() => {
    mocks.invokeTauri.mockReset();
    mocks.invokeTauri.mockResolvedValue({ id: "memory-1" });
  });

  it("routes manual memory creation through the focused chat command", async () => {
    const { chatCommandApi } = await import("./chat-command-api");

    await chatCommandApi.memoryCreate("chat-1", {
      content: "The ferry leaves before dawn.",
    });

    expect(mocks.invokeTauri).toHaveBeenCalledWith("chat_memory_create", {
      chatId: "chat-1",
      body: { content: "The ferry leaves before dawn." },
    });
  });

  it("forwards the explicit memory policy for group deletion", async () => {
    const { chatCommandApi } = await import("./chat-command-api");

    await chatCommandApi.groupDelete("group-1", { deleteMemories: true });

    expect(mocks.invokeTauri).toHaveBeenCalledWith("chat_group_delete", {
      groupId: "group-1",
      deleteMemories: true,
    });
  });

  it("opts durable message deletion out of the finite remote deadline", async () => {
    mocks.invokeTauri.mockResolvedValueOnce({ deleted: 1 });
    const { chatCommandApi } = await import("./chat-command-api");

    await expect(chatCommandApi.bulkDeleteMessages("chat-1", ["message-1"])).resolves.toEqual({ deleted: 1 });

    expect(mocks.invokeTauri).toHaveBeenCalledWith(
      "chat_messages_bulk_delete",
      {
        chatId: "chat-1",
        messageIds: ["message-1"],
      },
      { timeoutMs: null },
    );
  });
});
