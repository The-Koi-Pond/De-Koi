import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeTauriMock = vi.hoisted(() => vi.fn());

vi.mock("./tauri-client", () => ({
  invokeTauri: invokeTauriMock,
}));

beforeEach(() => {
  invokeTauriMock.mockReset();
});

describe("storageApi prompt preset bundles", () => {
  it("loads a prompt preset bundle through one focused runtime call", async () => {
    invokeTauriMock.mockResolvedValueOnce({
      preset: { id: "preset-1", name: "Preset" },
      sections: [{ id: "section-1", presetId: "preset-1" }],
      groups: [{ id: "group-1", presetId: "preset-1" }],
      choiceBlocks: [{ id: "choice-1", presetId: "preset-1" }],
    });

    const { storageApi } = await import("./storage-api");

    await expect(storageApi.promptFull("preset-1")).resolves.toEqual({
      preset: { id: "preset-1", name: "Preset" },
      sections: [{ id: "section-1", presetId: "preset-1" }],
      groups: [{ id: "group-1", presetId: "preset-1" }],
      choiceBlocks: [{ id: "choice-1", presetId: "preset-1" }],
    });

    expect(invokeTauriMock).toHaveBeenCalledTimes(1);
    expect(invokeTauriMock).toHaveBeenCalledWith("prompt_preset_bundle", {
      presetId: "preset-1",
    });
  });
});

describe("storageApi chat message writes", () => {
  it("preserves generated message blank lines on create and swipe writes", async () => {
    invokeTauriMock
      .mockResolvedValueOnce({ id: "message-blank", content: "Line 1\n\n\nLine 2", extra: {}, swipes: [] })
      .mockResolvedValueOnce({ id: "message-blank", content: "Alt 1\n\n\nAlt 2" });

    const { storageApi } = await import("./storage-api");

    await storageApi.createChatMessage("chat-1", {
      role: "assistant",
      content: "Line 1\n\n\nLine 2",
      extra: {},
    });
    await storageApi.addChatMessageSwipe("chat-1", "message-blank", "Alt 1\n\n\nAlt 2", { extra: {} });

    expect(invokeTauriMock).toHaveBeenNthCalledWith(
      1,
      "storage_create",
      {
        entity: "messages",
        value: expect.objectContaining({
          content: "Line 1\n\n\nLine 2",
          swipes: [expect.objectContaining({ content: "Line 1\n\n\nLine 2" })],
        }),
      },
      { timeoutMs: null },
    );
    expect(invokeTauriMock).toHaveBeenNthCalledWith(2, "chat_message_add_swipe", {
      chatId: "chat-1",
      messageId: "message-blank",
      body: expect.objectContaining({ content: "Alt 1\n\n\nAlt 2" }),
    });
  });
});

describe("storageApi remote request deadlines", () => {
  it("opts durable mutations out while leaving reads on the default deadline", async () => {
    invokeTauriMock.mockResolvedValue({});
    const { storageApi } = await import("./storage-api");

    await storageApi.create("chats", { id: "chat-1", name: "Scene" });
    await storageApi.update("chats", "chat-1", { name: "Updated scene" });
    await storageApi.delete("chats", "chat-1");
    await storageApi.list("chats");
    await storageApi.get("chats", "chat-1");

    expect(invokeTauriMock).toHaveBeenNthCalledWith(
      1,
      "storage_create",
      {
        entity: "chats",
        value: { id: "chat-1", name: "Scene" },
      },
      { timeoutMs: null },
    );
    expect(invokeTauriMock).toHaveBeenNthCalledWith(
      2,
      "storage_update",
      {
        entity: "chats",
        id: "chat-1",
        patch: { name: "Updated scene" },
      },
      { timeoutMs: null },
    );
    expect(invokeTauriMock).toHaveBeenNthCalledWith(
      3,
      "storage_delete",
      {
        entity: "chats",
        id: "chat-1",
      },
      { timeoutMs: null },
    );
    expect(invokeTauriMock).toHaveBeenNthCalledWith(4, "storage_list", {
      entity: "chats",
      options: null,
    });
    expect(invokeTauriMock).toHaveBeenNthCalledWith(5, "storage_get", {
      entity: "chats",
      id: "chat-1",
      options: null,
    });
  });
});

describe("storageApi deletes", () => {
  it("forwards force deletes to the storage runtime", async () => {
    invokeTauriMock.mockResolvedValueOnce({ deleted: true });

    const { storageApi } = await import("./storage-api");

    await expect(storageApi.delete("connections", "connection-1", { force: true })).resolves.toEqual({
      deleted: true,
    });

    expect(invokeTauriMock).toHaveBeenCalledWith(
      "storage_delete",
      {
        entity: "connections",
        id: "connection-1",
        force: true,
      },
      { timeoutMs: null },
    );
  });

  it("forwards an explicit chat memory deletion policy and otherwise omits it", async () => {
    invokeTauriMock.mockResolvedValue({ deleted: true });
    const { storageApi } = await import("./storage-api");

    await storageApi.delete("chats", "chat-1", { deleteMemories: true });
    await storageApi.delete("chats", "chat-2");

    expect(invokeTauriMock).toHaveBeenNthCalledWith(
      1,
      "storage_delete",
      {
        entity: "chats",
        id: "chat-1",
        deleteMemories: true,
      },
      { timeoutMs: null },
    );
    expect(invokeTauriMock).toHaveBeenNthCalledWith(
      2,
      "storage_delete",
      {
        entity: "chats",
        id: "chat-2",
      },
      { timeoutMs: null },
    );
  });
});
