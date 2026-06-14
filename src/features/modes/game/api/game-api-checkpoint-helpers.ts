import * as g from "./game-api-support";

export const RESTORED_CHECKPOINT_ANCHOR_META_KEY = "gameRestoredCheckpointAnchorMessageId";

export const RESTORED_CHECKPOINT_LEGACY_META_KEY = "gameRestoredCheckpointLegacyAnchorMissing";

export const CHECKPOINT_SNAPSHOT_KIND = "checkpoint";

function latestMessage(messages: g.ChatMessage[]): g.ChatMessage | null {
  let fallback: g.ChatMessage | null = null;
  let latestTimed: { message: g.ChatMessage; createdAt: string } | null = null;
  for (const message of messages) {
    const id = message.id;
    if (typeof id !== "string" || !id.trim()) continue;
    fallback = message;
    const createdAt = typeof message.createdAt === "string" ? message.createdAt : "";
    if (!createdAt) continue;
    if (!latestTimed || createdAt >= latestTimed.createdAt) {
      latestTimed = { message, createdAt };
    }
  }
  return latestTimed?.message ?? fallback;
}

function messageId(message: g.ChatMessage | null | undefined): string {
  const id = message?.id;
  return typeof id === "string" ? id.trim() : "";
}

function isCheckpointRestoreMessage(message: g.ChatMessage | null | undefined): boolean {
  return message?.role === "system" && /^\[Checkpoint restored:/i.test(String(message.content ?? "").trimStart());
}

function checkpointAnchorFromMeta(meta: Record<string, unknown>, latest: g.ChatMessage | null): string {
  if (!isCheckpointRestoreMessage(latest)) return messageId(latest);
  const restoredAnchor = meta[RESTORED_CHECKPOINT_ANCHOR_META_KEY];
  if (typeof restoredAnchor === "string" && restoredAnchor.trim()) return restoredAnchor.trim();
  if (meta[RESTORED_CHECKPOINT_LEGACY_META_KEY] === true) return "";
  return messageId(latest);
}

function checkpointSnapshotMetadata(meta: Record<string, unknown>): Record<string, unknown> {
  const snapshotMeta = { ...meta };
  delete snapshotMeta[RESTORED_CHECKPOINT_ANCHOR_META_KEY];
  delete snapshotMeta[RESTORED_CHECKPOINT_LEGACY_META_KEY];
  return snapshotMeta;
}

function checkpointSummaryValue(value: unknown): string | null {
  return g.readTrimmed(value) || null;
}

function checkpointWeatherSummary(gameState: Record<string, unknown>, meta: Record<string, unknown>): string | null {
  const metaWeather = g.asRecord(meta.gameWeather);
  const metadataWeather = checkpointSummaryValue(metaWeather.type) ?? checkpointSummaryValue(meta.gameWeather);
  return metadataWeather ?? checkpointSummaryValue(gameState.weather);
}

function checkpointTimeSummary(gameState: Record<string, unknown>, meta: Record<string, unknown>): string | null {
  return checkpointSummaryValue(meta.gameTimeFormatted) ?? checkpointSummaryValue(gameState.time);
}

export async function createGameCheckpoint(data: {
  chatId: string;
  label: string;
  triggerType: string;
}): Promise<{ id: string }> {
  const chat = await g.getChat(data.chatId);
  const meta = g.chatMeta(chat);
  const gameState = g.asRecord((chat as { gameState?: unknown }).gameState);
  const messages = await g.listMessages(data.chatId);
  const messageId = checkpointAnchorFromMeta(meta, latestMessage(messages));
  const snapshot = await g.storageApi.create<{ id: string }>("game-state-snapshots", {
    kind: CHECKPOINT_SNAPSHOT_KIND,
    chatId: data.chatId,
    messageId: messageId || null,
    gameState,
    metadata: checkpointSnapshotMetadata(meta),
  });
  let record: { id: string };
  try {
    record = await g.storageApi.create<{ id: string }>("game-checkpoints", {
      chatId: data.chatId,
      snapshotId: snapshot.id,
      messageId,
      label: data.label || "Checkpoint",
      triggerType: data.triggerType || "manual",
      location: checkpointSummaryValue(gameState.location),
      gameState: null,
      weather: checkpointWeatherSummary(gameState, meta),
      timeOfDay: checkpointTimeSummary(gameState, meta),
      turnNumber: null,
    });
  } catch (error) {
    try {
      await g.storageApi.delete("game-state-snapshots", snapshot.id);
    } catch (cleanupError) {
      const createMessage = error instanceof Error ? error.message : String(error);
      const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      throw new Error(
        `Checkpoint creation failed: ${createMessage}; snapshot ${snapshot.id} cleanup failed: ${cleanupMessage}`,
      );
    }
    throw error;
  }
  return { id: record.id };
}

export async function createAutomaticGameCheckpoint(data: {
  chatId: string;
  label: string;
  triggerType: string;
}): Promise<g.GameCheckpointWarning | null> {
  try {
    await createGameCheckpoint(data);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Automatic checkpoint failed";
    console.warn("[game] Automatic checkpoint failed", {
      chatId: data.chatId,
      triggerType: data.triggerType,
      error,
    });
    return {
      chatId: data.chatId,
      triggerType: data.triggerType,
      label: data.label || "Checkpoint",
      message,
    };
  }
}
