import type { Message } from "../../../../engine/contracts/types/chat";

const RECENT_MESSAGE_CONTENT_EDIT_TTL_MS = 5 * 60 * 1000;

interface RecentMessageContentEdit {
  chatId: string;
  content: string;
  activeSwipeIndex: number | null;
  updatedAt: number;
}

const recentMessageContentEdits = new Map<string, RecentMessageContentEdit>();

function pruneRecentMessageContentEdits(now = Date.now()) {
  for (const [messageId, edit] of recentMessageContentEdits) {
    if (now - edit.updatedAt > RECENT_MESSAGE_CONTENT_EDIT_TTL_MS) {
      recentMessageContentEdits.delete(messageId);
    }
  }
}

export function rememberRecentMessageContentEdit(
  chatId: string,
  messageId: string,
  content: string,
  activeSwipeIndex?: number | null,
) {
  pruneRecentMessageContentEdits();
  recentMessageContentEdits.set(messageId, {
    chatId,
    content,
    activeSwipeIndex: activeSwipeIndex ?? null,
    updatedAt: Date.now(),
  });
}

export function forgetRecentMessageContentEdit(chatId: string, messageId: string) {
  const edit = recentMessageContentEdits.get(messageId);
  if (edit?.chatId === chatId) {
    recentMessageContentEdits.delete(messageId);
  }
}

export function preserveRecentMessageContentEdit(chatId: string, message: Message): Message {
  pruneRecentMessageContentEdits();
  const edit = recentMessageContentEdits.get(message.id);
  if (!edit || edit.chatId !== chatId) return message;
  if (edit.activeSwipeIndex !== null && edit.activeSwipeIndex !== (message.activeSwipeIndex ?? 0)) return message;
  if (message.content === edit.content) return message;
  return { ...message, content: edit.content };
}
