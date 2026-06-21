import type { QueryClient } from "@tanstack/react-query";

import type { Chat } from "../../../../engine/contracts/types/chat";
import { useChatStore } from "../../../../shared/stores/chat.store";
import { chatKeys } from "../query-keys";

export type ChatCacheRecord = Chat | (Record<string, unknown> & { id?: string; groupId?: unknown; metadata?: unknown });
type ChatListFamilyQueryClient = Pick<QueryClient, "getQueriesData" | "setQueryData">;

function parseCacheRecord(value: unknown): Record<string, unknown> {
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

function updateCachedChatRows<T extends ChatCacheRecord>(
  rows: T[] | undefined,
  id: string,
  updater: (row: T) => T,
): T[] | undefined {
  if (!Array.isArray(rows)) return rows;
  let changed = false;
  const next = rows.map((row) => {
    if (!row || row.id !== id) return row;
    changed = true;
    return updater(row);
  });
  return changed ? next : rows;
}

function chatCacheRecordId(chat: ChatCacheRecord): string | null {
  return typeof chat.id === "string" && chat.id.trim() ? chat.id : null;
}

function chatCacheGroupId(chat: ChatCacheRecord): string | null {
  const groupId = chat.groupId;
  return typeof groupId === "string" && groupId.trim() ? groupId : null;
}

function recentSummariesLimit(queryKey: readonly unknown[]): number | null {
  const prefix = chatKeys.summaries();
  if (
    queryKey.length !== prefix.length + 2 ||
    !prefix.every((part, index) => queryKey[index] === part) ||
    queryKey[prefix.length] !== "recent"
  ) {
    return null;
  }
  const limit = queryKey[prefix.length + 1];
  return typeof limit === "number" && Number.isInteger(limit) && limit > 0 ? limit : null;
}

export function upsertChatCacheRows<T extends ChatCacheRecord>(rows: T[] | undefined, chat: T): T[] | undefined {
  if (!Array.isArray(rows)) return rows;
  const id = chatCacheRecordId(chat);
  if (!id) return rows;
  const existingIndex = rows.findIndex((row) => row?.id === id);
  if (existingIndex === -1) return [chat, ...rows];
  return rows.map((row) => (row?.id === id ? chat : row));
}

export function syncChatBranchCacheRows<T extends ChatCacheRecord>(
  rows: T[] | undefined,
  sourceChatId: string,
  newChat: T,
): T[] | undefined {
  if (!Array.isArray(rows)) return rows;
  const groupId = chatCacheGroupId(newChat);
  const groupedRows = groupId
    ? rows.map((row) => (row?.id === sourceChatId && row.groupId !== groupId ? { ...row, groupId } : row))
    : rows;
  return upsertChatCacheRows(groupedRows as T[], newChat);
}

function setChatListFamilyRows(
  qc: ChatListFamilyQueryClient,
  updater: (rows: ChatCacheRecord[] | undefined) => ChatCacheRecord[] | undefined,
) {
  qc.setQueryData<ChatCacheRecord[]>(chatKeys.list(), updater);

  for (const [queryKey] of qc.getQueriesData<ChatCacheRecord[]>({ queryKey: chatKeys.summaries() })) {
    qc.setQueryData<ChatCacheRecord[]>(queryKey, (rows) => {
      const next = updater(rows);
      const limit = recentSummariesLimit(queryKey);
      return limit && Array.isArray(next) ? next.slice(0, limit) : next;
    });
  }
}

export function applyChatFieldPatch<T extends ChatCacheRecord>(chat: T, patch: Record<string, unknown>): T {
  return { ...chat, ...patch } as T;
}

export function applyChatMetadataPatch<T extends ChatCacheRecord>(chat: T, patch: Record<string, unknown>): T {
  return {
    ...chat,
    metadata: {
      ...parseCacheRecord(chat.metadata),
      ...patch,
    },
  } as T;
}

export function setChatCacheRecord(
  qc: Pick<QueryClient, "setQueryData" | "setQueriesData">,
  id: string,
  updater: (chat: ChatCacheRecord) => ChatCacheRecord,
) {
  qc.setQueryData<ChatCacheRecord | undefined>(chatKeys.detail(id), (current) =>
    current ? updater(current) : current,
  );
  qc.setQueriesData<ChatCacheRecord[]>({ queryKey: chatKeys.list() }, (rows) =>
    updateCachedChatRows(rows, id, updater),
  );
  qc.setQueriesData<ChatCacheRecord[]>({ queryKey: [...chatKeys.all, "group"] }, (rows) =>
    updateCachedChatRows(rows, id, updater),
  );

  const activeChat = useChatStore.getState().activeChat as ChatCacheRecord | null;
  if (activeChat?.id === id) {
    useChatStore.getState().setActiveChat(updater(activeChat) as unknown as Chat);
  }
}

export function upsertChatCacheRecord(qc: ChatListFamilyQueryClient, chat: ChatCacheRecord) {
  const id = chatCacheRecordId(chat);
  if (!id) return;
  qc.setQueryData<ChatCacheRecord>(chatKeys.detail(id), chat);
  setChatListFamilyRows(qc, (rows) => upsertChatCacheRows(rows, chat));
  const groupId = chatCacheGroupId(chat);
  if (groupId) {
    qc.setQueryData<ChatCacheRecord[]>(chatKeys.group(groupId), (rows) => upsertChatCacheRows(rows, chat));
  }
}

export function syncBranchedChatCacheRecord(
  qc: ChatListFamilyQueryClient,
  sourceChatId: string,
  newChat: ChatCacheRecord,
) {
  const newChatId = chatCacheRecordId(newChat);
  if (!newChatId) return;

  qc.setQueryData<ChatCacheRecord>(chatKeys.detail(newChatId), newChat);
  setChatListFamilyRows(qc, (rows) => syncChatBranchCacheRows(rows, sourceChatId, newChat));

  const groupId = chatCacheGroupId(newChat);
  if (!groupId) return;

  qc.setQueryData<ChatCacheRecord | undefined>(chatKeys.detail(sourceChatId), (current) =>
    current && current.groupId !== groupId ? { ...current, groupId } : current,
  );
  qc.setQueryData<ChatCacheRecord[]>(chatKeys.group(groupId), (rows) =>
    syncChatBranchCacheRows(rows, sourceChatId, newChat),
  );

  const activeChat = useChatStore.getState().activeChat as ChatCacheRecord | null;
  if (activeChat?.id === sourceChatId && activeChat.groupId !== groupId) {
    useChatStore.getState().setActiveChat({ ...activeChat, groupId } as unknown as Chat);
  }
}

export function cancelChatCacheQueries(qc: QueryClient, id: string) {
  // Tauri-backed reads are not abortable, so awaiting broad cache cancellation
  // can make optimistic chat-setting toggles wait behind large startup loads.
  void qc.cancelQueries({ queryKey: chatKeys.detail(id) }).catch(() => undefined);
  void qc.cancelQueries({ queryKey: chatKeys.list() }).catch(() => undefined);
  void qc.cancelQueries({ queryKey: [...chatKeys.all, "group"] }).catch(() => undefined);
}
