import type { StorageGateway } from "../../../capabilities/storage";
import { isRecord, readString } from "../../../generation/runtime-records";

/** Deletes a chat the scene module made: its whole transcript in one bulk delete, then the chat. */
export async function deleteChatAndTranscript(storage: StorageGateway, chatId: string): Promise<void> {
  const messages = await storage.listChatMessages<unknown>(chatId, { fields: ["id"] });
  const messageIds = messages
    .filter(isRecord)
    .map((message) => readString(message.id).trim())
    .filter(Boolean);
  if (messageIds.length > 0) {
    if (!storage.bulkDeleteChatMessages) throw new Error("This runtime can't delete the chat's messages.");
    await storage.bulkDeleteChatMessages(chatId, messageIds);
  }
  await storage.delete("chats", chatId);
}
