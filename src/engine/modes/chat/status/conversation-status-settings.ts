import type { StorageGateway } from "../../../capabilities/storage";
import { parseJsonObject } from "../../../core/json";

export const CONVERSATION_SETTINGS_ID = "conversation";

export interface ConversationSettings {
  statusMessagesEnabledByDefault: boolean;
}

export const DEFAULT_CONVERSATION_SETTINGS: ConversationSettings = {
  statusMessagesEnabledByDefault: false,
};

function explicitStatusMessagesEnabled(chatMeta: Record<string, unknown>): boolean | null {
  if (chatMeta.conversationStatusMessagesEnabled === true) return true;
  if (chatMeta.conversationStatusMessagesEnabled === false) return false;
  return null;
}

export function normalizeConversationSettings(value: unknown): ConversationSettings {
  const record = parseJsonObject(value);
  return {
    statusMessagesEnabledByDefault: record.statusMessagesEnabledByDefault === true,
  };
}

export function resolveConversationStatusMessagesEnabled(
  chatMeta: Record<string, unknown>,
  statusMessagesEnabledByDefault: boolean,
): boolean {
  return explicitStatusMessagesEnabled(chatMeta) ?? statusMessagesEnabledByDefault;
}

async function readConversationSettings(storage: Pick<StorageGateway, "get">): Promise<ConversationSettings> {
  const record = await storage.get<{ value?: unknown }>("app-settings", CONVERSATION_SETTINGS_ID);
  return normalizeConversationSettings(record?.value);
}

export async function resolveStoredConversationStatusMessagesEnabled(
  storage: Pick<StorageGateway, "get">,
  chatMeta: Record<string, unknown>,
): Promise<boolean> {
  const explicit = explicitStatusMessagesEnabled(chatMeta);
  if (explicit !== null) return explicit;
  const settings = await readConversationSettings(storage);
  return settings.statusMessagesEnabledByDefault;
}
