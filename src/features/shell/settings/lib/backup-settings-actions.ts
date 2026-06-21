import type { DownloadPayload } from "../../../../shared/api/download-payload";

export type BackupDownloadDependencies = {
  downloadBackup: (name?: string) => Promise<DownloadPayload>;
  saveDownloadPayload: (payload: DownloadPayload) => Promise<"saved" | "downloaded" | "cancelled">;
};

export async function downloadBackupToBrowser(name: string | undefined, deps: BackupDownloadDependencies) {
  const payload = await deps.downloadBackup(name);
  const result = await deps.saveDownloadPayload(payload);
  if (result === "cancelled") return null;
  return name
    ? `Managed backup ${result === "saved" ? "saved" : "downloaded"}!`
    : `Backup ${result === "saved" ? "saved" : "downloaded"}!`;
}
