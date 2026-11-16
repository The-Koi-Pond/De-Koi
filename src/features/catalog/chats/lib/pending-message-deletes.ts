/**
 * Messages whose delete request is still running, per chat.
 *
 * A delete can take several seconds on a hosted install, and the server runs
 * deletes one at a time. Any message list fetched in the meantime still holds
 * the messages that are waiting, so the timeline filters them out until their
 * delete settles; a failed delete stops filtering and the message comes back.
 */
const pendingDeletes = new Map<string, Map<string, number>>();

export function markMessagesDeleting(chatId: string, messageIds: Iterable<string>) {
  let chatDeletes = pendingDeletes.get(chatId);
  if (!chatDeletes) {
    chatDeletes = new Map();
    pendingDeletes.set(chatId, chatDeletes);
  }
  for (const messageId of messageIds) {
    chatDeletes.set(messageId, (chatDeletes.get(messageId) ?? 0) + 1);
  }
}

export function finishMessagesDeleting(chatId: string, messageIds: Iterable<string>) {
  const chatDeletes = pendingDeletes.get(chatId);
  if (!chatDeletes) return;
  for (const messageId of messageIds) {
    const remaining = (chatDeletes.get(messageId) ?? 0) - 1;
    if (remaining > 0) chatDeletes.set(messageId, remaining);
    else chatDeletes.delete(messageId);
  }
  if (chatDeletes.size === 0) pendingDeletes.delete(chatId);
}

export function hasPendingMessageDeletes(chatId: string): boolean {
  return pendingDeletes.has(chatId);
}

export function withoutPendingMessageDeletes<T extends { id: string }>(chatId: string, messages: T[]): T[] {
  const chatDeletes = pendingDeletes.get(chatId);
  if (!chatDeletes) return messages;
  const kept = messages.filter((message) => !chatDeletes.has(message.id));
  return kept.length === messages.length ? messages : kept;
}
