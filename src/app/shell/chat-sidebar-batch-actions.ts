type DeleteSelectedChatsInput = {
  chatIds: string[];
  activeChatId: string | null;
  deleteChat: (chatId: string) => Promise<unknown>;
  setActiveChatId: (chatId: string | null) => void;
  exitMultiSelect: () => void;
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

export async function deleteSelectedChatsSequentially({
  chatIds,
  activeChatId,
  deleteChat,
  setActiveChatId,
  exitMultiSelect,
}: DeleteSelectedChatsInput) {
  let deletedCount = 0;
  try {
    for (const chatId of chatIds) {
      await deleteChat(chatId);
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