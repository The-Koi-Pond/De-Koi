// Conversation messages the user sent while a character's reply was still being written.
//
// A reply answers the user message that was latest when it started (its extra.answersUserVersion). A text the
// user sends while that reply is being written lands before the reply in the chat, but the reply never saw it.
import { parseRecord, readString } from "../../../generation/runtime-records";

type ChatMessageLike = { id?: unknown; role?: unknown; extra?: unknown };

/** The user message a saved reply answered, or "" when the reply doesn't say. */
function answeredMessageId(message: ChatMessageLike): string {
  return readString(parseRecord(parseRecord(message.extra).answersUserVersion).messageId).trim();
}

/**
 * For each reply that answered an earlier user message while newer ones were already in the chat: how many user
 * messages came in after the one it answered. Keyed by the reply's id. Messages are in chat order.
 */
export function messagesSentDuringReplies(messages: readonly ChatMessageLike[]): Map<string, number> {
  const sentDuring = new Map<string, number>();
  let userIdsSinceAssistant: string[] = [];
  for (const message of messages) {
    const role = readString(message.role);
    if (role === "user") {
      userIdsSinceAssistant.push(readString(message.id).trim());
      continue;
    }
    if (role !== "assistant") continue;
    const answered = answeredMessageId(message);
    const answeredIndex = answered ? userIdsSinceAssistant.indexOf(answered) : -1;
    const missed = answeredIndex >= 0 ? userIdsSinceAssistant.length - answeredIndex - 1 : 0;
    const replyId = readString(message.id).trim();
    if (missed > 0 && replyId) sentDuring.set(replyId, missed);
    userIdsSinceAssistant = [];
  }
  return sentDuring;
}

/**
 * Whether the user's latest message still needs a reply because it arrived while the last reply was being
 * written: a reply landed after it, that reply answered an earlier message, and nothing answers it yet.
 */
export function latestMessageSentDuringReply(messages: readonly ChatMessageLike[]): boolean {
  let latestUserIndex = messages.length - 1;
  while (latestUserIndex >= 0 && readString(messages[latestUserIndex]!.role) !== "user") latestUserIndex -= 1;
  if (latestUserIndex < 0) return false;
  const latestUserId = readString(messages[latestUserIndex]!.id).trim();
  if (!latestUserId) return false;
  if (
    messages.some((message) => readString(message.role) === "assistant" && answeredMessageId(message) === latestUserId)
  ) {
    return false;
  }
  const sentDuring = messagesSentDuringReplies(messages);
  return messages.slice(latestUserIndex + 1).some((message) => sentDuring.has(readString(message.id).trim()));
}

/** The prompt note after such a reply, so the next reply knows those messages are still unanswered. */
export function sentDuringReplyHistoryNote(count: number, userName: string): string {
  if (count <= 0) return "";
  const them = count === 1 ? "the message just before this one" : `the ${count} messages just before this one`;
  return `(${userName} sent ${them} while this text was being written; this text did not answer ${count === 1 ? "it" : "them"}.)`;
}
