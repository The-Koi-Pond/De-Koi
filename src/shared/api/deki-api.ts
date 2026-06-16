import type { DekiEntryRequest, DekiGatewayResponse, DekiMessage } from "../../engine/deki/deki-entry";
import { EMPTY_DEKI_COMPACTION, type DekiCompactionState } from "../../engine/deki/deki-history";
import { appSettingsResponseSchema, appSettingsUpdateSchema } from "../../engine/contracts/schemas/app-settings.schema";
import { storageApi } from "./storage-api";
import { invokeTauri } from "./tauri-client";

const DEKI_SETTINGS_ID = "deki";
const LEGACY_DEKI_SETTINGS_ID = "professor-mari";

export type DekiPreferences = {
  selectedConnectionId: string | null;
  selectedPersonaId: string | null;
};

type DekiSettingsRecord = {
  value?: unknown;
};

type StoredMessageRecord = {
  id?: unknown;
  role?: unknown;
  content?: unknown;
  createdAt?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizePreferences(value: unknown): DekiPreferences {
  const object = asRecord(value);
  const selectedConnectionId =
    typeof object.selectedConnectionId === "string" && object.selectedConnectionId.trim()
      ? object.selectedConnectionId
      : null;
  const selectedPersonaId =
    typeof object.selectedPersonaId === "string" && object.selectedPersonaId.trim() ? object.selectedPersonaId : null;
  return { selectedConnectionId, selectedPersonaId };
}

function normalizeDekiCompaction(value: unknown): DekiCompactionState {
  const object = asRecord(value);
  return {
    compactedSummary:
      typeof object.compactedSummary === "string" && object.compactedSummary.trim() ? object.compactedSummary : null,
    compactedAt: typeof object.compactedAt === "string" && object.compactedAt.trim() ? object.compactedAt : null,
    compactedThroughMessageId:
      typeof object.compactedThroughMessageId === "string" && object.compactedThroughMessageId.trim()
        ? object.compactedThroughMessageId
        : null,
  };
}

function normalizeDekiMessage(record: StoredMessageRecord): DekiMessage | null {
  const role = record.role === "assistant" ? "assistant" : record.role === "user" ? "user" : null;
  const id = typeof record.id === "string" && record.id.trim() ? record.id : null;
  const content = typeof record.content === "string" ? record.content : null;
  const createdAt = typeof record.createdAt === "string" && record.createdAt.trim() ? record.createdAt : null;
  if (!role || !id || content === null || !createdAt) return null;
  return { id, role, content, createdAt };
}

function createDekiMessage(message: { role: "user" | "assistant"; content: string }): DekiMessage {
  const nonce =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id: `deki-message-${nonce}`,
    role: message.role,
    content: message.content,
    createdAt: new Date().toISOString(),
  };
}

function normalizeDekiMessages(value: unknown): DekiMessage[] {
  const object = asRecord(value);
  const rawMessages = Array.isArray(object.messages) ? object.messages : [];
  return rawMessages
    .map((message) => normalizeDekiMessage(asRecord(message) as StoredMessageRecord))
    .filter((message): message is DekiMessage => !!message);
}

async function readSettingsRecord(): Promise<DekiSettingsRecord | null> {
  const record = await storageApi.get<DekiSettingsRecord>("app-settings", DEKI_SETTINGS_ID);
  if (record) return record;
  return storageApi.get<DekiSettingsRecord>("app-settings", LEGACY_DEKI_SETTINGS_ID);
}

async function readSettingsValue(): Promise<Record<string, unknown>> {
  const record = await readSettingsRecord();
  const parsed = appSettingsResponseSchema.safeParse(record ?? { value: null });
  return asRecord(parsed.success ? parsed.data.value : null);
}

async function saveSettingsPatch(patch: Record<string, unknown>): Promise<Record<string, unknown>> {
  const existing = await storageApi.get<DekiSettingsRecord>("app-settings", DEKI_SETTINGS_ID);
  const source = existing ?? (await readSettingsRecord());
  const parsed = appSettingsResponseSchema.safeParse(source ?? { value: null });
  const value = {
    ...asRecord(parsed.success ? parsed.data.value : null),
    ...patch,
  };
  const payload = appSettingsUpdateSchema.parse({ value });
  if (existing) {
    await storageApi.update("app-settings", DEKI_SETTINGS_ID, payload);
  } else {
    await storageApi.create("app-settings", {
      id: DEKI_SETTINGS_ID,
      ...payload,
    });
  }
  return value;
}

export const dekiApi = {
  prompt: (request: DekiEntryRequest) =>
    invokeTauri<DekiGatewayResponse>("deki_prompt", {
      request,
    }),
  preferences: {
    get: async (): Promise<DekiPreferences> => {
      return normalizePreferences(await readSettingsValue());
    },
    save: async (preferences: DekiPreferences): Promise<DekiPreferences> => {
      return normalizePreferences(
        await saveSettingsPatch({
          selectedConnectionId: preferences.selectedConnectionId,
          selectedPersonaId: preferences.selectedPersonaId,
        }),
      );
    },
  },
  history: {
    get: async (): Promise<{ messages: DekiMessage[]; compaction: DekiCompactionState }> => {
      const settings = await readSettingsValue();
      return {
        messages: normalizeDekiMessages(settings),
        compaction: normalizeDekiCompaction(settings),
      };
    },
    appendMessage: async (message: { role: "user" | "assistant"; content: string }): Promise<DekiMessage> => {
      const settings = await readSettingsValue();
      const nextMessage = createDekiMessage(message);
      await saveSettingsPatch({
        messages: [...normalizeDekiMessages(settings), nextMessage],
      });
      return nextMessage;
    },
    saveCompaction: async (compaction: DekiCompactionState): Promise<DekiCompactionState> =>
      normalizeDekiCompaction(
        await saveSettingsPatch({
          compactedSummary: compaction.compactedSummary,
          compactedAt: compaction.compactedAt,
          compactedThroughMessageId: compaction.compactedThroughMessageId,
        }),
      ),
    reset: async (): Promise<void> => {
      await saveSettingsPatch({ ...EMPTY_DEKI_COMPACTION, messages: [] });
    },
  },
};
