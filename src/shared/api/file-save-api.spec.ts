import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  saveDialog: vi.fn(),
  triggerDownload: vi.fn(),
  invokeTauri: vi.fn(),
  hasEmbeddedTauriIpc: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: mocks.saveDialog,
}));

vi.mock("./download-payload", () => ({
  triggerDownload: mocks.triggerDownload,
}));

vi.mock("./tauri-client", () => ({
  hasEmbeddedTauriIpc: mocks.hasEmbeddedTauriIpc,
  invokeTauri: mocks.invokeTauri,
}));

describe("saveTextFileToUserSelectedLocation", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.saveDialog.mockReset();
    mocks.triggerDownload.mockReset();
    mocks.invokeTauri.mockReset();
    mocks.hasEmbeddedTauriIpc.mockReset();
    mocks.hasEmbeddedTauriIpc.mockReturnValue(false);
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

    const { saveTextFileToUserSelectedLocation } = await import("./file-save-api");
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

    const { saveTextFileToUserSelectedLocation } = await import("./file-save-api");
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

  it("preserves per-filter MIME mappings in the browser save picker", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const createWritable = vi.fn().mockResolvedValue({ write, close });
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = vi
      .fn()
      .mockResolvedValue({ createWritable });

    const { saveFileToUserSelectedLocation } = await import("./file-save-api");
    await saveFileToUserSelectedLocation({
      filename: "export.bin",
      blob: new Blob(["x"], { type: "application/octet-stream" }),
      filters: [
        { name: "JSON", extensions: ["json"], mimeType: "application/json" },
        { name: "PNG", extensions: ["png"], mimeType: "image/png" },
      ],
    });

    expect((window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker).toHaveBeenCalledWith({
      suggestedName: "export.bin",
      types: [
        { description: "JSON", accept: { "application/json": [".json"] } },
        { description: "PNG", accept: { "image/png": [".png"] } },
      ],
    });
  });

  it("surfaces browser save picker failures instead of falling back to download", async () => {
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = vi
      .fn()
      .mockRejectedValue(new Error("picker blocked"));

    const { saveTextFileToUserSelectedLocation } = await import("./file-save-api");
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

    const { saveTextFileToUserSelectedLocation } = await import("./file-save-api");
    await expect(saveTextFileToUserSelectedLocation({ filename: "agent.json", content: "{}" })).rejects.toThrow(
      "disk full",
    );

    expect(mocks.triggerDownload).not.toHaveBeenCalled();
  });

  it("attempts to close browser writable streams after write failures", async () => {
    const write = vi.fn().mockRejectedValue(new Error("disk full"));
    const close = vi.fn().mockResolvedValue(undefined);
    const createWritable = vi.fn().mockResolvedValue({ write, close });
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = vi
      .fn()
      .mockResolvedValue({ createWritable });

    const { saveTextFileToUserSelectedLocation } = await import("./file-save-api");
    await expect(saveTextFileToUserSelectedLocation({ filename: "agent.json", content: "{}" })).rejects.toThrow(
      "disk full",
    );

    expect(close).toHaveBeenCalled();
  });

  it("surfaces browser close failures after writes complete", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockRejectedValue(new Error("flush failed"));
    const createWritable = vi.fn().mockResolvedValue({ write, close });
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = vi
      .fn()
      .mockResolvedValue({ createWritable });

    const { saveTextFileToUserSelectedLocation } = await import("./file-save-api");
    await expect(saveTextFileToUserSelectedLocation({ filename: "agent.json", content: "{}" })).rejects.toThrow(
      "flush failed",
    );
  });

  it("reports browser write failures as primary when close also fails", async () => {
    const write = vi.fn().mockRejectedValue(new Error("disk full"));
    const close = vi.fn().mockRejectedValue(new Error("flush failed"));
    const createWritable = vi.fn().mockResolvedValue({ write, close });
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = vi
      .fn()
      .mockResolvedValue({ createWritable });

    const { saveTextFileToUserSelectedLocation } = await import("./file-save-api");
    await expect(saveTextFileToUserSelectedLocation({ filename: "agent.json", content: "{}" })).rejects.toThrow(
      "Failed to write saved file: disk full",
    );
    expect(close).toHaveBeenCalled();
  });

  it("surfaces native dialog errors in embedded Tauri instead of falling back", async () => {
    mocks.hasEmbeddedTauriIpc.mockReturnValue(true);
    mocks.saveDialog.mockRejectedValue(new Error("dialog denied"));

    const { saveTextFileToUserSelectedLocation } = await import("./file-save-api");
    await expect(saveTextFileToUserSelectedLocation({ filename: "agent.json", content: "{}" })).rejects.toThrow(
      "dialog denied",
    );

    expect(mocks.invokeTauri).not.toHaveBeenCalled();
    expect(mocks.triggerDownload).not.toHaveBeenCalled();
  });

  it("writes through Tauri only after an embedded native path is selected", async () => {
    mocks.hasEmbeddedTauriIpc.mockReturnValue(true);
    mocks.saveDialog.mockResolvedValue("C:\\exports\\agent.json");
    mocks.invokeTauri.mockResolvedValue({ saved: true });

    const { saveTextFileToUserSelectedLocation } = await import("./file-save-api");
    const result = await saveTextFileToUserSelectedLocation({ filename: "agent.json", content: "{}" });

    expect(result).toBe("saved");
    expect(mocks.invokeTauri).toHaveBeenCalledWith("local_file_save", {
      path: "C:\\exports\\agent.json",
      base64: "e30=",
      sessionId: expect.any(String),
      append: false,
      complete: true,
    });
    expect(mocks.triggerDownload).not.toHaveBeenCalled();
  });

  it("writes embedded native blobs in bounded chunks", async () => {
    mocks.hasEmbeddedTauriIpc.mockReturnValue(true);
    mocks.saveDialog.mockResolvedValue("C:\\exports\\large.bin");
    mocks.invokeTauri.mockResolvedValue({ saved: true });
    const oneMiB = 1024 * 1024;
    const bytes = new Uint8Array(oneMiB + 1);
    bytes.fill(65);
    bytes[oneMiB] = 66;

    const { saveFileToUserSelectedLocation } = await import("./file-save-api");
    const result = await saveFileToUserSelectedLocation({
      filename: "large.bin",
      blob: new Blob([bytes], { type: "application/octet-stream" }),
    });

    expect(result).toBe("saved");
    expect(mocks.invokeTauri).toHaveBeenCalledTimes(2);
    expect(mocks.invokeTauri).toHaveBeenNthCalledWith(1, "local_file_save", {
      path: "C:\\exports\\large.bin",
      base64: expect.any(String),
      sessionId: expect.any(String),
      append: false,
      complete: false,
    });
    expect(mocks.invokeTauri).toHaveBeenNthCalledWith(2, "local_file_save", {
      path: "C:\\exports\\large.bin",
      base64: "Qg==",
      sessionId: expect.any(String),
      append: true,
      complete: true,
    });
  });

  it("cleans up embedded native temp saves after a later chunk fails", async () => {
    mocks.hasEmbeddedTauriIpc.mockReturnValue(true);
    mocks.saveDialog.mockResolvedValue("C:\\exports\\large.bin");
    mocks.invokeTauri
      .mockResolvedValueOnce({ saved: true })
      .mockRejectedValueOnce(new Error("append failed"))
      .mockResolvedValueOnce({ cleaned: true });
    const oneMiB = 1024 * 1024;
    const bytes = new Uint8Array(oneMiB + 1);
    bytes.fill(65);
    bytes[oneMiB] = 66;

    const { saveFileToUserSelectedLocation } = await import("./file-save-api");
    await expect(
      saveFileToUserSelectedLocation({
        filename: "large.bin",
        blob: new Blob([bytes], { type: "application/octet-stream" }),
      }),
    ).rejects.toThrow("append failed");

    const firstWriteCall = mocks.invokeTauri.mock.calls[0];
    const failedWriteCall = mocks.invokeTauri.mock.calls[1];
    const cleanupCall = mocks.invokeTauri.mock.calls[2];
    const sessionId = (firstWriteCall[1] as { sessionId: string }).sessionId;

    expect(firstWriteCall).toEqual([
      "local_file_save",
      expect.objectContaining({
        path: "C:\\exports\\large.bin",
        sessionId,
        append: false,
        complete: false,
      }),
    ]);
    expect(failedWriteCall).toEqual([
      "local_file_save",
      expect.objectContaining({
        path: "C:\\exports\\large.bin",
        sessionId,
        append: true,
        complete: true,
      }),
    ]);
    expect(cleanupCall).toEqual([
      "local_file_save_cleanup",
      {
        path: "C:\\exports\\large.bin",
        sessionId,
      },
    ]);
  });

  it("surfaces both embedded native write and cleanup failures", async () => {
    mocks.hasEmbeddedTauriIpc.mockReturnValue(true);
    mocks.saveDialog.mockResolvedValue("C:\\exports\\large.bin");
    mocks.invokeTauri
      .mockResolvedValueOnce({ saved: true })
      .mockRejectedValueOnce(new Error("append failed"))
      .mockRejectedValueOnce(new Error("cleanup failed"));
    const oneMiB = 1024 * 1024;
    const bytes = new Uint8Array(oneMiB + 1);

    const { saveFileToUserSelectedLocation } = await import("./file-save-api");
    await expect(
      saveFileToUserSelectedLocation({
        filename: "large.bin",
        blob: new Blob([bytes], { type: "application/octet-stream" }),
      }),
    ).rejects.toThrow("Failed to save file: append failed; cleanup also failed: cleanup failed");
  });

  it("creates empty embedded native files without a full-file conversion", async () => {
    mocks.hasEmbeddedTauriIpc.mockReturnValue(true);
    mocks.saveDialog.mockResolvedValue("C:\\exports\\empty.bin");
    mocks.invokeTauri.mockResolvedValue({ saved: true });

    const { saveFileToUserSelectedLocation } = await import("./file-save-api");
    const result = await saveFileToUserSelectedLocation({ filename: "empty.bin", blob: new Blob([]) });

    expect(result).toBe("saved");
    expect(mocks.invokeTauri).toHaveBeenCalledWith("local_file_save", {
      path: "C:\\exports\\empty.bin",
      base64: "",
      sessionId: expect.any(String),
      append: false,
      complete: true,
    });
  });

  it("saves download payload blobs through the shared file path", async () => {
    const payload = { blob: new Blob(["zip"], { type: "application/zip" }), filename: "export.zip" };

    const { saveDownloadPayloadToUserSelectedLocation } = await import("./file-save-api");
    const result = await saveDownloadPayloadToUserSelectedLocation(payload);

    expect(result).toBe("downloaded");
    expect(mocks.triggerDownload).toHaveBeenCalledWith(payload);
  });

  it("falls back to browser download in non-embedded runtimes without a save picker", async () => {
    const { saveTextFileToUserSelectedLocation } = await import("./file-save-api");
    const result = await saveTextFileToUserSelectedLocation({ filename: "agent.json", content: "{}" });

    expect(result).toBe("downloaded");
    expect(mocks.saveDialog).not.toHaveBeenCalled();
    expect(mocks.invokeTauri).not.toHaveBeenCalled();
    expect(mocks.triggerDownload).toHaveBeenCalledWith({ blob: expect.any(Blob), filename: "agent.json" });
  });

  it("does not take the native save path from a broad Tauri marker without IPC", async () => {
    (window as unknown as { __TAURI__: unknown }).__TAURI__ = {};

    const { canUseEmbeddedNativeTextFileSave, saveTextFileToUserSelectedLocation } = await import("./file-save-api");
    const result = await saveTextFileToUserSelectedLocation({ filename: "agent.json", content: "{}" });

    expect(canUseEmbeddedNativeTextFileSave()).toBe(false);
    expect(result).toBe("downloaded");
    expect(mocks.saveDialog).not.toHaveBeenCalled();
    expect(mocks.invokeTauri).not.toHaveBeenCalled();
    expect(mocks.triggerDownload).toHaveBeenCalledWith({ blob: expect.any(Blob), filename: "agent.json" });
  });

  it("does not take the native save path from a broad Tauri internals marker without IPC", async () => {
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
    mocks.hasEmbeddedTauriIpc.mockReturnValue(false);

    const { canUseEmbeddedNativeTextFileSave, saveTextFileToUserSelectedLocation } = await import("./file-save-api");
    const result = await saveTextFileToUserSelectedLocation({ filename: "agent.json", content: "{}" });

    expect(canUseEmbeddedNativeTextFileSave()).toBe(false);
    expect(result).toBe("downloaded");
    expect(mocks.saveDialog).not.toHaveBeenCalled();
    expect(mocks.invokeTauri).not.toHaveBeenCalled();
    expect(mocks.triggerDownload).toHaveBeenCalledWith({ blob: expect.any(Blob), filename: "agent.json" });
  });
});
