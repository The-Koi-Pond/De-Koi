import * as g from "./game-api-support";
import { journalFromChat } from "./game-api-journal-helpers";

export async function addJournalEntry(data: {
  chatId: string;
  type: string;
  data: Record<string, unknown>;
}): Promise<{ journal: g.Journal; sessionChat: g.Chat }> {
  const chat = await g.getChat(data.chatId);
  const meta = g.chatMeta(chat);
  const journal = g.applyJournalEntry(
    journalFromChat(chat, meta, { includeCurrentLocation: false, syncInventory: false }),
    data.type,
    data.data,
  );
  const sessionChat = await g.patchChatMetadata(data.chatId, { gameJournal: journal });
  return { journal, sessionChat };
}

export async function getJournal(chatId: string): Promise<g.GameJournalResponse> {
  const chat = await g.getChat(chatId);
  const meta = g.chatMeta(chat);
  const journal = journalFromChat(chat, meta, { includeCurrentLocation: true });
  const sessionNumber = Number(meta.gameSessionNumber ?? 1);
  return {
    journal,
    recap: g.buildStructuredRecap(journal, sessionNumber),
    playerNotes: typeof meta.gamePlayerNotes === "string" ? meta.gamePlayerNotes : "",
  };
}

export async function updateNotes(chatId: string, notes: string) {
  const sessionChat = await g.patchChatMetadata(chatId, { gamePlayerNotes: notes });
  return { ok: true, sessionChat };
}
