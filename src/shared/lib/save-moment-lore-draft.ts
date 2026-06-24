export interface SaveMomentLoreDraftSource {
  chatId: string;
  messageId: string;
  role: string;
  speakerName?: string | null;
  createdAt?: string | null;
  content: string;
}

export interface SaveMomentLoreDraft {
  name: string;
  description: string;
  content: string;
  keys: string[];
  sourceChatId: string;
  sourceMessageId: string;
}

function cleanInlineText(value: string | null | undefined, fallback: string): string {
  const cleaned = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return cleaned || fallback;
}

export function buildSaveMomentLoreDraft(source: SaveMomentLoreDraftSource): SaveMomentLoreDraft {
  const speaker = cleanInlineText(source.speakerName, source.role || "message").slice(0, 80);
  const role = cleanInlineText(source.role, "message");
  const messageId = cleanInlineText(source.messageId, "unknown-message");
  const chatId = cleanInlineText(source.chatId, "unknown-chat");

  return {
    name: `Moment from ${speaker}`,
    description: `Drafted from ${role} message ${messageId} in chat ${chatId}.`,
    content: source.content.trim(),
    keys: [],
    sourceChatId: chatId,
    sourceMessageId: messageId,
  };
}
