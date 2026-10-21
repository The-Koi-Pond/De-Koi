import { useCallback } from "react";
import { useChatStore } from "../../../../shared/stores/chat.store";
import { useSetupJourneyStore } from "../../../../shared/stores/setup-journey.store";
import { useUIStore } from "../../../../shared/stores/ui.store";

type ChatMode = "roleplay" | "conversation";

interface StartChatFromCharacterOptions {
  characterId: string;
  characterName: string;
  mode: ChatMode;
  firstMessage?: string;
  alternateGreetings?: string[];
}

export function useStartChatFromCharacter() {
  const startChatFromCharacter = useCallback(({ characterId, mode }: StartChatFromCharacterOptions) => {
    // Close the character editor/library card so the new chat is what shows (on phones it otherwise stays on top).
    const ui = useUIStore.getState();
    if (ui.hasAnyDetailOpen()) ui.closeAllDetails();
    useSetupJourneyStore.getState().begin(mode, characterId);
    useChatStore.getState().setPendingNewChatMode(mode);
  }, []);

  return {
    startChatFromCharacter,
    isStartingChat: false,
  };
}
