import { useCallback, useEffect, useRef, useState } from "react";
import { gameApi } from "../api/game-api";
import { useGameStateStore } from "../../../runtime/world-state/index";
import type { GameStatePatchField, GameStatePatchValue } from "../../../runtime/world-state/types";
import type { Chat } from "../../../../engine/contracts/types/chat";
import type { InventoryTag, ReadableTag } from "../lib/game-tag-parser";
import {
  addDetailedInventoryUnit,
  addInventoryUnit,
  normalizeInventoryName,
  removeDetailedInventoryUnit,
  removeInventoryUnit,
} from "../lib/game-inventory-items";

export type JournalReadable = ReadableTag & {
  sourceMessageId?: string | null;
  sourceSegmentIndex?: number | null;
};

type InventoryNotificationKind = "gain" | "loss" | "use-pending" | "use-kept" | "use-consumed" | "error";

export interface InventoryNotification {
  id: string;
  kind: InventoryNotificationKind;
  message: string;
}

export interface PendingInventoryUse {
  id: string;
  itemName: string;
  normalizedItemName: string;
  submittedAfterMessageId: string | null;
}

type InventoryItemSummary = { name: string; quantity: number };

type UseGameInventoryJournalControllerParams = {
  activeChatId: string;
  chatMeta: Record<string, unknown>;
  sceneRuntimeScopeKey: string;
  patchVisibleGameState: <K extends GameStatePatchField>(
    field: K,
    value: GameStatePatchValue[K],
  ) => Promise<unknown>;
  persistMetadata: (chatId: string, patch: Record<string, unknown>) => Promise<unknown>;
  publishSessionChat: (sessionChat: Chat | null | undefined) => void;
};

