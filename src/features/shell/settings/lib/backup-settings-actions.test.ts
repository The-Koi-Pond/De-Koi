import { describe, expect, it, vi } from "vitest";
import type { DownloadPayload } from "../../../../shared/api/download-payload";
import { downloadBackupToBrowser } from "./backup-settings-actions";

describe("backup settings actions", () => {
  it("downloads the current backup payload before triggering the browser save", async () => {
    const payload: DownloadPayload = { blob: new Blob(["backup"]), filename: "de-koi-backup.zip" };
    const downloadBackup = vi.fn<() => Promise<DownloadPayload>>().mockResolvedValue(payload);
    const triggerDownload = vi.fn<(value: DownloadPayload) => void>();

    await expect(downloadBackupToBrowser(undefined, { downloadBackup, triggerDownload })).resolves.toBe(
      "Backup downloaded!",
    );

    expect(downloadBackup).toHaveBeenCalledWith(undefined);
    expect(triggerDownload).toHaveBeenCalledWith(payload);
  });

  it("passes managed backup names through to the download API", async () => {
    const payload: DownloadPayload = { blob: new Blob(["managed"]), filename: "managed.zip" };
    const downloadBackup = vi.fn<(name?: string) => Promise<DownloadPayload>>().mockResolvedValue(payload);
    const triggerDownload = vi.fn<(value: DownloadPayload) => void>();

    await expect(downloadBackupToBrowser("backup-2026.zip", { downloadBackup, triggerDownload })).resolves.toBe(
      "Managed backup downloaded!",
    );

    expect(downloadBackup).toHaveBeenCalledWith("backup-2026.zip");
    expect(triggerDownload).toHaveBeenCalledWith(payload);
  });
});
