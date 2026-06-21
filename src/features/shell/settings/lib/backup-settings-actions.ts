import type { DownloadPayload } from "../../../../shared/api/download-payload";

export type BackupDownloadDependencies = {
  downloadBackup: (name?: string) => Promise<DownloadPayload>;
  saveDownloadPayload: (payload: DownloadPayload) => Promise<"saved" | "downloaded" | "cancelled">;
};

type BackupDownloadResult = {
  message: string;
  saveResult: "saved" | "downloaded";
};

export async function downloadBackupToBrowser(name: string | undefined, deps: BackupDownloadDependencies) {
  const payload = await deps.downloadBackup(name);
  const saveResult = await deps.saveDownloadPayload(payload);
  if (saveResult === "cancelled") return null;
  return {
    message: name ? "Managed backup saved!" : "Backup saved!",
    saveResult,
  } satisfies BackupDownloadResult;
}
