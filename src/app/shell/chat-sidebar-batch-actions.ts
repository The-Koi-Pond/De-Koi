type DeleteSelectedChatsInput = {
  chatIds: string[];
  activeChatId: string | null;
  deleteChat: (chatId: string) => Promise<unknown>;
  setActiveChatId: (chatId: string | null) => void;
  exitMultiSelect: () => void;
};

export async function deleteSelectedChatsSequentially({
  chatIds,
  activeChatId,
  deleteChat,
  setActiveChatId,
  exitMultiSelect,
}: DeleteSelectedChatsInput) {
  for (const chatId of chatIds) {
    await deleteChat(chatId);
    if (activeChatId === chatId) setActiveChatId(null);
  }
  exitMultiSelect();
}
