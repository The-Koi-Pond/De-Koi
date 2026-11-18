// Creating: a planned scene becomes a Roleplay chat linked to its origin, and the origin points at it. Anything that
// fails once the scene chat exists removes it again. Behavior spec: docs/provenance/roleplay-scenes.md ("Creating").
import type { StorageGateway } from "../../../capabilities/storage";
import { defaultBackgroundAgentIdsForNewChat } from "../../../contracts/constants/chat-modes";
import { isRecord, parseRecord, readString, stringArray, type JsonRecord } from "../../../generation/runtime-records";
import { chatSpotifySourceSetting, MUSIC_SPOTIFY_SOURCE_KEY } from "../../../shared/music/chat-music";
import { userFacingError } from "../../../shared/user-facing-error";
import {
  connectedChatIdOf,
  linkToRemember,
  SCENE_PREVIOUS_LINK_KEY,
  sceneOptionsForNewScene,
  sceneOriginKind,
} from "./scene-origin";
import { SCENE_GUIDELINES } from "./scene-prompts";
import { undoThenThrow } from "./scene-errors";
import { deleteChatAndTranscript } from "./scene-removal";
import { buildOriginContext } from "./scene-sources";
import { isActiveSceneChat, SCENE_INSIDE_SCENE_REFUSAL } from "./scene-status";
import type { CreatedScene, CreateSceneRequest } from "./scene-types";
import { resolveSceneUniversalPreset } from "./universal-preset";

export const SCENE_ALREADY_ACTIVE_REFUSAL =
  "This conversation already has an active scene. Conclude or discard that scene first.";
const SCENE_CREATE_IN_PROGRESS_REFUSAL =
  "A scene is already being created for this conversation. Wait for it to finish.";
const DEFAULT_SCENE_DESCRIPTION = "A new scene begins.";
const DEFAULT_OPENING_BEAT = "The scene begins.";

// Creates in progress, per storage runtime, by origin chat id.
const creatingByStorage = new WeakMap<StorageGateway, Set<string>>();

function creatingFor(storage: StorageGateway): Set<string> {
  let origins = creatingByStorage.get(storage);
  if (!origins) {
    origins = new Set();
    creatingByStorage.set(storage, origins);
  }
  return origins;
}

/** Creates the scene chat for a plan. One create per origin at a time, and one active scene per origin. */
export async function createRoleplayScene(storage: StorageGateway, request: CreateSceneRequest): Promise<CreatedScene> {
  const originChatId = request.originChatId.trim();
  const inProgress = creatingFor(storage);
  if (inProgress.has(originChatId)) throw userFacingError(SCENE_CREATE_IN_PROGRESS_REFUSAL);
  inProgress.add(originChatId);
  try {
    return await createScene(storage, request, originChatId);
  } finally {
    inProgress.delete(originChatId);
  }
}

function uniqueIds(...lists: unknown[]): string[] {
  return Array.from(new Set(lists.flatMap((list) => stringArray(list))));
}

