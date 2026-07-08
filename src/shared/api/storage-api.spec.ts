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

    expect(invokeTauriMock).toHaveBeenNthCalledWith(1, "storage_create", {
      entity: "messages",
      value: expect.objectContaining({
        content: "Line 1\n\n\nLine 2",
        swipes: [expect.objectContaining({ content: "Line 1\n\n\nLine 2" })],
      }),
    });
    expect(invokeTauriMock).toHaveBeenNthCalledWith(2, "chat_message_add_swipe", {
      chatId: "chat-1",
      messageId: "message-blank",
      body: expect.objectContaining({ content: "Alt 1\n\n\nAlt 2" }),
    });
  });
  it("clears dialogue attribution metadata after message content edits", async () => {
    invokeTauriMock
      .mockResolvedValueOnce({
        id: "message-1",
        content: "Edited\n\nText",
        extra: { dialogueAttributions: { version: 1 }, thinking: "kept" },
      })
      .mockResolvedValueOnce({ id: "message-1", extra: { dialogueAttributions: { version: 1 }, thinking: "kept" } })
      .mockResolvedValueOnce({
        id: "message-1",
        content: "Edited\n\nText",
        extra: { dialogueAttributions: null, thinking: "kept" },
      });

    const { storageApi } = await import("./storage-api");

    await expect(storageApi.updateChatMessage("message-1", { content: "Edited\n\n\nText" })).resolves.toMatchObject({
      id: "message-1",
      content: "Edited\n\nText",
      extra: { dialogueAttributions: null, thinking: "kept" },
    });

    expect(invokeTauriMock).toHaveBeenNthCalledWith(1, "storage_update", {
      entity: "messages",
      id: "message-1",
      patch: { content: "Edited\n\nText" },
    });
    expect(invokeTauriMock).toHaveBeenNthCalledWith(2, "storage_get", {
      entity: "messages",
      id: "message-1",
      options: { fields: ["extra"] },
    });
    expect(invokeTauriMock).toHaveBeenNthCalledWith(3, "storage_update", {
      entity: "messages",
      id: "message-1",
      patch: { extra: { dialogueAttributions: null, thinking: "kept" } },
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

    expect(invokeTauriMock).toHaveBeenCalledWith("storage_delete", {
      entity: "connections",
      id: "connection-1",
      force: true,
    });
  });
});
