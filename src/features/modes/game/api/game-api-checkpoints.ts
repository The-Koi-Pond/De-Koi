import * as g from "./game-api-support";
import {
  CHECKPOINT_SNAPSHOT_KIND,
  RESTORED_CHECKPOINT_ANCHOR_META_KEY,
  RESTORED_CHECKPOINT_LEGACY_META_KEY,
  createGameCheckpoint,
} from "./game-api-checkpoint-helpers";

type CheckpointSnapshot = Record<string, unknown> & {
  id: string;
  chatId?: string;
  gameState?: unknown;
  metadata?: Record<string, unknown> | null;
};

const TRACKER_SNAPSHOT_STATE_KEYS = [
  "id",
  "kind",
  "chatId",
  "messageId",
  "swipeIndex",
  "date",
  "time",
  "location",
  "weather",
  "temperature",
  "presentCharacters",
  "recentEvents",
  "playerStats",
  "personaStats",
  "manualOverrides",
  "committed",
  "createdAt",
] as const;

const TRACKER_SNAPSHOT_SHAPE_KEYS = [
  "messageId",
  "swipeIndex",
  "date",
  "time",
  "location",
  "weather",
  "temperature",
  "presentCharacters",
  "recentEvents",
  "playerStats",
  "personaStats",
  "manualOverrides",
  "committed",
] as const;

const MIRRORED_GAME_METADATA_KEYS = ["gameWeather", "gameTime", "gameTimeFormatted"] as const;

function hasOwnField(record: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, field);
}

function hasCheckpointPayload(snapshot: CheckpointSnapshot | null): boolean {
  return !!snapshot && snapshot.kind === CHECKPOINT_SNAPSHOT_KIND && hasOwnField(snapshot, "gameState");
}

function isTrackerSnapshot(snapshot: CheckpointSnapshot | null): boolean {
  if (!snapshot) return false;
  if (snapshot.kind === "tracker") return true;
  if (hasCheckpointPayload(snapshot)) return false;
  return TRACKER_SNAPSHOT_SHAPE_KEYS.some((key) => hasOwnField(snapshot, key));
}

function trackerSnapshotState(snapshot: CheckpointSnapshot): Record<string, unknown> {
  const state: Record<string, unknown> = {};
  for (const key of TRACKER_SNAPSHOT_STATE_KEYS) {
    if (hasOwnField(snapshot, key)) state[key] = snapshot[key];
  }
  return state;
}

function trackerSnapshotMetadata(
  snapshot: CheckpointSnapshot,
  fallbackMetadata: Record<string, unknown>,
): Record<string, unknown> {
  const metadata = {
    ...fallbackMetadata,
    ...g.asRecord(snapshot.metadata),
  };
  for (const key of MIRRORED_GAME_METADATA_KEYS) {
    delete metadata[key];
  }
  const weather = g.readTrimmed(snapshot.weather);
  const time = g.readTrimmed(snapshot.time);
  if (weather) metadata.gameWeather = { type: weather };
  if (time) metadata.gameTimeFormatted = time;
  return metadata;
}

function checkpointSnapshotRestorePayload(
  snapshot: CheckpointSnapshot,
  fallbackMetadata: Record<string, unknown> = {},
) {
  if (isTrackerSnapshot(snapshot)) {
    return {
      gameState: trackerSnapshotState(snapshot),
      metadata: trackerSnapshotMetadata(snapshot, fallbackMetadata),
    };
  }
  if (hasOwnField(snapshot, "gameState")) {
    return {
      gameState: snapshot.gameState ?? {},
      metadata: g.asRecord(snapshot.metadata ?? fallbackMetadata),
    };
  }
  return {
    gameState: trackerSnapshotState(snapshot),
    metadata: trackerSnapshotMetadata(snapshot, fallbackMetadata),
  };
}

function isOwnedCheckpointSnapshot(snapshot: CheckpointSnapshot | null): boolean {
  return hasCheckpointPayload(snapshot);
}

export async function listCheckpoints(chatId: string) {
  return g.storageApi.list<g.GameCheckpoint>("game-checkpoints", {
    filters: { chatId },
    orderBy: "createdAt",
    descending: true,
  });
}

export async function createCheckpoint(data: {
  chatId: string;
  label: string;
  triggerType: string;
  sourceMessageId?: string | null;
}) {
  return createGameCheckpoint(data);
}

