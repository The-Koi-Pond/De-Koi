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
  it("clears dialogue attribution metadata after message content edits", async () => {
    invokeTauriMock
      .mockResolvedValueOnce({ id: "message-1", content: "Edited\n\nText", extra: { dialogueAttributions: { version: 1 }, thinking: "kept" } })
      .mockResolvedValueOnce({ id: "message-1", extra: { dialogueAttributions: { version: 1 }, thinking: "kept" } })
      .mockResolvedValueOnce({ id: "message-1", content: "Edited\n\nText", extra: { dialogueAttributions: null, thinking: "kept" } });

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