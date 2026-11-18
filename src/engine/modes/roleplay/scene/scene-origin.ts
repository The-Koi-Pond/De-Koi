// The origin chat's side of a scene: its pointers to the active scene, the link a scene borrows and gives back
// (decision 2), and the options carried between scenes.
import type { StorageGateway } from "../../../capabilities/storage";
import { isRecord, parseRecord, readString, stringArray, type JsonRecord } from "../../../generation/runtime-records";

/** Origin metadata: the chat the origin was linked to before a scene took its link over. */
export const SCENE_PREVIOUS_LINK_KEY = "scenePreviousConnectedChatId";

const CARRIED_OPTION_KEYS = [
  "agentOverrides",
  "enableAgents",
  "enableTools",
  "toolSelectionMode",
  "expressionAvatarsEnabled",
  "spriteSide",
] as const;

/** Chat modes a scene can branch off. Legacy visual novel chats count as Roleplay. */
export function sceneOriginKind(chat: JsonRecord): "conversation" | "roleplay" | null {
  const mode = readString(chat.mode || chat.chatMode).trim();
  if (mode === "conversation") return "conversation";
  if (mode === "roleplay" || mode === "visual_novel") return "roleplay";
  return null;
}

export function connectedChatIdOf(chat: JsonRecord): string | null {
  return readString(chat.connectedChatId).trim() || null;
}

/** The scene options a chat carries: agents, tools, expression avatars and sprite side. */
export function carriedSceneOptions(metadata: JsonRecord): JsonRecord {
  const options: JsonRecord = {};
  for (const key of CARRIED_OPTION_KEYS) {
    if (metadata[key] !== undefined) options[key] = metadata[key];
  }
  const agentIds = stringArray(metadata.activeAgentIds);
  if (agentIds.length > 0) options.activeAgentIds = agentIds;
  const toolIds = stringArray(metadata.activeToolIds);
  if (metadata.enableTools === false) {
    options.enableTools = false;
  } else if (toolIds.length > 0) {
    options.activeToolIds = toolIds;
    options.enableTools = true;
  }
  return options;
}

/** What a new scene starts with: the options the last scene left on the origin, else the origin's own. */
export function sceneOptionsForNewScene(originMetadata: JsonRecord): JsonRecord {
  const saved = originMetadata.lastRoleplaySceneOptions;
  const source = isRecord(saved) && Object.keys(saved).length > 0 ? saved : originMetadata;
  return carriedSceneOptions(source);
}

/** The origin's link worth remembering when a scene takes it over: anything but the scene itself. */
export function linkToRemember(origin: JsonRecord, sceneChatId: string): string | null {
  const current = connectedChatIdOf(origin);
  return current && current !== sceneChatId ? current : null;
}

/** The remembered link, when that chat still exists and still links back to the origin; else none. */
async function linkToGiveBack(storage: StorageGateway, origin: JsonRecord): Promise<string | null> {
  const remembered = readString(parseRecord(origin.metadata)[SCENE_PREVIOUS_LINK_KEY]).trim();
  if (!remembered) return null;
  const chat = await storage.get<unknown>("chats", remembered);
  return isRecord(chat) && connectedChatIdOf(chat) === readString(origin.id).trim() ? remembered : null;
}

/**
 * Lets the origin go of a scene that ends, is discarded or converted: clears its pointers to that scene and gives its
 * link back. Only what still points at this scene changes, so another scene's pointers are left alone.
 */
export async function releaseOriginFromScene(
  storage: StorageGateway,
  input: { originChatId: string; sceneChatId: string; metadata?: JsonRecord },
): Promise<void> {
  const origin = await storage.get<unknown>("chats", input.originChatId);
  if (!isRecord(origin)) return;
  const metadata = parseRecord(origin.metadata);
  const patch: JsonRecord = { ...input.metadata };
  const pointsAtScene = readString(metadata.activeSceneChatId).trim() === input.sceneChatId;
  const linkedToScene = connectedChatIdOf(origin) === input.sceneChatId;
  if (pointsAtScene) {
    patch.activeSceneChatId = null;
    patch.sceneBusyCharIds = null;
  }
  if (pointsAtScene || linkedToScene) patch[SCENE_PREVIOUS_LINK_KEY] = null;
  if (linkedToScene) {
    await storage.update("chats", input.originChatId, { connectedChatId: await linkToGiveBack(storage, origin) });
  }
  if (Object.keys(patch).length > 0) await storage.patchChatMetadata(input.originChatId, patch);
}
