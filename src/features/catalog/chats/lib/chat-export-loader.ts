import type { StorageGateway } from "../../../../engine/capabilities/storage";
import type { Chat, Message } from "../../../../engine/contracts/types/chat";

type ChatExportStorage = Pick<StorageGateway, "get" | "list" | "listChatMessages">;

export type LoadedChatExport = {
  chat: Chat;
  messages: Message[];
};

export async function listChatIdsForExport(storage: ChatExportStorage): Promise<string[]> {
  const rows = await storage.list<Pick<Chat, "id">>("chats", { fields: ["id"] });
  return rows.map((chat) => chat.id).filter((id): id is string => typeof id === "string" && id.length > 0);
}

export async function loadChatsForExport(
  storage: ChatExportStorage,
  chatIds: readonly string[],
  concurrency = 4,
): Promise<LoadedChatExport[]> {
  const ids = Array.from(new Set(chatIds.map((id) => id.trim()).filter(Boolean)));
  if (ids.length === 0) throw new Error("Choose at least one chat to export.");

  const results = new Array<LoadedChatExport>(ids.length);
  let nextIndex = 0;
  const workerCount = Math.min(ids.length, Math.max(1, Math.floor(concurrency)));

  const worker = async () => {
    while (nextIndex < ids.length) {
      const index = nextIndex;
      nextIndex += 1;
      const chatId = ids[index]!;
      const [chat, messages] = await Promise.all([
        storage.get<Chat>("chats", chatId),
        storage.listChatMessages<Message>(chatId),
      ]);
      if (!chat) throw new Error("Chat was not found.");
      results[index] = { chat, messages };
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
