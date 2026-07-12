import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CHAT_MODES } from "../../engine/contracts/constants/chat-modes";
import type { ChatMode } from "../../engine/contracts/types/chat";
import {
  useApplyUserStarredChatPreset,
} from "../../features/catalog/chat-presets/index";
import { useCreateChat } from "../../features/catalog/chats/sidebar";
import { connectionKeys } from "../../features/catalog/connections/index";
import { checkRemoteRuntimeHealth } from "../../shared/api/remote-runtime";
import { storageApi } from "../../shared/api/storage-api";
import { filterLanguageGenerationConnections } from "../../shared/lib/connection-filters";
import { useChatStore } from "../../shared/stores/chat.store";
import { useSetupJourneyStore } from "../../shared/stores/setup-journey.store";
import { useUIStore } from "../../shared/stores/ui.store";

function hasEmbeddedTauriIpc(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
  );
}

export function useStartNewChat() {
  const queryClient = useQueryClient();
  const createChat = useCreateChat();
  const applyUserStarredChatPreset = useApplyUserStarredChatPreset();
  const setActiveChatId = useChatStore((s) => s.setActiveChatId);
  const setPendingNewChatMode = useChatStore((s) => s.setPendingNewChatMode);
  const remoteRuntimeUrl = useUIStore((s) => s.remoteRuntimeUrl);
  const hasAnyDetailOpen = useUIStore((s) => s.hasAnyDetailOpen);
  const closeAllDetails = useUIStore((s) => s.closeAllDetails);

  return useCallback(
    async (mode: ChatMode) => {
      const isNewChatMode = mode === "conversation" || mode === "roleplay" || mode === "game";
      const remoteRuntime = remoteRuntimeUrl.trim();
      const needsRemoteRuntime = !hasEmbeddedTauriIpc();
      const deferToSetup = () => {
        if (!isNewChatMode) return;
        useSetupJourneyStore.getState().begin(mode);
        setPendingNewChatMode(mode);
      };

      if (needsRemoteRuntime && remoteRuntime.length === 0) {
        deferToSetup();
        return;
      }

      if (needsRemoteRuntime) {
        let health: Awaited<ReturnType<typeof checkRemoteRuntimeHealth>>;
        try {
          health = await checkRemoteRuntimeHealth(remoteRuntime);
        } catch {
          deferToSetup();
          return;
        }
        if (health.status !== "ok") {
          deferToSetup();
          return;
        }
      }

      let connections: Record<string, unknown>[];
      try {
        connections = await queryClient.fetchQuery({
          queryKey: connectionKeys.list(),
          queryFn: () => storageApi.list<Record<string, unknown>>("connections"),
          staleTime: 5 * 60_000,
        });
      } catch {
        deferToSetup();
        return;
      }
      const connectionRows = filterLanguageGenerationConnections(
        (connections ?? []) as Array<{ id: string; provider?: string }>,
      ).filter((connection) => !!connection.id);
      if (connectionRows.length === 0) {
        deferToSetup();
        return;
      }

      if (hasAnyDetailOpen()) {
        closeAllDetails();
      }

      createChat.mutate(
        {
          name: `New ${CHAT_MODES[mode]?.name ?? mode}`,
          mode,
          characterIds: [],
          connectionId: connectionRows[0]!.id,
        },
        {
          onSuccess: async (chat) => {
            setActiveChatId(chat.id);
            try {
              await applyUserStarredChatPreset({ mode, chatId: chat.id });
            } catch {
              /* non-fatal: chat still opens with system defaults */
            }
            useChatStore.getState().setNewChatSetupIntent({
              chatId: chat.id,
              openSettings: true,
              openWizard: true,
              shortcutMode: false,
            });
          },
        },
      );
    },
    [
      applyUserStarredChatPreset,
      closeAllDetails,
      createChat,
      hasAnyDetailOpen,
      queryClient,
      remoteRuntimeUrl,
      setActiveChatId,
      setPendingNewChatMode,
    ],
  );
}
