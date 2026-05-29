import { useMutation, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "../../../../shared/api/admin-api";
import { useAgentStore } from "../../../../shared/stores/agent.store";
import { useChatStore } from "../../../../shared/stores/chat.store";
import { useEncounterStore } from "../../../../shared/stores/encounter.store";
import { useUIStore } from "../../../../shared/stores/ui.store";
import { useGameStateStore } from "../../../runtime/world-state";

export type ExpungeScope =
  | "chats"
  | "characters"
  | "personas"
  | "lorebooks"
  | "presets"
  | "connections"
  | "automation"
  | "media";

async function resetClientAfterExpunge(qc: ReturnType<typeof useQueryClient>) {
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
  qc.clear();
}

export function useExpungeData() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (scopes: ExpungeScope[]) => adminApi.expunge(scopes),
    onSuccess: async () => {
      await resetClientAfterExpunge(qc);
    },
  });
}

export function useClearAllData() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => adminApi.clearAll(),
    onSuccess: async () => {
      await resetClientAfterExpunge(qc);
    },
  });
}
