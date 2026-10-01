import { toast } from "sonner";

import { triggerDownload, type DownloadPayload } from "../../../shared/api/download-payload";

export function getExportErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function toastExportError(error: unknown, fallback: string): void {
  toast.error(getExportErrorMessage(error, fallback));
}

const REPORT_ROWS_SHOWN = 3;

/** A short list of what an export left out, or null when nothing was skipped. */
export function exportReportSummary(payload: DownloadPayload): string | null {
  const skipped = payload.report?.skipped ?? [];
  if (skipped.length === 0) return null;
  const characters = new Set(skipped.map((row) => row.character)).size;
  const rows = skipped
    .slice(0, REPORT_ROWS_SHOWN)
    .map((row) => `${characters > 1 ? `${row.character}: ` : ""}${row.asset}. ${row.reason}`);
  const more = skipped.length - rows.length;
  return [...rows, ...(more > 0 ? [`and ${more} more.`] : [])].join("\n");
}

/** Downloads the file, then confirms it and lists anything the format could not include. */
export function triggerDownloadWithToast(payload: DownloadPayload, successMessage: string): void {
  triggerDownload(payload);
  const summary = exportReportSummary(payload);
  if (summary) {
    toast.warning(`${successMessage} Some items were not included.`, {
      description: summary,
      duration: 10_000,
      classNames: { description: "whitespace-pre-line" },
    });
  } else {
    toast.success(successMessage);
  }
}
