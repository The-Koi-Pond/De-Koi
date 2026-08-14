import { useCallback } from "react";
import type { ChatMode } from "../../engine/contracts/types/chat";
import { useChatStore } from "../../shared/stores/chat.store";
import { useSetupJourneyStore } from "../../shared/stores/setup-journey.store";
import { useUIStore } from "../../shared/stores/ui.store";

export function isNewChatJourneyPending(intent: { completed: boolean; dismissed: boolean } | null): boolean {
  return !!intent && !intent.completed && !intent.dismissed;
}

export function useStartNewChat() {
  const setPendingNewChatMode = useChatStore((s) => s.setPendingNewChatMode);
  const hasAnyDetailOpen = useUIStore((s) => s.hasAnyDetailOpen);
  const closeAllDetails = useUIStore((s) => s.closeAllDetails);

  return useCallback(
    (mode: ChatMode) => {
      const setupJourney = useSetupJourneyStore.getState();
      if (isNewChatJourneyPending(setupJourney.intent)) return;

      if (hasAnyDetailOpen()) {
        closeAllDetails();
      }
      setupJourney.begin(mode);
      setPendingNewChatMode(mode);
    },
    [closeAllDetails, hasAnyDetailOpen, setPendingNewChatMode],
  );
}