export async function loadCheckpoint(data: { chatId: string; checkpointId: string }) {
  const checkpoint = await g.storageApi.get<{
    id: string;
    chatId?: string;
    label?: string;
    snapshotId?: string;
    messageId?: string | null;
    gameState?: string | null;
  }>("game-checkpoints", data.checkpointId);
  if (!checkpoint) throw new Error("Checkpoint was not found.");
  if (checkpoint.chatId !== data.chatId) throw new Error("Checkpoint does not belong to this chat.");
  if (!checkpoint.snapshotId) throw new Error("Checkpoint is missing its state snapshot.");
  const snapshot = await g.storageApi.get<CheckpointSnapshot>("game-state-snapshots", checkpoint.snapshotId);
  if (!snapshot) throw new Error("Checkpoint snapshot was not found.");
  if (snapshot.chatId !== data.chatId) throw new Error("Checkpoint snapshot does not belong to this chat.");
  const previousChat = await g.getChat(data.chatId);
  const previousGameState = (previousChat as { gameState?: unknown }).gameState ?? null;
  const previousMetadata = g.chatMeta(previousChat);
  const checkpointAnchor = typeof checkpoint.messageId === "string" ? checkpoint.messageId.trim() : "";
  const snapshotPayload = checkpointSnapshotRestorePayload(snapshot, previousMetadata);
  const restoredGameState = snapshotPayload.gameState;
  const restoredActiveState = g.readTrimmed(checkpoint.gameState);
  const restoredMetadata = {
    ...snapshotPayload.metadata,
    ...(restoredActiveState ? { gameActiveState: restoredActiveState } : {}),
    [RESTORED_CHECKPOINT_ANCHOR_META_KEY]: checkpointAnchor || null,
    [RESTORED_CHECKPOINT_LEGACY_META_KEY]: !checkpointAnchor,
  };
  await g.patchChat(data.chatId, {
    gameState: restoredGameState,
    metadata: restoredMetadata,
  });
  let message: g.ChatMessage;
  try {
    message = await g.createChatMessage(data.chatId, {
      role: "system",
      characterId: null,
      content: `[Checkpoint restored: ${checkpoint.label || "Checkpoint"}]`,
    });
  } catch (error) {
    try {
      await g.patchChat(data.chatId, {
        gameState: previousGameState,
        metadata: previousMetadata,
      });
    } catch (rollbackError) {
      const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      throw new Error(`Checkpoint restore marker failed and rollback failed: ${rollbackMessage}`);
    }
    throw error;
  }
  return { ok: true, messageId: message.id, gameState: restoredGameState, metadata: restoredMetadata };
}

export async function branchFromCheckpoint(data: { chatId: string; checkpointId: string }): Promise<g.Chat> {
  const checkpoint = await g.storageApi.get<{
    id: string;
    chatId?: string;
    label?: string;
    snapshotId?: string;
    messageId?: string | null;
    gameState?: string | null;
  }>("game-checkpoints", data.checkpointId);
  if (!checkpoint) throw new Error("Checkpoint was not found.");
  if (checkpoint.chatId !== data.chatId) throw new Error("Checkpoint does not belong to this chat.");
  if (!checkpoint.snapshotId) throw new Error("Checkpoint is missing its state snapshot.");
  const messageId = typeof checkpoint.messageId === "string" ? checkpoint.messageId.trim() : "";
  if (!messageId) {
    throw new Error(
      "This checkpoint was saved before branch anchors were recorded. Load it, save a new checkpoint, then branch from that checkpoint.",
    );
  }
  const snapshot = await g.storageApi.get<CheckpointSnapshot>("game-state-snapshots", checkpoint.snapshotId);
  if (!snapshot) throw new Error("Checkpoint snapshot was not found.");
  if (snapshot.chatId !== data.chatId) throw new Error("Checkpoint snapshot does not belong to this chat.");
  const branch = await g.chatCommandApi.branch<g.Chat>(data.chatId, messageId);
  try {
    const snapshotPayload = checkpointSnapshotRestorePayload(snapshot, g.chatMeta(branch));
    const restoredActiveState = g.readTrimmed(checkpoint.gameState);
    return await g.patchChat(branch.id, {
      gameState: snapshotPayload.gameState,
      metadata: {
        ...snapshotPayload.metadata,
        ...(restoredActiveState ? { gameActiveState: restoredActiveState } : {}),
        branchedFromCheckpointId: checkpoint.id,
        branchedFromCheckpointLabel: checkpoint.label ?? "Checkpoint",
        [RESTORED_CHECKPOINT_ANCHOR_META_KEY]: null,
        [RESTORED_CHECKPOINT_LEGACY_META_KEY]: null,
      },
    });
  } catch (error) {
    try {
      await g.storageApi.delete("chats", branch.id);
    } catch (cleanupError) {
      const restoreMessage = error instanceof Error ? error.message : String(error);
      const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      throw new Error(`Checkpoint branch restore failed: ${restoreMessage}; branch cleanup failed: ${cleanupMessage}`);
    }
    throw error;
  }
}

export async function deleteCheckpoint(id: string) {
  const checkpoint = await g.storageApi.get<{ snapshotId?: string | null }>("game-checkpoints", id);
  const result = await g.storageApi.delete("game-checkpoints", id);
  if (!result.deleted) return { ok: false };
  const snapshotId = g.readTrimmed(checkpoint?.snapshotId);
  if (!snapshotId) return { ok: true };
  let snapshot: CheckpointSnapshot | null = null;
  try {
    snapshot = await g.storageApi.get<CheckpointSnapshot>("game-state-snapshots", snapshotId);
  } catch (error) {
    return {
      ok: true,
      snapshotCleanupWarning: {
        snapshotId,
        message: error instanceof Error ? error.message : "Checkpoint snapshot cleanup failed.",
      },
    };
  }
  if (!isOwnedCheckpointSnapshot(snapshot)) return { ok: true };
  try {
    await g.storageApi.delete("game-state-snapshots", snapshotId);
  } catch (error) {
    return {
      ok: true,
      snapshotCleanupWarning: {
        snapshotId,
        message: error instanceof Error ? error.message : "Checkpoint snapshot cleanup failed.",
      },
    };
  }
  return { ok: true };
}
