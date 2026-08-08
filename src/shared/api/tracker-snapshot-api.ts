import type { GameState } from "../../engine/contracts/types/game-state";
import type { TrackerSnapshotSelectionQuery } from "../../engine/capabilities/storage";
import { invokeTauri } from "./tauri-client";

export interface TrackerSnapshotTarget {
  /** Empty string is the bootstrap tracker target used before the first assistant message exists. */
  messageId: string;
  swipeIndex?: number;
}

export type TrackerSnapshot = GameState & {
  kind: "tracker";
  updatedAt?: string;
};

export type TrackerSnapshotInput = Partial<GameState> & TrackerSnapshotTarget;

// Mode-neutral storage bridge only. Roleplay/game rules belong in their feature-owned tracker APIs.
export const trackerSnapshotApi = {
  latest(chatId: string): Promise<TrackerSnapshot | null> {
    return invokeTauri<TrackerSnapshot | null>("tracker_snapshot_latest", { chatId });
  },

  get(chatId: string, target: TrackerSnapshotTarget): Promise<TrackerSnapshot | null> {
    return invokeTauri<TrackerSnapshot | null>("tracker_snapshot_get", {
      chatId,
      messageId: target.messageId,
      swipeIndex: target.swipeIndex ?? 0,
    });
  },

  select(chatId: string, query: TrackerSnapshotSelectionQuery): Promise<TrackerSnapshot | null> {
    return invokeTauri<TrackerSnapshot | null>("tracker_snapshot_select", { chatId, query });
  },

  save(chatId: string, snapshot: TrackerSnapshotInput): Promise<TrackerSnapshot> {
    return invokeTauri<TrackerSnapshot>("tracker_snapshot_save", {
      chatId,
      snapshot,
    });
  },
};
