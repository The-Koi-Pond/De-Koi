// ──────────────────────────────────────────────
// Zustand Store: Game State Slice (RPG Companion)
// ──────────────────────────────────────────────
import { create } from "zustand";
import type { TrackerState } from "../../../../engine/contracts/types/tracker-state";
import { coerceTrackerStateTextFields } from "../../../../engine/shared/tracker-state/tracker-state-text";
import { normalizeTrackerStateTrackerRows } from "../../../../engine/shared/tracker-state/tracker-row-ids";

interface TrackerStateStore {
  current: TrackerState | null;
  isVisible: boolean;
  isRefreshing: boolean;
  refreshingChatId: string | null;
  expandedSections: Set<string>;
  /** Flushes any pending debounced game-state patch immediately. */
  flushPatch: (() => Promise<void>) | null;

  // Actions
  setTrackerState: (state: TrackerState | null) => void;
  setVisible: (visible: boolean) => void;
  setRefreshingChat: (chatId: string | null) => void;
  clearRefreshingChat: (chatId: string | null) => void;
  toggleSection: (section: string) => void;
  registerFlushPatch: (id: string, fn: () => Promise<void>) => () => void;
  reset: () => void;
}

const flushPatchCallbacks = new Map<string, () => Promise<void>>();

function normalizeTrackerState(state: TrackerState | null): TrackerState | null {
  if (!state) return null;
  return normalizeTrackerStateTrackerRows({
    ...state,
    ...coerceTrackerStateTextFields(state as unknown as Record<string, unknown>),
  });
}

function buildFlushPatch() {
  if (flushPatchCallbacks.size === 0) return null;
  return async () => {
    const callbacks = Array.from(flushPatchCallbacks.values());
    const results = await Promise.allSettled(callbacks.map((callback) => callback()));
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length > 0) {
      throw new Error(
        `Failed to flush ${failures.length} game-state patch callback${failures.length === 1 ? "" : "s"}.`,
      );
    }
  };
}

export const useTrackerStateStore = create<TrackerStateStore>((set) => ({
  current: null,
  isVisible: true,
  isRefreshing: false,
  refreshingChatId: null,
  expandedSections: new Set(["location", "characters", "stats"]),
  flushPatch: null,

  setTrackerState: (state) =>
    set((currentStore) => ({
      current: normalizeTrackerState(state),
      isRefreshing: currentStore.refreshingChatId !== null && currentStore.refreshingChatId === state?.chatId,
    })),
  setVisible: (visible) => set({ isVisible: visible }),
  setRefreshingChat: (chatId) =>
    set((currentStore) => ({
      refreshingChatId: chatId,
      isRefreshing: chatId !== null && chatId === currentStore.current?.chatId,
    })),
  clearRefreshingChat: (chatId) =>
    set((currentStore) => {
      if (!currentStore.refreshingChatId || currentStore.refreshingChatId !== chatId) return {};
      return { refreshingChatId: null, isRefreshing: false };
    }),
  registerFlushPatch: (id, fn) => {
    flushPatchCallbacks.set(id, fn);
    set({ flushPatch: buildFlushPatch() });
    return () => {
      flushPatchCallbacks.delete(id);
      set({ flushPatch: buildFlushPatch() });
    };
  },

  toggleSection: (section) =>
    set((s) => {
      const expanded = new Set(s.expandedSections);
      if (expanded.has(section)) expanded.delete(section);
      else expanded.add(section);
      return { expandedSections: expanded };
    }),

  reset: () => {
    flushPatchCallbacks.clear();
    set({
      current: null,
      isVisible: true,
      isRefreshing: false,
      refreshingChatId: null,
      expandedSections: new Set(["location", "characters", "stats"]),
      flushPatch: null,
    });
  },
}));
