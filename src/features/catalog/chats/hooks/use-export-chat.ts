import { useMutation } from "../../../../shared/hooks/use-mutation";
import { toast } from "sonner";

import { storageApi } from "../../../../shared/api/storage-api";
import { getExportErrorMessage } from "../../../shared/lib/export-feedback";
import {
  chatExportFilename,
  formatChatJsonl,
  formatChatText,
  type ChatTranscriptExportFormat,
} from "../lib/chat-transcript-export";
import { downloadTextFile } from "../lib/download";
import { loadChatsForExport } from "../lib/chat-export-loader";

export function useExportChat() {
  return useMutation({
    meta: { handlesOwnErrors: true },
    mutationFn: async ({ chatId, format = "jsonl" }: { chatId: string; format?: ChatTranscriptExportFormat }) => {
      const [{ chat, messages, names }] = await loadChatsForExport(storageApi, [chatId]);
      const filename = chatExportFilename(chat, format);
      const result =
        format === "text"
          ? await downloadTextFile(formatChatText(chat, messages, names), filename, "text/plain;charset=utf-8")
          : await downloadTextFile(
              formatChatJsonl(chat, messages, names),
              filename,
              "application/x-ndjson;charset=utf-8",
            );
      return { format, result };
    },
    onSuccess: ({ format, result }) => {
      if (result === "cancelled") return;
      toast.success(format === "text" ? "Chat transcript exported as text." : "Chat transcript exported as JSONL.");
    },
    onError: (error) => {
      toast.error(getExportErrorMessage(error, "Failed to export chat transcript."));
    },
  });
}
