/** Chats per server request: each request is one storage pass, and chunks keep progress moving. */
export const CHAT_DELETE_BATCH_SIZE = 25;

type DeleteSelectedChatsInput = {
  chatIds: string[];
  activeChatId: string | null;
  deleteMemories: boolean;
  deleteChats: (input: { ids: string[]; deleteMemories: boolean }) => Promise<unknown>;
  setActiveChatId: (chatId: string | null) => void;
  exitMultiSelect: () => void;
  /** Called after each chunk is deleted, so the sidebar can show "2 of 5 done". */
  onProgress?: (deletedCount: number, totalCount: number) => void;
  batchSize?: number;
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
  deleteChats,
  setActiveChatId,
  exitMultiSelect,
  onProgress,
  batchSize = CHAT_DELETE_BATCH_SIZE,
}: DeleteSelectedChatsInput) {
  const chunkSize = Number.isFinite(batchSize) ? Math.max(1, Math.floor(batchSize)) : CHAT_DELETE_BATCH_SIZE;
  let deletedCount = 0;
  try {
    for (let start = 0; start < chatIds.length; start += chunkSize) {
      const chunk = chatIds.slice(start, start + chunkSize);
      await deleteChats({ ids: chunk, deleteMemories });
      deletedCount += chunk.length;
      if (activeChatId && chunk.includes(activeChatId)) setActiveChatId(null);
      onProgress?.(deletedCount, chatIds.length);
    }
    return deletedCount;
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
