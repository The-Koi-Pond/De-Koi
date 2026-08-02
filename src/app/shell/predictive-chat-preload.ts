import type { ChatListItem } from "../../features/catalog/chats/sidebar";
import { requestIdleWork } from "./idle-work";

export type PredictiveChatCandidate = Pick<ChatListItem, "id" | "mode" | "updatedAt">;
export type PredictiveIdleRequest = (callback: () => void) => () => void;

export interface PredictiveChatPreloadDependencies {
  hasDetail(chatId: string): boolean;
  hasMessages(chatId: string): boolean;
  preloadSurface(): Promise<unknown>;
  preloadRoute(mode: PredictiveChatCandidate["mode"]): Promise<unknown>;
  prefetchDetail(chatId: string): Promise<unknown>;
  prefetchMessages(chatId: string): Promise<unknown>;
  removeDetail(chatId: string): void;
  removeMessages(chatId: string): void;
}

type SpeculativeEntry = { id: string; ownsDetail: boolean; ownsMessages: boolean };

export function selectRecentPredictiveChats(
  chats: readonly ChatListItem[],
  activeChatId: string | null,
  limit = 3,
): PredictiveChatCandidate[] {
  return [...chats]
    .filter((chat) => chat.id !== activeChatId)
    .sort((left, right) => {
      const timeDifference = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
      return timeDifference || left.id.localeCompare(right.id);
    })
    .slice(0, Math.max(0, limit));
}

export function createPredictiveChatPreloadController(
  dependencies: PredictiveChatPreloadDependencies,
  capacity = 3,
) {
  let activeChatId: string | null = null;
  const entries: SpeculativeEntry[] = [];
  const inFlight = new Map<string, Promise<void>>();

  function evictOverflow() {
    while (entries.length > capacity) {
      const evicted = entries.shift();
      if (!evicted) return;
      if (evicted.ownsDetail) dependencies.removeDetail(evicted.id);
      if (evicted.ownsMessages) dependencies.removeMessages(evicted.id);
    }
  }

  function promote(chatId: string) {
    const existingIndex = entries.findIndex((entry) => entry.id === chatId);
    const existing = existingIndex >= 0 ? entries.splice(existingIndex, 1)[0] : undefined;
    const entry = existing ?? {
      id: chatId,
      ownsDetail: !dependencies.hasDetail(chatId),
      ownsMessages: !dependencies.hasMessages(chatId),
    };
    entries.push(entry);
    evictOverflow();
  }

  return {
    setActiveChatId(chatId: string | null) {
      activeChatId = chatId;
      if (!chatId) return;
      const index = entries.findIndex((entry) => entry.id === chatId);
      if (index >= 0) entries.splice(index, 1);
    },
    preload(chat: PredictiveChatCandidate): Promise<void> {
      if (chat.id === activeChatId) return Promise.resolve();
      promote(chat.id);
      const existing = inFlight.get(chat.id);
      if (existing) return existing;
      const request = Promise.allSettled([
        dependencies.preloadSurface(),
        dependencies.preloadRoute(chat.mode),
        dependencies.prefetchDetail(chat.id),
        dependencies.prefetchMessages(chat.id),
      ])
        .then(() => undefined)
        .finally(() => inFlight.delete(chat.id));
      inFlight.set(chat.id, request);
      return request;
    },
  };
}

export function scheduleIdlePredictiveChatPreloads(
  candidates: readonly PredictiveChatCandidate[],
  preload: (chat: PredictiveChatCandidate) => Promise<void>,
  requestIdle: PredictiveIdleRequest = requestIdleWork,
): () => void {
  const queue = [...candidates];
  let cancelled = false;
  let cancelScheduled: () => void = () => undefined;
  const scheduleNext = () => {
    if (cancelled || queue.length === 0) return;
    cancelScheduled = requestIdle(() => {
      if (cancelled) return;
      const next = queue.shift();
      if (!next) return;
      void preload(next)
        .catch(() => undefined)
        .finally(scheduleNext);
    });
  };
  scheduleNext();
  return () => {
    cancelled = true;
    cancelScheduled();
  };
}

export function predictiveChatIntentHandlers(
  chat: PredictiveChatCandidate,
  preload: (chat: PredictiveChatCandidate) => void,
) {
  const onIntent = () => preload(chat);
  return { onPointerEnter: onIntent, onFocus: onIntent, onPointerDown: onIntent };
}
