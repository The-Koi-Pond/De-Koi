// Forking: a scene becomes a standalone Roleplay chat. Clone keeps the scene (optionally only up to one message);
// convert copies all of it and then removes the scene, writing nothing back. Behavior spec:
// docs/provenance/roleplay-scenes.md ("Forking").
import type { StorageGateway } from "../../../capabilities/storage";
import { isRecord, parseRecord, readString, stringArray, type JsonRecord } from "../../../generation/runtime-records";
import {
  copyTrackerSnapshotsForRebasedMessages,
  type TrackerSnapshotMessageRebase,
} from "../../../generation/tracker-snapshots";
import { userFacingError } from "../../../shared/user-facing-error";
import { undoThenThrow } from "./scene-errors";
import { releaseOriginFromScene } from "./scene-origin";
import { deleteChatAndTranscript } from "./scene-removal";
import type { ForkedScene, SceneForkMode } from "./scene-types";

const CONTINUITY_HEADING = "Hidden continuity carried from the original scene branch.";
const COPY_SKIPPED_FIELDS = ["id", "chatId", "updatedAt", "swipeCount", "swipePreviews"] as const;

function isSceneOnlyKey(key: string): boolean {
  return key.startsWith("scene") || key === "activeSceneChatId" || key === "sceneBusyCharIds";
}

function oldestFirst(a: JsonRecord, b: JsonRecord): number {
  const byTime = readString(a.createdAt).localeCompare(readString(b.createdAt));
  return byTime !== 0 ? byTime : readString(a.id).localeCompare(readString(b.id));
}

/** The scene's carried context as one hidden narrator note, or null when the scene has none. */
function continuityNote(metadata: JsonRecord): string | null {
  const parts = [
    ["Conversation before the scene", metadata.sceneConversationContext],
    ["Relationship history", metadata.sceneRelationshipHistory],
    ["Scene premise", metadata.sceneScenario],
  ]
    .map(([heading, value]) => [heading, readString(value).trim()] as const)
    .filter(([, value]) => value.length > 0)
    .map(([heading, value]) => `${heading}:\n${value}`);
  return parts.length > 0 ? [CONTINUITY_HEADING, ...parts].join("\n\n") : null;
}

function justBefore(iso: string): string | null {
  const time = Date.parse(iso);
  return Number.isFinite(time) ? new Date(time - 1).toISOString() : null;
}

function messageCopy(message: JsonRecord): JsonRecord {
  const copy: JsonRecord = { ...message };
  for (const field of COPY_SKIPPED_FIELDS) delete copy[field];
  return copy;
}

/** Copies a scene into a new Roleplay chat; convert then removes the scene. */
export async function forkRoleplayScene(
  storage: StorageGateway,
  input: { sceneChatId: string; mode: SceneForkMode; upToMessageId?: string | null },
): Promise<ForkedScene> {
  const sceneChatId = input.sceneChatId.trim();
  const upToMessageId = readString(input.upToMessageId).trim();
  if (input.mode === "convert" && upToMessageId) throw userFacingError("Convert cannot be limited to a message");
  const scene = await storage.get<unknown>("chats", sceneChatId);
  if (!isRecord(scene)) throw userFacingError("This scene no longer exists.");
  const sceneMetadata = parseRecord(scene.metadata);
  const originChatId = readString(sceneMetadata.sceneOriginChatId).trim();
  if (!originChatId) throw userFacingError("Not a scene chat");

  const messages = (await storage.listChatMessages<unknown>(sceneChatId)).filter(isRecord).sort(oldestFirst);
  let kept = messages;
  if (upToMessageId) {
    const index = messages.findIndex((message) => readString(message.id).trim() === upToMessageId);
    if (index < 0) throw userFacingError("Message is not part of this scene");
    kept = messages.slice(0, index + 1);
  }

  const chatName = `${readString(scene.name).trim() || "Scene"} ${input.mode === "convert" ? "Converted" : "Clone"}`;
  const created = await storage.create<JsonRecord>("chats", {
    name: chatName,
    mode: "roleplay",
    characterIds: stringArray(scene.characterIds),
    groupId: readString(scene.groupId).trim() || null,
    folderId: readString(scene.folderId).trim() || null,
    personaId: readString(scene.personaId).trim() || null,
    promptPresetId: readString(scene.promptPresetId).trim() || null,
    connectionId: readString(scene.connectionId).trim() || null,
    activeLorebookIds: stringArray(scene.activeLorebookIds),
    connectedChatId: null,
    metadata: Object.fromEntries(Object.entries(sceneMetadata).filter(([key]) => !isSceneOnlyKey(key))),
  });
  const chatId = readString(created.id).trim();
  if (!chatId) throw new Error("The new roleplay chat was saved without an id.");

  try {
    const note = continuityNote(sceneMetadata);
    if (note) {
      const noteTime = kept[0] ? justBefore(readString(kept[0].createdAt)) : null;
      await storage.createChatMessage(chatId, {
        role: "narrator",
        characterId: null,
        content: note,
        extra: { hiddenFromUser: true, isSceneContinuity: true },
        ...(noteTime ? { createdAt: noteTime } : {}),
      });
    }
    const rebased: TrackerSnapshotMessageRebase[] = [];
    for (const message of kept) {
      const saved = await storage.createChatMessage<unknown>(chatId, messageCopy(message));
      const targetMessageId = isRecord(saved) ? readString(saved.id).trim() : "";
      if (!targetMessageId) continue;
      rebased.push({
        sourceMessageId: readString(message.id).trim(),
        targetMessageId,
        role: message.role,
        activeSwipeIndex: message.activeSwipeIndex,
        swipeCount: Array.isArray(message.swipes) ? message.swipes.length : message.swipeCount,
      });
    }
    const trackerState = await copyTrackerSnapshotsForRebasedMessages(storage, sceneChatId, chatId, rebased);
    if (trackerState) await storage.update("chats", chatId, { gameState: trackerState });
  } catch (error) {
    // A half-copied chat is worse than none.
    await undoThenThrow(error, () => deleteChatAndTranscript(storage, chatId));
  }

  if (input.mode === "convert") {
    await releaseOriginFromScene(storage, { originChatId, sceneChatId });
    await deleteChatAndTranscript(storage, sceneChatId);
  }
  return { chatId, chatName: readString(created.name).trim() || chatName, mode: input.mode, originChatId };
}
