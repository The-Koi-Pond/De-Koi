import { appSettingsResponseSchema, appSettingsUpdateSchema } from "../../engine/contracts/schemas/app-settings.schema";
import {
  CONVERSATION_SETTINGS_ID,
  DEFAULT_CONVERSATION_SETTINGS,
  normalizeConversationSettings,
  type ConversationSettings,
} from "../../engine/modes/chat/status/conversation-status-settings";
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

async function saveSettingsRecord(settings: ConversationSettings): Promise<ConversationSettings> {
  const normalized = normalizeConversationSettings(settings);
  const payload = appSettingsUpdateSchema.parse({ value: normalized });
  const existing = await storageApi.get<AppSettingsRecord>("app-settings", CONVERSATION_SETTINGS_ID, {
    fields: ["id"],
  });
  if (existing) {
    await storageApi.update("app-settings", CONVERSATION_SETTINGS_ID, payload);
  } else {
    await storageApi.create("app-settings", {
      id: CONVERSATION_SETTINGS_ID,
      ...payload,
    });
  }
  return normalized;
}

export const conversationSettingsKeys = {
  settings: ["conversation-settings"] as const,
};

export const conversationSettingsApi = {
  settings: {
    get: readSettingsRecord,
    save: saveSettingsRecord,
    setStatusMessagesEnabledByDefault: async (enabled: boolean) => {
      const current = await readSettingsRecord();
      return saveSettingsRecord({
        ...current,
        statusMessagesEnabledByDefault: enabled,
      });
    },
  },
};
