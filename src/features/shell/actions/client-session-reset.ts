import type { QueryClient } from "@tanstack/react-query";
import { useTrackerStateStore } from "../../runtime/world-state";
import { useAgentStore } from "../../../shared/stores/agent.store";
import { useChatStore } from "../../../shared/stores/chat.store";
import { useRoleplayEncounterStore } from "../../../shared/stores/roleplay-encounter.store";
import { useUIStore } from "../../../shared/stores/ui.store";

export function resetClientDataState(queryClient: Pick<QueryClient, "clear">) {
  useChatStore.getState().reset();
  useAgentStore.getState().reset();
  useTrackerStateStore.getState().reset();
  useRoleplayEncounterStore.getState().reset();

  queryClient.clear();
}

export function resetClientSessionState(queryClient: Pick<QueryClient, "clear">) {
  resetClientDataState(queryClient);

  const ui = useUIStore.getState();
  ui.closeModal();
  ui.closeAllDetails();
  ui.closeRightPanel();
  ui.closeBotBrowser();
  ui.setChatBackground(null);
}
