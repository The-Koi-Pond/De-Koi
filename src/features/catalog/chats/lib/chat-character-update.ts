import { deriveChatTitle } from "../../../../engine/entities/chat-title";

export type CharacterMembershipChatUpdate = {
  name?: string;
  mode?: string;
  connectionId?: string | null;
  promptPresetId?: string | null;
  personaId?: string | null;
  characterIds?: string[];
};

export async function completeCharacterTitleUpdate<T extends CharacterMembershipChatUpdate>(
  update: T,
  currentChat: { mode?: string | null } | null | undefined,
  loadCharacterName: (id: string) => Promise<string | null>,
): Promise<T> {
  if (!("characterIds" in update) || "name" in update || !update.characterIds) return update;

  const names = await Promise.all(update.characterIds.map((id) => loadCharacterName(id)));
  return {
    ...update,
    name: deriveChatTitle(
      update.mode ?? currentChat?.mode,
      names.filter((name): name is string => !!name),
    ),
  };
}