async function createScene(
  storage: StorageGateway,
  request: CreateSceneRequest,
  originChatId: string,
): Promise<CreatedScene> {
  const origin = await storage.get<unknown>("chats", originChatId);
  if (!isRecord(origin)) throw userFacingError("The chat this scene would start from no longer exists.");
  const originMetadata = parseRecord(origin.metadata);
  if (readString(originMetadata.activeSceneChatId).trim()) throw userFacingError(SCENE_ALREADY_ACTIVE_REFUSAL);
  const originKind = sceneOriginKind(origin);
  if (!originKind) throw userFacingError("A scene can only start from a Conversation or Roleplay chat.");
  if (isActiveSceneChat(origin)) throw userFacingError(SCENE_INSIDE_SCENE_REFUSAL);

  const { plan } = request;
  const characterIds = plan.characterIds.length > 0 ? [...plan.characterIds] : stringArray(origin.characterIds);
  const sceneConversationContext = await buildOriginContext(storage, originChatId);
  const preset = await resolveSceneUniversalPreset(storage, { plan, sceneConversationContext });
  const lorebookIds = uniqueIds(originMetadata.activeLorebookIds, origin.activeLorebookIds);
  const musicSource = chatSpotifySourceSetting(originMetadata);
  const description = plan.description.trim() || DEFAULT_SCENE_DESCRIPTION;

  const metadata: JsonRecord = {
    sceneOriginChatId: originChatId,
    sceneInitiatorCharId: request.initiatorCharId ?? null,
    sceneDescription: description,
    sceneScenario: plan.scenario,
    sceneBackground: null,
    sceneSystemPrompt: [plan.systemPrompt.trim(), SCENE_GUIDELINES].filter(Boolean).join("\n\n"),
    sceneRelationshipHistory: plan.relationshipHistory,
    sceneConversationContext,
    sceneRating: plan.rating,
    sceneStatus: "active",
    enableMemoryRecall: true,
    enableAgents: true,
    activeAgentIds: defaultBackgroundAgentIdsForNewChat("roleplay"),
    activeLorebookIds: lorebookIds,
    ...sceneOptionsForNewScene(originMetadata),
    ...(musicSource ? { [MUSIC_SPOTIFY_SOURCE_KEY]: musicSource } : {}),
    ...(preset.presetId
      ? {
          sceneUniversalPresetId: preset.presetId,
          sceneUniversalPresetChoiceHints: preset.choiceHints,
          presetChoices: preset.presetChoices,
        }
      : {}),
  };

  const created = await storage.create<JsonRecord>("chats", {
    name: plan.name,
    mode: "roleplay",
    characterIds,
    groupId: readString(origin.groupId).trim() || null,
    personaId: readString(origin.personaId).trim() || null,
    // A Conversation's folder holds Conversation chats only, so a scene from one starts unfiled.
    folderId: originKind === "roleplay" ? readString(origin.folderId).trim() || null : null,
    connectionId: readString(request.connectionId).trim() || readString(origin.connectionId).trim() || null,
    promptPresetId: preset.presetId ?? (readString(origin.promptPresetId).trim() || null),
    activeLorebookIds: lorebookIds,
    connectedChatId: originChatId,
    metadata,
  });
  const sceneChatId = readString(created.id).trim();
  if (!sceneChatId) throw new Error("The scene chat was saved without an id.");

  const originBefore = {
    connectedChatId: connectedChatIdOf(origin),
    metadata: {
      activeSceneChatId: originMetadata.activeSceneChatId ?? null,
      sceneBusyCharIds: originMetadata.sceneBusyCharIds ?? null,
      [SCENE_PREVIOUS_LINK_KEY]: originMetadata[SCENE_PREVIOUS_LINK_KEY] ?? null,
    },
  };
  try {
    await storage.patchChatMetadata(originChatId, {
      activeSceneChatId: sceneChatId,
      sceneBusyCharIds: characterIds,
      [SCENE_PREVIOUS_LINK_KEY]: linkToRemember(origin, sceneChatId),
    });
    await storage.update("chats", originChatId, { connectedChatId: sceneChatId });
    if (request.openingMode === "planned") {
      await storage.createChatMessage(sceneChatId, {
        role: "assistant",
        characterId: request.initiatorCharId || characterIds[0] || null,
        content: `${description}\n\n${plan.firstMessage.trim() || DEFAULT_OPENING_BEAT}`,
      });
    }
  } catch (error) {
    await undoThenThrow(error, async () => {
      await deleteChatAndTranscript(storage, sceneChatId);
      await storage.patchChatMetadata(originChatId, originBefore.metadata);
      await storage.update("chats", originChatId, { connectedChatId: originBefore.connectedChatId });
    });
  }

  return {
    chatId: sceneChatId,
    chatName: readString(created.name).trim() || plan.name,
    description,
    background: null,
  };
}
