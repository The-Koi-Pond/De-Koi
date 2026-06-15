import type { DownloadPayload } from "../../../../shared/api/download-payload";

export type BackupDownloadDependencies = {
  downloadBackup: (name?: string) => Promise<DownloadPayload>;
  triggerDownload: (payload: DownloadPayload) => void;
};

export async function downloadBackupToBrowser(name: string | undefined, deps: BackupDownloadDependencies) {
  const payload = await deps.downloadBackup(name);
  deps.triggerDownload(payload);
  return name ? "Managed backup downloaded!" : "Backup downloaded!";
}
