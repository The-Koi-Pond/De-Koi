import { showConfirmDialogWithOption } from "../../../../shared/lib/app-dialogs";

export async function confirmChatDeletion(count: number) {
  const plural = count !== 1;
  const result = await showConfirmDialogWithOption({
    title: plural ? "Delete Chats" : "Delete Chat",
    message: plural ? `Delete ${count} chats?` : "Delete this chat?",
    confirmLabel: plural ? "Delete Chats" : "Delete Chat",
    tone: "destructive",
    optionLabel: plural
      ? "Also delete cross-chat memories learned only from these chats"
      : "Also delete cross-chat memories learned only from this chat",
    optionDescription:
      "Chat-local history and summaries are deleted either way. Shared memories supported by other chats are kept.",
    defaultChecked: false,
  });
  return {
    confirmed: result.confirmed,
    deleteMemories: result.optionChecked,
  };
}
