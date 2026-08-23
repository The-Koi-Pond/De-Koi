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

  it("routes automatic memory preview and commit through separate commands", async () => {
    const { chatCommandApi } = await import("./chat-command-api");
    const commit = {
      version: 1 as const,
      chatId: "chat-1",
      sourceMessageIds: ["message-1", "message-2"],
      fingerprint: "fingerprint-1",
      leaseId: "lease-1",
    };

    await chatCommandApi.memoryCapturePreview("chat-1", commit.sourceMessageIds);
    await chatCommandApi.memoryCaptureCommit(commit);

    expect(mocks.invokeTauri).toHaveBeenNthCalledWith(1, "chat_memory_capture_preview", {
      body: {
        version: 1,
        chatId: "chat-1",
        sourceMessageIds: ["message-1", "message-2"],
      },
    });
    expect(mocks.invokeTauri).toHaveBeenNthCalledWith(2, "chat_memory_capture_commit", {
      body: commit,
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
