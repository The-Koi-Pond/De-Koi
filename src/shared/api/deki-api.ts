import type { DekiEntryRequest, DekiGatewayResponse, DekiMessage } from "../../engine/deki/deki-entry";
import {
  createDekiSession,
  getActiveDekiSession,
  type DekiCompactionState,
  type DekiSession,
  type DekiSessionsState,
} from "../../engine/deki/deki-history";
import { appSettingsResponseSchema, appSettingsUpdateSchema } from "../../engine/contracts/schemas/app-settings.schema";
import { storageApi } from "./storage-api";
import { invokeTauri } from "./tauri-client";

const DEKI_SETTINGS_ID = "deki";
const LEGACY_DEKI_SETTINGS_ID = "professor-mari";
const LEGACY_DEKI_SESSION_ID = "deki-session-default";

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

type DekiHistorySnapshot = {
  session: DekiSession;
  messages: DekiMessage[];
  compaction: DekiCompactionState;
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

function newId(prefix: string) {
  const nonce =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}-${nonce}`;
}

function createDekiMessage(message: { role: "user" | "assistant"; content: string }): DekiMessage {
  return {
    id: newId("deki-message"),
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

function createEmptyDekiSession(): DekiSession {
  return createDekiSession({ id: newId("deki-session") });
}

function titleFromMessages(messages: DekiMessage[]): string {
  const firstUserMessage = messages
    .find((message) => message.role === "user")
    ?.content.trim()
    .replace(/\s+/g, " ");
  if (!firstUserMessage) return "New Deki Chat";
  return firstUserMessage.length > 48 ? `${firstUserMessage.slice(0, 45)}...` : firstUserMessage;
}

function normalizeDekiSession(value: unknown): DekiSession | null {
  const object = asRecord(value);
  const id = typeof object.id === "string" && object.id.trim() ? object.id : null;
  if (!id) return null;
  const messages = normalizeDekiMessages(object);
  const createdAt =
    typeof object.createdAt === "string" && object.createdAt.trim()
      ? object.createdAt
      : (messages[0]?.createdAt ?? new Date().toISOString());
  const updatedAt =
    typeof object.updatedAt === "string" && object.updatedAt.trim()
      ? object.updatedAt
      : (messages.at(-1)?.createdAt ?? createdAt);
  const title = typeof object.title === "string" && object.title.trim() ? object.title : titleFromMessages(messages);
  return {
    id,
    title,
    messages,
    compaction: normalizeDekiCompaction(object.compaction ?? object),
    createdAt,
    updatedAt,
  };
}

function normalizeDekiSessionsState(settings: unknown): DekiSessionsState {
  const object = asRecord(settings);
  const seen = new Set<string>();
  const sessions = (Array.isArray(object.sessions) ? object.sessions : [])
    .map(normalizeDekiSession)
    .filter((session): session is DekiSession => {
      if (!session || seen.has(session.id)) return false;
      seen.add(session.id);
      return true;
    });

  if (sessions.length === 0) {
    const legacyMessages = normalizeDekiMessages(object);
    sessions.push(
      createDekiSession({
        id: LEGACY_DEKI_SESSION_ID,
        title: titleFromMessages(legacyMessages),
        messages: legacyMessages,
        compaction: normalizeDekiCompaction(object),
        now: legacyMessages[0]?.createdAt ?? new Date().toISOString(),
      }),
    );
  }

  const requestedActiveId = typeof object.activeSessionId === "string" ? object.activeSessionId : null;
  const activeSessionId = sessions.some((session) => session.id === requestedActiveId)
    ? requestedActiveId!
    : sessions[0]!.id;

  return { activeSessionId, sessions };
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

async function readSessionsState(): Promise<DekiSessionsState> {
  return normalizeDekiSessionsState(await readSettingsValue());
}

async function saveSessionsState(state: DekiSessionsState): Promise<DekiSessionsState> {
  return normalizeDekiSessionsState(
    await saveSettingsPatch({
      activeSessionId: state.activeSessionId,
      sessions: state.sessions,
    }),
  );
}

function updateSession(
  state: DekiSessionsState,
  sessionId: string | null | undefined,
  update: (session: DekiSession) => DekiSession,
) {
  const session = sessionId ? state.sessions.find((item) => item.id === sessionId) : getActiveDekiSession(state);
  const target = session ?? getActiveDekiSession(state);
  return {
    activeSessionId: target.id,
    sessions: state.sessions.map((item) => (item.id === target.id ? update(target) : item)),
  } satisfies DekiSessionsState;
}

function sessionFromState(state: DekiSessionsState, sessionId: string | null | undefined): DekiSession {
  return sessionId
    ? (state.sessions.find((item) => item.id === sessionId) ?? getActiveDekiSession(state))
    : getActiveDekiSession(state);
}

function historySnapshot(state: DekiSessionsState, sessionId: string | null | undefined): DekiHistorySnapshot {
  const session = sessionFromState(state, sessionId);
  return {
    session,
    messages: session.messages,
    compaction: session.compaction,
  };
}

function compactionForMessages(messages: DekiMessage[], compaction: DekiCompactionState): DekiCompactionState {
  const throughMessageId = compaction.compactedThroughMessageId;
  if (!throughMessageId || messages.some((message) => message.id === throughMessageId)) return compaction;
  return {
    compactedSummary: null,
    compactedAt: null,
    compactedThroughMessageId: null,
  };
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
  sessions: {
    list: readSessionsState,
    create: async (): Promise<DekiSessionsState> => {
      const state = await readSessionsState();
      const session = createEmptyDekiSession();
      return saveSessionsState({ activeSessionId: session.id, sessions: [session, ...state.sessions] });
    },
    select: async (sessionId: string): Promise<DekiSessionsState> => {
      const state = await readSessionsState();
      const nextActiveSessionId = state.sessions.some((session) => session.id === sessionId)
        ? sessionId
        : state.activeSessionId;
      return saveSessionsState({ ...state, activeSessionId: nextActiveSessionId });
    },
    delete: async (sessionId: string): Promise<DekiSessionsState> => {
      const state = await readSessionsState();
      const remaining = state.sessions.filter((session) => session.id !== sessionId);
      if (remaining.length === 0) {
        const session = createEmptyDekiSession();
        return saveSessionsState({ activeSessionId: session.id, sessions: [session] });
      }
      const activeSessionId = state.activeSessionId === sessionId ? remaining[0]!.id : state.activeSessionId;
      return saveSessionsState({ activeSessionId, sessions: remaining });
    },
  },
  history: {
    get: async (sessionId?: string | null): Promise<DekiHistorySnapshot> => {
      return historySnapshot(await readSessionsState(), sessionId);
    },
    appendMessage: async (message: {
      sessionId?: string | null;
      role: "user" | "assistant";
      content: string;
    }): Promise<DekiMessage> => {
      const state = await readSessionsState();
      const nextMessage = createDekiMessage(message);
      const nextState = updateSession(state, message.sessionId, (session) => {
        const messages = [...session.messages, nextMessage];
        const isDefaultTitle = session.title === "New Deki Chat";
        return {
          ...session,
          title: message.role === "user" && isDefaultTitle ? titleFromMessages(messages) : session.title,
          messages,
          updatedAt: nextMessage.createdAt,
        };
      });
      await saveSessionsState(nextState);
      return nextMessage;
    },
    replaceMessages: async ({
      sessionId,
      messages,
      compaction,
    }: {
      sessionId?: string | null;
      messages: DekiMessage[];
      compaction: DekiCompactionState;
    }): Promise<DekiHistorySnapshot> => {
      const state = await readSessionsState();
      const nextCompaction = compactionForMessages(messages, compaction);
      const nextState = updateSession(state, sessionId, (session) => ({
        ...session,
        title: titleFromMessages(messages),
        messages,
        compaction: nextCompaction,
        updatedAt: messages.at(-1)?.createdAt ?? new Date().toISOString(),
      }));
      return historySnapshot(await saveSessionsState(nextState), sessionId);
    },
    updateMessage: async ({
      sessionId,
      messageId,
      content,
    }: {
      sessionId?: string | null;
      messageId: string;
      content: string;
    }): Promise<DekiMessage> => {
      const state = await readSessionsState();
      let updatedMessage: DekiMessage | null = null;
      const nextState = updateSession(state, sessionId, (session) => {
        const messages = session.messages.map((message) => {
          if (message.id !== messageId) return message;
          updatedMessage = { ...message, content };
          return updatedMessage;
        });
        return {
          ...session,
          title: titleFromMessages(messages),
          messages,
          updatedAt: updatedMessage?.createdAt ?? session.updatedAt,
        };
      });
      if (!updatedMessage) throw new Error("Deki-senpai message could not be found.");
      await saveSessionsState(nextState);
      return updatedMessage;
    },
    saveCompaction: async (
      sessionId: string | null | undefined,
      compaction: DekiCompactionState,
    ): Promise<DekiCompactionState> => {
      const state = await readSessionsState();
      const nextState = updateSession(state, sessionId, (session) => ({ ...session, compaction }));
      const saved = await saveSessionsState(nextState);
      return sessionFromState(saved, sessionId).compaction;
    },
    reset: async (_sessionId?: string | null): Promise<DekiSessionsState> => {
      const state = await readSessionsState();
      const session = createEmptyDekiSession();
      return saveSessionsState({ activeSessionId: session.id, sessions: [session, ...state.sessions] });
    },
  },
};
