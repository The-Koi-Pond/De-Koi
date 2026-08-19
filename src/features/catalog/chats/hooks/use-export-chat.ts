import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import type { Chat, Message } from "../../../../engine/contracts/types/chat";
import { storageApi } from "../../../../shared/api/storage-api";
import { getExportErrorMessage } from "../../../shared/lib/export-feedback";
import {
  chatExportFilename,
  formatChatJsonl,
  formatChatText,
  type ChatTranscriptExportFormat,
} from "../lib/chat-transcript-export";
import { downloadTextFile } from "../lib/download";

export function useExportChat() {
  return useMutation({
    mutationFn: async ({ chatId, format = "jsonl" }: { chatId: string; format?: ChatTranscriptExportFormat }) => {
      const [chat, messages] = await Promise.all([
        storageApi.get<Chat>("chats", chatId).then((record) => {
          if (!record) throw new Error("Chat was not found.");
          return record;
        }),
        storageApi.listChatMessages<Message>(chatId),
      ]);
      const filename = chatExportFilename(chat, format);
      const result =
        format === "text"
          ? await downloadTextFile(formatChatText(chat, messages), filename, "text/plain;charset=utf-8")
          : await downloadTextFile(formatChatJsonl(chat, messages), filename, "application/x-ndjson;charset=utf-8");
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
