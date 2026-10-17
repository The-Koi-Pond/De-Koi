import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CustomTrackerField,
  TrackerState,
  InventoryItem,
  PresentCharacter,
  QuestProgress,
} from "../../../../engine/contracts/types/tracker-state";
import type { TrackerStateController, TrackerStateSnapshot } from "../types";
import { worldStateApi } from "../api/world-state-api";
import { useTrackerStateStore } from "../stores/world-state.store";
import { useTrackerStatePatcher } from "./use-world-state-patcher";

function getTrackerStateSnapshot(gameState: TrackerState | null): TrackerStateSnapshot {
  const playerStats = gameState?.playerStats ?? null;
  return {
    gameState,
    playerStats,
    personaStats: gameState?.personaStats ?? [],
    presentCharacters: gameState?.presentCharacters ?? ([] as PresentCharacter[]),
    inventory: playerStats?.inventory ?? ([] as InventoryItem[]),
    quests: playerStats?.activeQuests ?? ([] as QuestProgress[]),
    customTrackerFields: playerStats?.customTrackerFields ?? ([] as CustomTrackerField[]),
  };
}

export function useTrackerStateController(
  chatId: string | null,
  registrationId?: string,
  enabled = true,
): TrackerStateController {
  const activeChatId = enabled ? chatId : null;
  const gameState = useTrackerStateStore((s) =>
    activeChatId && s.current?.chatId === activeChatId ? s.current : null,
  );
  const gameStateRefreshing = useTrackerStateStore((s) => s.isRefreshing);
  const setTrackerState = useTrackerStateStore((s) => s.setTrackerState);
  const { patchField, patchPlayerStats, flushPatch } = useTrackerStatePatcher(activeChatId, registrationId);
  const [loadingTrackerState, setLoadingTrackerState] = useState(false);
  const getSnapshot = useCallback(() => {
    const current = useTrackerStateStore.getState().current;
    return getTrackerStateSnapshot(activeChatId && current?.chatId === activeChatId ? current : null);
  }, [activeChatId]);

  useEffect(() => {
    if (!activeChatId) {
      setLoadingTrackerState(false);
      return;
    }

    const existing = useTrackerStateStore.getState().current;
    if (existing?.chatId === activeChatId) {
      setLoadingTrackerState(false);
      return;
    }

    let cancelled = false;
    setLoadingTrackerState(true);
    worldStateApi
      .get(activeChatId)
      .then((state) => {
        if (!cancelled) setTrackerState(state ?? null);
      })
      .catch(() => {
        if (!cancelled) setTrackerState(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingTrackerState(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeChatId, setTrackerState]);

  const snapshot = useMemo(
    () => ({
      ...getTrackerStateSnapshot(gameState as TrackerState | null),
      loadingTrackerState,
      gameStateRefreshing,
      isLoadingTrackerState: loadingTrackerState || gameStateRefreshing,
    }),
    [gameState, gameStateRefreshing, loadingTrackerState],
  );

  return {
    ...snapshot,
    getSnapshot,
    patchField,
    patchPlayerStats,
    flushPatch,
  };
}