export function useGameInventoryJournalController({
  activeChatId,
  chatMeta,
  sceneRuntimeScopeKey,
  patchVisibleGameState,
  persistMetadata,
  publishSessionChat,
}: UseGameInventoryJournalControllerParams) {
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [inventoryItems, setInventoryItems] = useState<InventoryItemSummary[]>(() => {
    return (chatMeta.gameInventory as InventoryItemSummary[]) ?? [];
  });
  const inventoryItemsRef = useRef(inventoryItems);
  const [inventoryNotifications, setInventoryNotifications] = useState<InventoryNotification[]>([]);
  const [pendingInventoryUse, setPendingInventoryUse] = useState<PendingInventoryUse | null>(null);
  const pendingInventoryUseRef = useRef<PendingInventoryUse | null>(null);
  const [pendingInventorySegmentUpdates, setPendingInventorySegmentUpdates] = useState<
    Array<{ segment: number; update: InventoryTag }>
  >([]);
  const appliedInventorySegmentsRef = useRef<Set<number>>(new Set());
  const [activeReadable, setActiveReadable] = useState<JournalReadable | null>(null);
  const readableQueueRef = useRef<JournalReadable[]>([]);
  const notificationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousScopeRef = useRef(sceneRuntimeScopeKey);

  const clearInventoryNotificationTimer = useCallback(() => {
    if (!notificationTimerRef.current) return;
    clearTimeout(notificationTimerRef.current);
    notificationTimerRef.current = null;
  }, []);

  const showInventoryNotifications = useCallback(
    (notifications: InventoryNotification[], durationMs: number | null = 4000) => {
      setInventoryNotifications(notifications);
      clearInventoryNotificationTimer();
      if (durationMs !== null) {
        notificationTimerRef.current = setTimeout(() => {
          setInventoryNotifications([]);
          notificationTimerRef.current = null;
        }, durationMs);
      }
    },
    [clearInventoryNotificationTimer],
  );

  const setInventoryFromMetadata = useCallback((metadata: Record<string, unknown>) => {
    const nextInventory = Array.isArray(metadata.gameInventory) ? (metadata.gameInventory as InventoryItemSummary[]) : [];
    setInventoryItems(nextInventory);
    inventoryItemsRef.current = nextInventory;
  }, []);

  const resetInventoryAndReadables = useCallback(() => {
    const nextInventory = (chatMeta.gameInventory as InventoryItemSummary[]) ?? [];
    setInventoryItems(nextInventory);
    inventoryItemsRef.current = nextInventory;
    setInventoryNotifications([]);
    setPendingInventoryUse(null);
    pendingInventoryUseRef.current = null;
    clearInventoryNotificationTimer();
    setPendingInventorySegmentUpdates([]);
    appliedInventorySegmentsRef.current = new Set();
    setActiveReadable(null);
    readableQueueRef.current = [];
  }, [chatMeta.gameInventory, clearInventoryNotificationTimer]);

  useEffect(() => {
    inventoryItemsRef.current = inventoryItems;
  }, [inventoryItems]);

  useEffect(() => {
    pendingInventoryUseRef.current = pendingInventoryUse;
  }, [pendingInventoryUse]);

  useEffect(() => {
    if (previousScopeRef.current === sceneRuntimeScopeKey) return;
    previousScopeRef.current = sceneRuntimeScopeKey;
    resetInventoryAndReadables();
  }, [resetInventoryAndReadables, sceneRuntimeScopeKey]);

  const upsertReadableJournalEntry = useCallback(
    (readable: JournalReadable) => {
      void gameApi
        .addJournalEntry({
          chatId: activeChatId,
          type: "note",
          data: {
            title: readable.type === "book" ? "Book" : "Note",
            content: readable.content,
            readableType: readable.type,
            sourceMessageId: readable.sourceMessageId,
            sourceSegmentIndex: readable.sourceSegmentIndex,
          },
        })
        .then((res) => publishSessionChat(res.sessionChat))
        .catch(() => {});
    },
    [activeChatId, publishSessionChat],
  );

  const handleReadable = useCallback(
    (readable: JournalReadable) => {
      upsertReadableJournalEntry(readable);
      if (activeReadable) {
        readableQueueRef.current.push(readable);
      } else {
        setActiveReadable(readable);
      }
    },
    [activeReadable, upsertReadableJournalEntry],
  );

  const closeActiveReadable = useCallback(() => {
    const next = readableQueueRef.current.shift();
    setActiveReadable(next ?? null);
  }, []);

  const applyInventoryUpdates = useCallback(
    async (updates: InventoryTag[]): Promise<boolean> => {
      if (updates.length === 0) return true;

      const notifications: InventoryNotification[] = [];
      const journalEntries: Array<{ item: string; action: "acquired" | "lost" }> = [];
      const previousInventory = inventoryItemsRef.current;
      let updated = previousInventory;
      const pendingUse = pendingInventoryUseRef.current;
      let consumedPendingUse = false;
      const currentGameState = useGameStateStore.getState().current;
      const currentPlayerStats = currentGameState?.chatId === activeChatId ? currentGameState.playerStats : null;
      let nextPlayerStats = currentPlayerStats;

      for (const invUpdate of updates) {
        for (const itemName of invUpdate.items) {
          const normalizedItemName = normalizeInventoryName(itemName);
          if (!normalizedItemName) continue;

          let applied = false;
          if (invUpdate.action === "add") {
            updated = addInventoryUnit(updated, normalizedItemName);
            if (nextPlayerStats) {
              nextPlayerStats = {
                ...nextPlayerStats,
                inventory: addDetailedInventoryUnit(nextPlayerStats.inventory, normalizedItemName),
              };
            }
            notifications.push({
              id: `gain-${normalizedItemName}-${Date.now()}-${notifications.length}`,
              kind: "gain",
              message: `You gained ${normalizedItemName}!`,
            });
            applied = true;
          } else {
            const nextInventory = removeInventoryUnit(updated, normalizedItemName);
            if (nextInventory !== updated) {
              updated = nextInventory;
              const matchesPendingUse =
                !!pendingUse && normalizedItemName.toLowerCase() === pendingUse.normalizedItemName.toLowerCase();
              if (matchesPendingUse) {
                consumedPendingUse = true;
                notifications.push({
                  id: `use-consumed-${normalizedItemName}-${Date.now()}-${notifications.length}`,
                  kind: "use-consumed",
                  message: `${normalizedItemName} was used and removed from inventory.`,
                });
              } else {
                notifications.push({
                  id: `loss-${normalizedItemName}-${Date.now()}-${notifications.length}`,
                  kind: "loss",
                  message: `You lost ${normalizedItemName}!`,
                });
              }
              applied = true;
            }
            if (nextPlayerStats) {
              const nextDetailedInventory = removeDetailedInventoryUnit(nextPlayerStats.inventory, normalizedItemName);
              if (nextDetailedInventory !== nextPlayerStats.inventory) {
                nextPlayerStats = { ...nextPlayerStats, inventory: nextDetailedInventory };
                applied = true;
              }
            }
          }

          if (applied) {
            journalEntries.push({
              item: normalizedItemName,
              action: invUpdate.action === "add" ? "acquired" : "lost",
            });
          }
        }
      }

      try {
        if (updated !== previousInventory) {
          await persistMetadata(activeChatId, { gameInventory: updated });
        }
      } catch (error) {
        console.warn("Failed to persist inventory update", error);
        showInventoryNotifications(
          [
            {
              id: `inventory-error-${Date.now()}`,
              kind: "error",
              message: "Inventory update could not be saved. Try this step again.",
            },
          ],
          6000,
        );
        return false;
      }

      if (currentGameState?.chatId === activeChatId && currentPlayerStats && nextPlayerStats !== currentPlayerStats) {
        try {
          await patchVisibleGameState("playerStats", nextPlayerStats);
        } catch (error) {
          const current = useGameStateStore.getState().current;
          if (current?.chatId === activeChatId) {
            useGameStateStore.getState().setGameState({ ...current, playerStats: nextPlayerStats });
          }
          // The game-state patcher keeps failed flushes queued; compact metadata is already durable.
          console.warn("Failed to flush visible inventory game-state patch", error);
        }
      }

      if (updated !== previousInventory) {
        inventoryItemsRef.current = updated;
        setInventoryItems(updated);
      }

      if (journalEntries.length > 0) {
        void (async () => {
          for (const entry of journalEntries) {
            try {
              const res = await gameApi.addJournalEntry({
                chatId: activeChatId,
                type: "item",
                data: {
                  item: entry.item,
                  action: entry.action,
                  quantity: 1,
                },
              });
              publishSessionChat(res.sessionChat);
            } catch {
              // Best-effort journal write; keep inventory updates responsive.
            }
          }
        })();
      }

      if (notifications.length > 0) {
        showInventoryNotifications(notifications);
      }
      if (consumedPendingUse) {
        setPendingInventoryUse(null);
      }
      return true;
    },
    [activeChatId, patchVisibleGameState, persistMetadata, publishSessionChat, showInventoryNotifications],
  );

  return {
    activeReadable,
    appliedInventorySegmentsRef,
    applyInventoryUpdates,
    closeActiveReadable,
    handleReadable,
    inventoryItems,
    inventoryItemsRef,
    inventoryNotifications,
    inventoryOpen,
    pendingInventorySegmentUpdates,
    pendingInventoryUse,
    readableQueueRef,
    resetInventoryAndReadables,
    setActiveReadable,
    setInventoryFromMetadata,
    setInventoryItems,
    setInventoryOpen,
    setInventoryNotifications,
    setPendingInventorySegmentUpdates,
    setPendingInventoryUse,
    showInventoryNotifications,
    upsertReadableJournalEntry,
  };
}
