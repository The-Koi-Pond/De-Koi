import { describe, expect, it, vi } from "vitest";
import type { DownloadPayload } from "../../../../shared/api/download-payload";
import { downloadBackupToBrowser } from "./backup-settings-actions";

describe("backup settings actions", () => {
  it("downloads the current backup payload before triggering the browser save", async () => {
    const payload: DownloadPayload = { blob: new Blob(["backup"]), filename: "de-koi-backup.zip" };
    const downloadBackup = vi.fn<() => Promise<DownloadPayload>>().mockResolvedValue(payload);
    const saveDownloadPayload = vi.fn<(value: DownloadPayload) => Promise<"saved" | "downloaded" | "cancelled">>()
      .mockResolvedValue("downloaded");

    await expect(downloadBackupToBrowser(undefined, { downloadBackup, saveDownloadPayload })).resolves.toEqual({
      message: "Backup saved!",
      saveResult: "downloaded",
    });

    expect(downloadBackup).toHaveBeenCalledWith(undefined);
    expect(saveDownloadPayload).toHaveBeenCalledWith(payload);
  });

  it("passes managed backup names through to the download API", async () => {
    const payload: DownloadPayload = { blob: new Blob(["managed"]), filename: "managed.zip" };
    const downloadBackup = vi.fn<(name?: string) => Promise<DownloadPayload>>().mockResolvedValue(payload);
    const saveDownloadPayload = vi.fn<(value: DownloadPayload) => Promise<"saved" | "downloaded" | "cancelled">>()
      .mockResolvedValue("saved");

    await expect(downloadBackupToBrowser("backup-2026.zip", { downloadBackup, saveDownloadPayload })).resolves.toEqual({
      message: "Managed backup saved!",
      saveResult: "saved",
    });

    expect(downloadBackup).toHaveBeenCalledWith("backup-2026.zip");
    expect(saveDownloadPayload).toHaveBeenCalledWith(payload);
  });

  it("returns no toast message when the save is cancelled", async () => {
    const payload: DownloadPayload = { blob: new Blob(["managed"]), filename: "managed.zip" };
    const downloadBackup = vi.fn<(name?: string) => Promise<DownloadPayload>>().mockResolvedValue(payload);
    const saveDownloadPayload = vi.fn<(value: DownloadPayload) => Promise<"saved" | "downloaded" | "cancelled">>()
      .mockResolvedValue("cancelled");

    await expect(downloadBackupToBrowser("backup-2026.zip", { downloadBackup, saveDownloadPayload })).resolves.toBe(
      null,
    );
  });

  it("uses the same success message for native saves and browser downloads", async () => {
    const payload: DownloadPayload = { blob: new Blob(["backup"]), filename: "de-koi-backup.zip" };
    const downloadBackup = vi.fn<() => Promise<DownloadPayload>>().mockResolvedValue(payload);
    const saveDownloadPayload = vi.fn<(value: DownloadPayload) => Promise<"saved" | "downloaded" | "cancelled">>();

    saveDownloadPayload.mockResolvedValueOnce("saved");
    await expect(downloadBackupToBrowser(undefined, { downloadBackup, saveDownloadPayload })).resolves.toEqual({
      message: "Backup saved!",
      saveResult: "saved",
    });

    saveDownloadPayload.mockResolvedValueOnce("downloaded");
    await expect(downloadBackupToBrowser(undefined, { downloadBackup, saveDownloadPayload })).resolves.toEqual({
      message: "Backup saved!",
      saveResult: "downloaded",
    });
  });
});
