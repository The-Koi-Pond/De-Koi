import { useCallback, useEffect, useRef, useState } from "react";
import type { RecordGameJournalEntry } from "./use-game-surface-persistence-controller";
import { useGameStateStore } from "../../../runtime/world-state/index";
import type { GameStatePatchField, GameStatePatchValue } from "../../../runtime/world-state/types";
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
const MAX_INVENTORY_TAG_COUNT = 99;

function inventoryTagCount(update: InventoryTag): number {
  const raw = Number(update.count ?? 1);
  return Number.isFinite(raw) ? Math.min(MAX_INVENTORY_TAG_COUNT, Math.max(1, Math.floor(raw))) : 1;
}

function inventoryQuantityText(itemName: string, quantity: number): string {
  return quantity === 1 ? itemName : `${quantity} x ${itemName}`;
}

type UseGameInventoryJournalControllerParams = {
  activeChatId: string;
  chatMeta: Record<string, unknown>;
  sceneRuntimeScopeKey: string;
  patchVisibleGameState: <K extends GameStatePatchField>(field: K, value: GameStatePatchValue[K]) => Promise<unknown>;
  persistMetadata: (chatId: string, patch: Record<string, unknown>) => Promise<unknown>;
  recordJournalEntry: RecordGameJournalEntry;
};

export function useGameInventoryJournalController({
  activeChatId,
  chatMeta,
  sceneRuntimeScopeKey,
  patchVisibleGameState,
  persistMetadata,
  recordJournalEntry,
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
    const nextInventory = Array.isArray(metadata.gameInventory)
      ? (metadata.gameInventory as InventoryItemSummary[])
      : [];
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
      void recordJournalEntry({
        chatId: activeChatId,
        type: "note",
        data: {
          title: readable.type === "book" ? "Book" : "Note",
          content: readable.content,
          readableType: readable.type,
          sourceMessageId: readable.sourceMessageId,
          sourceSegmentIndex: readable.sourceSegmentIndex,
        },
      });
    },
    [activeChatId, recordJournalEntry],
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
      const journalEntries: Array<{ item: string; action: "acquired" | "lost"; quantity: number }> = [];
      const previousInventory = inventoryItemsRef.current;
      let updated = previousInventory;
      const pendingUse = pendingInventoryUseRef.current;
      let consumedPendingUse = false;
      const currentGameState = useGameStateStore.getState().current;
      const currentPlayerStats = currentGameState?.chatId === activeChatId ? currentGameState.playerStats : null;
      let nextPlayerStats = currentPlayerStats;

      for (const invUpdate of updates) {
        const requestedQuantity = inventoryTagCount(invUpdate);
        for (const itemName of invUpdate.items) {
          const normalizedItemName = normalizeInventoryName(itemName);
          if (!normalizedItemName) continue;

          let appliedQuantity = 0;
          if (invUpdate.action === "add") {
            for (let index = 0; index < requestedQuantity; index += 1) {
              updated = addInventoryUnit(updated, normalizedItemName);
              if (nextPlayerStats) {
                nextPlayerStats = {
                  ...nextPlayerStats,
                  inventory: addDetailedInventoryUnit(nextPlayerStats.inventory, normalizedItemName),
                };
              }
              appliedQuantity += 1;
            }
            notifications.push({
              id: `gain-${normalizedItemName}-${Date.now()}-${notifications.length}`,
              kind: "gain",
              message: `You gained ${inventoryQuantityText(normalizedItemName, appliedQuantity)}!`,
            });
          } else {
            for (let index = 0; index < requestedQuantity; index += 1) {
              let appliedUnit = false;
              const nextInventory = removeInventoryUnit(updated, normalizedItemName);
              if (nextInventory !== updated) {
                updated = nextInventory;
                appliedUnit = true;
              }
              if (nextPlayerStats) {
                const nextDetailedInventory = removeDetailedInventoryUnit(
                  nextPlayerStats.inventory,
                  normalizedItemName,
                );
                if (nextDetailedInventory !== nextPlayerStats.inventory) {
                  nextPlayerStats = { ...nextPlayerStats, inventory: nextDetailedInventory };
                  appliedUnit = true;
                }
              }
              if (appliedUnit) {
                appliedQuantity += 1;
              }
            }
            if (appliedQuantity > 0) {
              const quantityText = inventoryQuantityText(normalizedItemName, appliedQuantity);
              const matchesPendingUse =
                !!pendingUse && normalizedItemName.toLowerCase() === pendingUse.normalizedItemName.toLowerCase();
              if (matchesPendingUse) {
                consumedPendingUse = true;
                notifications.push({
                  id: `use-consumed-${normalizedItemName}-${Date.now()}-${notifications.length}`,
                  kind: "use-consumed",
                  message: `Inventory use removed ${quantityText}.`,
                });
              } else {
                notifications.push({
                  id: `loss-${normalizedItemName}-${Date.now()}-${notifications.length}`,
                  kind: "loss",
                  message: `You lost ${quantityText}!`,
                });
              }
            }
          }

          if (appliedQuantity > 0) {
            journalEntries.push({
              item: normalizedItemName,
              action: invUpdate.action === "add" ? "acquired" : "lost",
              quantity: appliedQuantity,
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
          // Sequential so each entry builds on the journal the previous one saved.
          for (const entry of journalEntries) {
            await recordJournalEntry({
              chatId: activeChatId,
              type: "item",
              data: {
                item: entry.item,
                action: entry.action,
                quantity: entry.quantity,
              },
            });
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
    [activeChatId, patchVisibleGameState, persistMetadata, recordJournalEntry, showInventoryNotifications],
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
