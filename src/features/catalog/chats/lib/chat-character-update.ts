import { deriveChatTitle } from "../../../../engine/entities/chat-title";
import { normalizeChatCharacterIds } from "../../../../shared/lib/chat-display";

export type CharacterMembershipChatUpdate = {
  name?: string;
  mode?: string;
  connectionId?: string | null;
  promptPresetId?: string | null;
  personaId?: string | null;
  characterIds?: string[];
};

type CharacterTitleChatSnapshot = {
  mode?: unknown;
  name?: unknown;
  characterIds?: unknown;
};

/**
 * Membership changes retitle a chat only while its name is still automatic: blank, or the
 * title derived from its current characters (including fallbacks like "New Conversation").
 * A name the user typed survives adding or removing characters, and a title is never derived
 * from a partial roster: if any character name fails to load, the current name stays.
 */
export async function completeCharacterTitleUpdate<T extends CharacterMembershipChatUpdate>(
  update: T,
  currentChatRecord: object | null | undefined,
  loadCharacterName: (id: string) => Promise<string | null>,
): Promise<T> {
  if (!("characterIds" in update) || "name" in update || !update.characterIds) return update;

  const currentChat = currentChatRecord as CharacterTitleChatSnapshot | null | undefined;
  const mode = update.mode ?? (typeof currentChat?.mode === "string" ? currentChat.mode : null);
  if (!(await hasAutomaticTitle(currentChat, mode, loadCharacterName))) return update;

  const names = await loadAllCharacterNames(update.characterIds, loadCharacterName);
  if (!names) return update;
  return { ...update, name: deriveChatTitle(mode, names) };
}

async function hasAutomaticTitle(
  currentChat: CharacterTitleChatSnapshot | null | undefined,
  mode: string | null,
  loadCharacterName: (id: string) => Promise<string | null>,
): Promise<boolean> {
  // Without the current name there is no way to tell an automatic title from a typed one.
  if (!currentChat || typeof currentChat.name !== "string") return false;
  const currentName = currentChat.name.trim();
  if (!currentName) return true;

  const previousIds = normalizeChatCharacterIds(currentChat.characterIds);
  const previousNames = await loadAllCharacterNames(previousIds, loadCharacterName);
  return !!previousNames && currentName === deriveChatTitle(mode, previousNames);
}

/** Every name, or null when any lookup comes back empty or fails. */
async function loadAllCharacterNames(
  ids: readonly string[],
  loadCharacterName: (id: string) => Promise<string | null>,
): Promise<string[] | null> {
  const names = await Promise.all(ids.map((id) => loadCharacterName(id).catch(() => null)));
  return names.every((name): name is string => !!name) ? names : null;
}
