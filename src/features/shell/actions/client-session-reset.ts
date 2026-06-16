import type { QueryClient } from "@tanstack/react-query";
import { useGameStateStore } from "../../runtime/world-state";
import { useAgentStore } from "../../../shared/stores/agent.store";
import { useChatStore } from "../../../shared/stores/chat.store";
import { useEncounterStore } from "../../../shared/stores/encounter.store";
import { useUIStore } from "../../../shared/stores/ui.store";

export function resetClientSessionState(queryClient: Pick<QueryClient, "clear">) {
  useChatStore.getState().reset();
  useAgentStore.getState().reset();
  useGameStateStore.getState().reset();
  useEncounterStore.getState().reset();

  const ui = useUIStore.getState();
  ui.closeModal();
  ui.closeAllDetails();
  ui.closeRightPanel();
  ui.closeBotBrowser();
  ui.setChatBackground(null);

  queryClient.clear();
}
