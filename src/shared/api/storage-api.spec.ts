import { describe, expect, it, vi } from "vitest";

const invokeTauriMock = vi.hoisted(() => vi.fn());

vi.mock("./tauri-client", () => ({
  invokeTauri: invokeTauriMock,
}));

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
