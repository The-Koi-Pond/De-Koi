import * as g from "./game-api-support";
import {
  RESTORED_CHECKPOINT_ANCHOR_META_KEY,
  RESTORED_CHECKPOINT_LEGACY_META_KEY,
  createGameCheckpoint,
} from "./game-api-checkpoint-helpers";

export async function listCheckpoints(chatId: string) {
  const all = await g.storageApi.list<g.GameCheckpoint>("game-checkpoints");
  return all.filter((checkpoint) => (checkpoint as { chatId?: string }).chatId === chatId);
}

export async function createCheckpoint(data: { chatId: string; label: string; triggerType: string }) {
  return createGameCheckpoint(data);
}

export async function loadCheckpoint(data: { chatId: string; checkpointId: string }) {
  const checkpoint = await g.storageApi.get<{
    id: string;
    chatId?: string;
    label?: string;
    snapshotId?: string;
    messageId?: string | null;
  }>("game-checkpoints", data.checkpointId);
  if (!checkpoint) throw new Error("Checkpoint was not found.");
  if (checkpoint.chatId !== data.chatId) throw new Error("Checkpoint does not belong to this chat.");
  if (!checkpoint.snapshotId) throw new Error("Checkpoint is missing its state snapshot.");
  const snapshot = await g.storageApi.get<{
    id: string;
    chatId?: string;
    gameState?: unknown;
    metadata?: Record<string, unknown>;
  }>("game-state-snapshots", checkpoint.snapshotId);
  if (!snapshot) throw new Error("Checkpoint snapshot was not found.");
  if (snapshot.chatId !== data.chatId) throw new Error("Checkpoint snapshot does not belong to this chat.");
  const previousChat = await g.getChat(data.chatId);
  const previousGameState = (previousChat as { gameState?: unknown }).gameState ?? null;
  const previousMetadata = g.chatMeta(previousChat);
  const checkpointAnchor = typeof checkpoint.messageId === "string" ? checkpoint.messageId.trim() : "";
  const restoredGameState = snapshot.gameState ?? {};
  const restoredMetadata = {
    ...(snapshot.metadata ?? {}),
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
  const snapshot = await g.storageApi.get<{
    id: string;
    chatId?: string;
    gameState?: unknown;
    metadata?: Record<string, unknown>;
  }>("game-state-snapshots", checkpoint.snapshotId);
  if (!snapshot) throw new Error("Checkpoint snapshot was not found.");
  if (snapshot.chatId !== data.chatId) throw new Error("Checkpoint snapshot does not belong to this chat.");
  const branch = await g.chatCommandApi.branch<g.Chat>(data.chatId, messageId);
  try {
    return await g.patchChat(branch.id, {
      gameState: snapshot.gameState ?? {},
      metadata: {
        ...(snapshot.metadata ?? {}),
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
