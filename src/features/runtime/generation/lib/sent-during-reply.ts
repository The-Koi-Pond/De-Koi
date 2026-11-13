// Chats where the user sent a message while a reply was still being written. That reply can't see the new
// message, so once its turn ends the chat gets one more reply for it (see runGenerationWithUi).
const chatsWithMessagesSentDuringReply = new Set<string>();

export function markMessageSentDuringReply(chatId: string): void {
  chatsWithMessagesSentDuringReply.add(chatId);
}

/** Whether a message was sent during this chat's reply; clears the mark either way. */
export function takeMessageSentDuringReply(chatId: string): boolean {
  return chatsWithMessagesSentDuringReply.delete(chatId);
}
