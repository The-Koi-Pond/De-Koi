import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { storageApi } from "../../../../shared/api/storage-api";
import { getExportErrorMessage } from "../../../shared/lib/export-feedback";
import { downloadBlobFile, downloadTextFile } from "../lib/download";
import type { BulkChatExportFormat } from "../lib/chat-transcript-export";
import { listChatIdsForExport, loadChatsForExport } from "../lib/chat-export-loader";

/** Export selected chats as native JSON or a ZIP of JSONL/text transcripts. */
export function useBulkExportChats() {
  return useMutation({
    mutationFn: async ({
      chatIds,
      format = "native",
      scope = "selected",
    }: {
      chatIds?: string[];
      format?: BulkChatExportFormat;
      scope?: "selected" | "all";
    }) => {
      const exportIds = scope === "all" ? await listChatIdsForExport(storageApi) : (chatIds ?? []);
      const chats = await loadChatsForExport(storageApi, exportIds);
      const exportedAt = new Date().toISOString();
      if (format === "jsonl" || format === "text") {
        const [{ buildChatTranscriptZipFiles }, { createStoredZip }] = await Promise.all([
          import("../lib/chat-transcript-export"),
          import("../../../../shared/lib/zip"),
        ]);
        const files = buildChatTranscriptZipFiles(chats, format);
        const result = await downloadBlobFile(
          createStoredZip(files),
          `chat-transcripts-${format}-${exportedAt.slice(0, 10)}.zip`,
        );
        return { count: chats.length, result };
      }

      const result = await downloadTextFile(
        JSON.stringify(
          {
            format: "marinara-chat-bulk",
            version: 1,
            exportedAt,
            count: chats.length,
            chats,
          },
          null,
          2,
        ),
        `marinara-chats-${exportedAt.slice(0, 10)}.json`,
        "application/json;charset=utf-8",
      );
      return { count: chats.length, result };
    },
    onSuccess: ({ count, result }) => {
      if (result === "cancelled") return;
      toast.success(`Exported ${count} chat${count === 1 ? "" : "s"}.`);
    },
    onError: (error) => {
      toast.error(getExportErrorMessage(error, "Failed to export chats."));
    },
  });
}
