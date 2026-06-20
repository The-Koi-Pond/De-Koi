import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  saveDialog: vi.fn(),
  triggerDownload: vi.fn(),
  invokeTauri: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: mocks.saveDialog,
}));

vi.mock("./download-payload", () => ({
  triggerDownload: mocks.triggerDownload,
}));

vi.mock("./tauri-client", () => ({
  invokeTauri: mocks.invokeTauri,
}));

describe("saveTextFileToUserSelectedLocation", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.saveDialog.mockReset();
    mocks.triggerDownload.mockReset();
    mocks.invokeTauri.mockReset();
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("uses the browser save picker in non-embedded runtimes without Tauri IPC", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const createWritable = vi.fn().mockResolvedValue({ write, close });
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = vi
      .fn()
      .mockResolvedValue({ createWritable });

    const { saveTextFileToUserSelectedLocation } = await import("./save-text-file-api");
    const result = await saveTextFileToUserSelectedLocation({
      filename: "agent.json",
      content: "{}",
      mimeType: "application/json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });

    expect(result).toBe("saved");
    expect(mocks.saveDialog).not.toHaveBeenCalled();
    expect(mocks.invokeTauri).not.toHaveBeenCalled();
    expect((window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker).toHaveBeenCalledWith({
      suggestedName: "agent.json",
      types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
    });
    expect(write).toHaveBeenCalledWith(expect.any(Blob));
    expect(close).toHaveBeenCalled();
  });

  it("passes every requested filter to the browser save picker", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const createWritable = vi.fn().mockResolvedValue({ write, close });
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = vi
      .fn()
      .mockResolvedValue({ createWritable });

    const { saveTextFileToUserSelectedLocation } = await import("./save-text-file-api");
    await saveTextFileToUserSelectedLocation({
      filename: "agent.json",
      content: "{}",
      mimeType: "application/json",
      filters: [
        { name: "JSON", extensions: ["json"] },
        { name: "Marinara Agent", extensions: ["marinara-agent.json"] },
      ],
    });

    expect((window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker).toHaveBeenCalledWith({
      suggestedName: "agent.json",
      types: [
        { description: "JSON", accept: { "application/json": [".json"] } },
        { description: "Marinara Agent", accept: { "application/json": [".marinara-agent.json"] } },
      ],
    });
  });

  it("surfaces browser save picker failures instead of falling back to download", async () => {
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = vi
      .fn()
      .mockRejectedValue(new Error("picker blocked"));

    const { saveTextFileToUserSelectedLocation } = await import("./save-text-file-api");
    await expect(saveTextFileToUserSelectedLocation({ filename: "agent.json", content: "{}" })).rejects.toThrow(
      "picker blocked",
    );

    expect(mocks.triggerDownload).not.toHaveBeenCalled();
  });

  it("surfaces browser write failures after a save handle is selected", async () => {
    const write = vi.fn().mockRejectedValue(new Error("disk full"));
    const close = vi.fn().mockResolvedValue(undefined);
    const createWritable = vi.fn().mockResolvedValue({ write, close });
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = vi
      .fn()
      .mockResolvedValue({ createWritable });

    const { saveTextFileToUserSelectedLocation } = await import("./save-text-file-api");
    await expect(saveTextFileToUserSelectedLocation({ filename: "agent.json", content: "{}" })).rejects.toThrow(
      "disk full",
    );

    expect(mocks.triggerDownload).not.toHaveBeenCalled();
  });

  it("surfaces native dialog errors in embedded Tauri instead of falling back", async () => {
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
    mocks.saveDialog.mockRejectedValue(new Error("dialog denied"));

    const { saveTextFileToUserSelectedLocation } = await import("./save-text-file-api");
    await expect(saveTextFileToUserSelectedLocation({ filename: "agent.json", content: "{}" })).rejects.toThrow(
      "dialog denied",
    );

    expect(mocks.invokeTauri).not.toHaveBeenCalled();
    expect(mocks.triggerDownload).not.toHaveBeenCalled();
  });

  it("writes through Tauri only after an embedded native path is selected", async () => {
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
    mocks.saveDialog.mockResolvedValue("C:\\exports\\agent.json");
    mocks.invokeTauri.mockResolvedValue({ saved: true });

    const { saveTextFileToUserSelectedLocation } = await import("./save-text-file-api");
    const result = await saveTextFileToUserSelectedLocation({ filename: "agent.json", content: "{}" });

    expect(result).toBe("saved");
    expect(mocks.invokeTauri).toHaveBeenCalledWith("local_text_file_save", {
      path: "C:\\exports\\agent.json",
      content: "{}",
    });
    expect(mocks.triggerDownload).not.toHaveBeenCalled();
  });

  it("falls back to browser download in non-embedded runtimes without a save picker", async () => {
    const { saveTextFileToUserSelectedLocation } = await import("./save-text-file-api");
    const result = await saveTextFileToUserSelectedLocation({ filename: "agent.json", content: "{}" });

    expect(result).toBe("downloaded");
    expect(mocks.saveDialog).not.toHaveBeenCalled();
    expect(mocks.invokeTauri).not.toHaveBeenCalled();
    expect(mocks.triggerDownload).toHaveBeenCalledWith({ blob: expect.any(Blob), filename: "agent.json" });
  });

  it("does not take the native save path from a broad Tauri marker without IPC", async () => {
    (window as unknown as { __TAURI__: unknown }).__TAURI__ = {};

    const { canUseEmbeddedNativeTextFileSave, saveTextFileToUserSelectedLocation } = await import(
      "./save-text-file-api"
    );
    const result = await saveTextFileToUserSelectedLocation({ filename: "agent.json", content: "{}" });

    expect(canUseEmbeddedNativeTextFileSave()).toBe(false);
    expect(result).toBe("downloaded");
    expect(mocks.saveDialog).not.toHaveBeenCalled();
    expect(mocks.invokeTauri).not.toHaveBeenCalled();
    expect(mocks.triggerDownload).toHaveBeenCalledWith({ blob: expect.any(Blob), filename: "agent.json" });
  });
});
