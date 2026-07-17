import type { CharacterMemoryPersistence } from "../contracts/types/character";

export interface CharacterMemoryScopeCharacter {
  id: string;
  memoryPersistence?: CharacterMemoryPersistence;
}

export type AutomaticMemoryScopeResolution = {
  scope: { kind: "character" | "chat" | "scene"; id: string };
  characterId: string | null;
  reason: "attributed_character" | "character_chat_only" | "ambiguous_scene" | "ambiguous_chat";
};

export function effectiveCharacterMemoryPersistence(value: unknown): CharacterMemoryPersistence {
  return value === "chat" ? "chat" : "character";
}

export function resolveAutomaticMemoryScope(input: {
  chatId: string;
  mode: string;
  sceneId?: string | null;
  assistantCharacterId?: string | null;
  activeCharacters: CharacterMemoryScopeCharacter[];
}): AutomaticMemoryScopeResolution {
  const assistantCharacterId = input.assistantCharacterId?.trim() || "";
  const attributedCharacter = assistantCharacterId
    ? input.activeCharacters.find((character) => character.id === assistantCharacterId)
    : undefined;

  if (attributedCharacter) {
    if (effectiveCharacterMemoryPersistence(attributedCharacter.memoryPersistence) === "chat") {
      return {
        scope: { kind: "chat", id: input.chatId },
        characterId: attributedCharacter.id,
        reason: "character_chat_only",
      };
    }
    return {
      scope: { kind: "character", id: attributedCharacter.id },
      characterId: attributedCharacter.id,
      reason: "attributed_character",
    };
  }

  const sceneId = input.sceneId?.trim() || "";
  if ((input.mode === "roleplay" || input.mode === "visual_novel") && sceneId) {
    return {
      scope: { kind: "scene", id: sceneId },
      characterId: null,
      reason: "ambiguous_scene",
    };
  }

  return {
    scope: { kind: "chat", id: input.chatId },
    characterId: null,
    reason: "ambiguous_chat",
  };
}
