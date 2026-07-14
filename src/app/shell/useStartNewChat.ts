import { useCallback } from "react";
import type { ChatMode } from "../../engine/contracts/types/chat";
import { useChatStore } from "../../shared/stores/chat.store";
import { useSetupJourneyStore } from "../../shared/stores/setup-journey.store";
import { useUIStore } from "../../shared/stores/ui.store";

export function useStartNewChat() {
  const setPendingNewChatMode = useChatStore((s) => s.setPendingNewChatMode);
  const hasAnyDetailOpen = useUIStore((s) => s.hasAnyDetailOpen);
  const closeAllDetails = useUIStore((s) => s.closeAllDetails);

  return useCallback(
    (mode: ChatMode) => {
      if (hasAnyDetailOpen()) {
        closeAllDetails();
      }
      useSetupJourneyStore.getState().begin(mode);
      setPendingNewChatMode(mode);
    },
    [closeAllDetails, hasAnyDetailOpen, setPendingNewChatMode],
  );
}
