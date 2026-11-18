// Ending a scene: conclude (summary written back to the origin as a memory), discard (deleted, nothing written), and
// reopen. Behavior spec: docs/provenance/roleplay-scenes.md ("Ending").
import type { StorageGateway } from "../../../capabilities/storage";
import type { ChatMetadata } from "../../../contracts/types/chat";
import { characterExtensionsPatch } from "../../../entities/character-extensions-patch";
import {
  isRecord,
  nowIso,
  parseArray,
  parseRecord,
  readString,
  stringArray,
  type JsonRecord,
} from "../../../generation/runtime-records";
import { persistCompletedSceneStoryEpisode } from "../../../generation/story-consolidation-queue";
import { getEffectiveStoryConsolidationEnabled } from "../../../generation/story-projections";
import { userFacingError } from "../../../shared/user-facing-error";
import { sceneConnection, sceneConnectionDetails } from "./scene-calls";
import { SCENE_ALREADY_ACTIVE_REFUSAL } from "./scene-create";
import { sceneStepError } from "./scene-errors";
import { carriedSceneOptions, linkToRemember, releaseOriginFromScene, SCENE_PREVIOUS_LINK_KEY } from "./scene-origin";
import { deleteChatAndTranscript } from "./scene-removal";
import { loadParticipantRows, loadScenePersona, participantCards } from "./scene-sources";
import { sceneStatusOf } from "./scene-status";
import { summarizeScene } from "./scene-summary";
import { dayOf, sceneTitle } from "./scene-text";
import type { ConcludedScene, SceneCapabilities } from "./scene-types";

const SCENE_HISTORY_LIMIT = 20;
const CHARACTER_MEMORY_LIMIT = 100;
const NOT_A_SCENE = "Not a scene chat";

interface LoadedScene {
  scene: JsonRecord;
  metadata: JsonRecord;
  originChatId: string;
}

async function loadScene(storage: StorageGateway, sceneChatId: string): Promise<LoadedScene> {
  const scene = await storage.get<unknown>("chats", sceneChatId);
  if (!isRecord(scene)) throw userFacingError("This scene no longer exists.");
  const metadata = parseRecord(scene.metadata);
  const originChatId = readString(metadata.sceneOriginChatId).trim();
  if (!originChatId) throw userFacingError(NOT_A_SCENE);
  return { scene, metadata, originChatId };
}

async function loadOrigin(storage: StorageGateway, originChatId: string): Promise<JsonRecord> {
  const origin = await storage.get<unknown>("chats", originChatId);
  if (!isRecord(origin)) throw userFacingError("The chat this scene came from no longer exists.");
  return origin;
}

/** The origin's one return message for this scene: replaced when it exists, so a reopened scene never adds a second. */
async function writeReturnMessage(
  storage: StorageGateway,
  input: { originChatId: string; sceneChatId: string; sceneName: string; summary: string },
): Promise<void> {
  const content = `The scene "${sceneTitle(input.sceneName)}" concluded.\n\n${input.summary}`;
  const extra = { hiddenFromAI: true, hiddenFromAi: true, sceneChatId: input.sceneChatId };
  const candidates = await storage.listChatMessages<unknown>(input.originChatId, {
    role: "assistant",
    fields: ["id", "role", "extra"],
  });
  const existing = candidates
    .filter(isRecord)
    .find((message) => readString(parseRecord(message.extra).sceneChatId).trim() === input.sceneChatId);
  const existingId = readString(existing?.id).trim();
  if (existingId) {
    await storage.updateChatMessage(existingId, { content });
    await storage.patchChatMessageExtra(existingId, extra);
    return;
  }
  await storage.createChatMessage(input.originChatId, { role: "assistant", characterId: null, content, extra });
}

async function writeCharacterMemories(
  storage: StorageGateway,
  input: {
    characterIds: readonly string[];
    sceneChatId: string;
    originChatId: string;
    sceneName: string;
    summary: string;
    now: string;
  },
): Promise<void> {
  const title = sceneTitle(input.sceneName);
  const memory = {
    from: title,
    fromCharId: null,
    sceneChatId: input.sceneChatId,
    originChatId: input.originChatId,
    summary: `[Scene on ${dayOf(input.now)}: ${title}] ${input.summary}`,
    createdAt: input.now,
  };
  for (const characterId of input.characterIds) {
    const character = await storage.get<unknown>("characters", characterId);
    if (!isRecord(character)) continue;
    const extensions = parseRecord(parseRecord(character.data).extensions);
    const kept = parseArray(extensions.characterMemories)
      .filter(isRecord)
      .filter((entry) => readString(entry.sceneChatId).trim() !== input.sceneChatId);
    await storage.update(
      "characters",
      characterId,
      characterExtensionsPatch({ characterMemories: [...kept, memory].slice(-CHARACTER_MEMORY_LIMIT) }),
    );
  }
}

/**
 * Concludes a scene: summary, story episode (with Story Continuity on), the write-backs to the origin, then the scene
 * marked concluded. Any failure before that last step leaves the scene active, and a retry replaces what it wrote.
 */
