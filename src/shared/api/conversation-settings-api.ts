import { appSettingsResponseSchema } from "../../engine/contracts/schemas/app-settings.schema";
import {
  CONVERSATION_SETTINGS_ID,
  DEFAULT_CONVERSATION_SETTINGS,
  normalizeConversationSettings,
  type ConversationSettings,
} from "../../engine/modes/chat/status/conversation-status-settings";
import { transformAppSettings } from "./app-settings-api";
import { storageApi } from "./storage-api";

type AppSettingsRecord = {
  value?: unknown;
};

async function readSettingsRecord(): Promise<ConversationSettings> {
  const record = await storageApi.get<AppSettingsRecord>("app-settings", CONVERSATION_SETTINGS_ID);
  if (!record) return DEFAULT_CONVERSATION_SETTINGS;
  const parsed = appSettingsResponseSchema.safeParse(record ?? { value: null });
  return normalizeConversationSettings(parsed.success ? parsed.data.value : null);
}

/**
 * Applies `change` to the stored conversation settings with a compare-and-set
 * write, so a concurrent change from another client is kept, not replaced.
 */
async function updateSettingsRecord(
  change: (current: ConversationSettings) => ConversationSettings,
): Promise<ConversationSettings> {
  const value = await transformAppSettings(CONVERSATION_SETTINGS_ID, "conversation settings", (stored, exists) =>
    normalizeConversationSettings(
      change(exists ? normalizeConversationSettings(stored) : DEFAULT_CONVERSATION_SETTINGS),
    ),
  );
  return normalizeConversationSettings(value);
}

export const conversationSettingsKeys = {
  settings: ["conversation-settings"] as const,
};

export const conversationSettingsApi = {
  settings: {
    get: readSettingsRecord,
    setStatusMessagesEnabledByDefault: (enabled: boolean) =>
      updateSettingsRecord((current) => ({ ...current, statusMessagesEnabledByDefault: enabled })),
  },
};
