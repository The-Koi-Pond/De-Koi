import { useCallback } from "react";
import { useChatStore } from "../../../../shared/stores/chat.store";
import { useSetupJourneyStore } from "../../../../shared/stores/setup-journey.store";

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
    useSetupJourneyStore.getState().begin(mode, characterId);
    useChatStore.getState().setPendingNewChatMode(mode);
  }, []);

  return {
    startChatFromCharacter,
    isStartingChat: false,
  };
}