export async function concludeRoleplayScene(
  capabilities: SceneCapabilities,
  input: { sceneChatId: string; connectionId?: string | null },
): Promise<ConcludedScene> {
  const { storage } = capabilities;
  const sceneChatId = input.sceneChatId.trim();
  const { scene, metadata, originChatId } = await loadScene(storage, sceneChatId);
  const origin = await loadOrigin(storage, originChatId);
  const storyContinuity = getEffectiveStoryConsolidationEnabled(
    readString(origin.mode || origin.chatMode),
    parseRecord(origin.metadata) as Partial<ChatMetadata>,
  );
  if (storyContinuity && !storage.createMemory) {
    throw userFacingError("Story Continuity is enabled, but canonical memory persistence is unavailable");
  }

  const messages = (await storage.listChatMessages<unknown>(sceneChatId)).filter(isRecord);
  const characterIds = stringArray(scene.characterIds);
  const sceneName = readString(scene.name).trim() || "Scene";
  const now = nowIso();
  const connection = sceneConnection(scene, input.connectionId);
  const [rows, persona] = await Promise.all([
    loadParticipantRows(storage, characterIds),
    loadScenePersona(storage, scene),
  ]);
  const { summary, sections } = await summarizeScene(capabilities, {
    connection,
    messages,
    details: {
      name: sceneName,
      date: dayOf(now),
      description: readString(metadata.sceneDescription).trim(),
      scenario: readString(metadata.sceneScenario).trim(),
      background: readString(metadata.sceneBackground).trim(),
      rating: readString(metadata.sceneRating).trim(),
      relationshipHistory: readString(metadata.sceneRelationshipHistory).trim(),
      originContext: readString(metadata.sceneConversationContext).trim(),
      cards: participantCards(rows),
      persona,
    },
  });

  if (storyContinuity) {
    try {
      const used = await sceneConnectionDetails(storage, connection);
      const episode = await persistCompletedSceneStoryEpisode(capabilities, {
        ownerChatId: originChatId,
        sceneChatId,
        messages,
        summary,
        sections,
        connectionId: used.connectionId,
        provider: used.provider,
        model: used.model,
        now,
      });
      if (!episode) throw userFacingError("The scene has no messages to save as a story episode.");
    } catch (error) {
      throw sceneStepError("Saving the scene as a story episode failed", error);
    }
  }

  await writeReturnMessage(storage, { originChatId, sceneChatId, sceneName, summary });
  const originMetadata = parseRecord((await loadOrigin(storage, originChatId)).metadata);
  const history = parseArray(originMetadata.roleplaySceneHistory)
    .filter(isRecord)
    .filter((entry) => readString(entry.sceneChatId).trim() !== sceneChatId);
  await storage.patchChatMetadata(originChatId, {
    roleplaySceneHistory: [...history, { sceneChatId, concludedAt: now, summary }].slice(-SCENE_HISTORY_LIMIT),
    lastRoleplaySceneSummary: summary,
    lastRoleplaySceneOptions: carriedSceneOptions(metadata),
  });
  await writeCharacterMemories(storage, { characterIds, sceneChatId, originChatId, sceneName, summary, now });

  await releaseOriginFromScene(storage, { originChatId, sceneChatId });
  await storage.patchChatMetadata(sceneChatId, { sceneStatus: "concluded" });
  await storage.update("chats", sceneChatId, { connectedChatId: null });
  return { summary, originChatId };
}

/** Discards a scene: nothing is written back except its options; the scene and its messages are deleted. */
export async function discardRoleplayScene(
  storage: StorageGateway,
  input: { sceneChatId: string },
): Promise<{ originChatId: string }> {
  const sceneChatId = input.sceneChatId.trim();
  const { metadata, originChatId } = await loadScene(storage, sceneChatId);
  await releaseOriginFromScene(storage, {
    originChatId,
    sceneChatId,
    metadata: { lastRoleplaySceneOptions: carriedSceneOptions(metadata) },
  });
  await deleteChatAndTranscript(storage, sceneChatId);
  return { originChatId };
}

/** Makes a concluded scene the origin's active scene again. Its earlier write-backs stay until it concludes again. */
export async function reopenRoleplayScene(
  storage: StorageGateway,
  input: { sceneChatId: string },
): Promise<{ originChatId: string }> {
  const sceneChatId = input.sceneChatId.trim();
  const { scene, originChatId } = await loadScene(storage, sceneChatId);
  if (sceneStatusOf(scene) === "active") return { originChatId };
  const origin = await loadOrigin(storage, originChatId);
  const activeSceneChatId = readString(parseRecord(origin.metadata).activeSceneChatId).trim();
  if (activeSceneChatId && activeSceneChatId !== sceneChatId) throw userFacingError(SCENE_ALREADY_ACTIVE_REFUSAL);

  await storage.patchChatMetadata(sceneChatId, { sceneStatus: "active" });
  await storage.update("chats", sceneChatId, { connectedChatId: originChatId });
  await storage.patchChatMetadata(originChatId, {
    activeSceneChatId: sceneChatId,
    sceneBusyCharIds: stringArray(scene.characterIds),
    [SCENE_PREVIOUS_LINK_KEY]: linkToRemember(origin, sceneChatId),
  });
  await storage.update("chats", originChatId, { connectedChatId: sceneChatId });
  return { originChatId };
}
