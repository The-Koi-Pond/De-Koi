type DeleteSelectedChatsInput = {
  chatIds: string[];
  activeChatId: string | null;
  deleteMemories: boolean;
  deleteChat: (input: { id: string; deleteMemories: boolean }) => Promise<unknown>;
  setActiveChatId: (chatId: string | null) => void;
  exitMultiSelect: () => void;
};

type DeleteSingleChatWithConfirmationInput = {
  chatId: string;
  activeChatId: string | null;
  confirmDeletion: () => Promise<{ confirmed: boolean; deleteMemories: boolean }>;
  deleteChat: (input: { id: string; deleteMemories: boolean }) => Promise<unknown>;
  setActiveChatId: (chatId: string | null) => void;
};

type DeleteSelectedChatsErrorInput = {
  cause: unknown;
  deletedCount: number;
  totalCount: number;
  failedChatId: string | null;
};

export class DeleteSelectedChatsError extends Error {
  readonly cause: unknown;
  readonly deletedCount: number;
  readonly totalCount: number;
  readonly failedChatId: string | null;

  constructor({ cause, deletedCount, totalCount, failedChatId }: DeleteSelectedChatsErrorInput) {
    const message = cause instanceof Error ? cause.message : "Failed to delete selected chats.";
    super(message);
    this.name = "DeleteSelectedChatsError";
    this.cause = cause;
    this.deletedCount = deletedCount;
    this.totalCount = totalCount;
    this.failedChatId = failedChatId;
  }
}

export function formatDeleteSelectedChatsError(error: unknown) {
  if (error instanceof DeleteSelectedChatsError && error.deletedCount > 0) {
    return `Deleted ${error.deletedCount} of ${error.totalCount} chats. ${error.message}`;
  }
  return error instanceof Error ? error.message : "Failed to delete selected chats.";
}

export async function deleteSingleChatWithConfirmation({
  chatId,
  activeChatId,
  confirmDeletion,
  deleteChat,
  setActiveChatId,
}: DeleteSingleChatWithConfirmationInput) {
  const confirmation = await confirmDeletion();
  if (!confirmation.confirmed) return false;
  await deleteChat({ id: chatId, deleteMemories: confirmation.deleteMemories });
  if (activeChatId === chatId) setActiveChatId(null);
  return true;
}

export async function deleteSelectedChatsSequentially({
  chatIds,
  activeChatId,
  deleteMemories,
  deleteChat,
  setActiveChatId,
  exitMultiSelect,
}: DeleteSelectedChatsInput) {
  let deletedCount = 0;
  try {
    for (const chatId of chatIds) {
      await deleteChat({ id: chatId, deleteMemories });
      deletedCount += 1;
      if (activeChatId === chatId) setActiveChatId(null);
    }
  } catch (cause) {
    throw new DeleteSelectedChatsError({
      cause,
      deletedCount,
      totalCount: chatIds.length,
      failedChatId: chatIds[deletedCount] ?? null,
    });
  } finally {
    exitMultiSelect();
  }
}
