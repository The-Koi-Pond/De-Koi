import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { chatKeys, useCreateChat, useUpdateChat } from "../../../catalog/chats";
import { useApplyUserStarredChatPreset } from "../../../catalog/chat-presets";
import { useConnections } from "../../../catalog/connections";
import {
  checkRemoteRuntimeHealth,
  hasEmbeddedTauriRuntime,
  sameOriginRemoteRuntimeUrl,
  type RemoteRuntimeHealthCheck,
} from "../../../../shared/api/remote-runtime";
import { filterLanguageGenerationConnections } from "../../../../shared/lib/connection-filters";
import { useChatStore } from "../../../../shared/stores/chat.store";
import { useSetupJourneyStore } from "../../../../shared/stores/setup-journey.store";
import { useUIStore } from "../../../../shared/stores/ui.store";
import { storageApi } from "../../../../shared/api/storage-api";
import { connectionCatalogApi } from "../../../../shared/api/connection-catalog-api";
import { SetupReadinessChecklist } from "./SetupReadinessChecklist";
import { buildSetupReadinessFacts } from "../lib/setup-readiness";
import { isSetupReady } from "../../../../engine/onboarding";
import {
  createSetupChatLaunchOrchestrator,
  SetupPresetApplicationError,
  type SetupLaunchRequest,
} from "../../../modes/router/shell";

type Health = RemoteRuntimeHealthCheck | { status: "checking"; message: string };
type CheckedHealth = { checkedUrl: string; result: Health };

export function SetupReadinessJourney() {
  const remoteRuntimeUrl = useUIStore((state) => state.remoteRuntimeUrl);
  const [checkedHealth, setCheckedHealth] = useState<CheckedHealth | null>(null);
  const [launchError, setLaunchError] = useState<{ message: string; canContinueWithDefaults: boolean } | null>(null);
  const intent = useSetupJourneyStore((state) => state.intent);
  const createChat = useCreateChat();
  const updateChat = useUpdateChat();
  const queryClient = useQueryClient();
  const applyPreset = useApplyUserStarredChatPreset();
  const currentLaunchRequestRef = useRef<SetupLaunchRequest | null>(null);
  const launchDependenciesRef = useRef({ createChat, updateChat, applyPreset });
  launchDependenciesRef.current = { createChat, updateChat, applyPreset };
  const launchOrchestratorRef = useRef<ReturnType<typeof createSetupChatLaunchOrchestrator> | null>(null);
  if (!launchOrchestratorRef.current) {
    launchOrchestratorRef.current = createSetupChatLaunchOrchestrator({
      createChat: (input) => launchDependenciesRef.current.createChat.mutateAsync(input),
      reconcileChat: (chat, input) => launchDependenciesRef.current.updateChat.mutateAsync({ id: chat.id, ...input }),
      getCurrentLaunchRequest: () => currentLaunchRequestRef.current,
      getRecovery: () => useSetupJourneyStore.getState().recovery,
      recordRecovery: (recovery) => useSetupJourneyStore.getState().recordRecovery(recovery),
      clearRecovery: () => useSetupJourneyStore.getState().clearRecovery(),
      applyStarredPreset: (input) => launchDependenciesRef.current.applyPreset(input),
      resolveCharacterLaunchContext: async (characterId) => {
        const character = await storageApi.get<{
          data?: { name?: unknown; first_mes?: unknown; alternate_greetings?: unknown };
        }>("characters", characterId);
        const data = character?.data;
        return {
          characterName: typeof data?.name === "string" && data.name.trim() ? data.name : "Character",
          firstMessage: typeof data?.first_mes === "string" ? data.first_mes : undefined,
          alternateGreetings: Array.isArray(data?.alternate_greetings)
            ? data.alternate_greetings.filter((entry): entry is string => typeof entry === "string")
            : [],
        };
      },
      initializeCharacterChat: async (chatId, characterId, context, claim) => {
        if (claim.mode !== "roleplay" || !context.firstMessage?.trim()) return;
        const message = await storageApi.createChatMessage<{ id: string }>(chatId, {
          role: "assistant",
          content: context.firstMessage,
          characterId,
        });
        const cleanup = async () => {
          if (!message?.id) return;
          await storageApi.deleteChatMessage(message.id);
          queryClient.invalidateQueries({ queryKey: chatKeys.messages(chatId) });
        };
        if (message?.id) {
          try {
            for (const greeting of context.alternateGreetings ?? []) {
              if (greeting.trim()) {
                await storageApi.addChatMessageSwipe(chatId, message.id, greeting, { activate: false });
              }
            }
          } catch (error) {
            await cleanup();
            throw error;
          }
        }
        queryClient.invalidateQueries({ queryKey: chatKeys.messages(chatId) });
        return { cleanup };
      },
      complete: (chat, claim) => {
        const chatStore = useChatStore.getState();
        chatStore.setPendingNewChatMode(null);
        chatStore.setActiveChatId(chat.id);
        chatStore.setNewChatSetupIntent({
          chatId: chat.id,
          openSettings: true,
          openWizard: true,
          shortcutMode: claim.originCharacterId !== null,
        });
        useSetupJourneyStore.getState().markCompleted(claim.journeyId);
      },
    });
  }
  const embedded = hasEmbeddedTauriRuntime();
  const runtimeTarget = remoteRuntimeUrl.trim() || sameOriginRemoteRuntimeUrl();
  const health = checkedHealth?.checkedUrl === runtimeTarget ? checkedHealth.result : null;
  const journeyActive = !!intent && !intent.completed;
  const { data: connections, isPending: connectionsPending } = useConnections(
    journeyActive && (embedded || health?.status === "ok"),
  );

  useEffect(() => {
    if (!journeyActive || embedded || !runtimeTarget) {
      setCheckedHealth(null);
      return;
    }
    const controller = new AbortController();
    setCheckedHealth({ checkedUrl: runtimeTarget, result: { status: "checking", message: "Checking De-Koi server" } });
    void checkRemoteRuntimeHealth(runtimeTarget, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setCheckedHealth({ checkedUrl: runtimeTarget, result });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setCheckedHealth({
            checkedUrl: runtimeTarget,
            result: { status: "unreachable", message: error instanceof Error ? error.message : "Server unavailable" },
          });
      });
    return () => controller.abort();
  }, [embedded, journeyActive, runtimeTarget]);

  const languageConnections = useMemo(
    () =>
      filterLanguageGenerationConnections(connections).filter(
        (row) => row.provider !== "tts" && row.provider !== "text_to_speech",
      ),
    [connections],
  );
  const facts = useMemo(
    () =>
      buildSetupReadinessFacts({
        embedded,
        runtimeUrl: runtimeTarget,
        runtimeHealth: health,
        connections: languageConnections,
      }),
    [embedded, health, languageConnections, runtimeTarget],
  );
  const setupReady = isSetupReady(facts);
  const readinessKnown = embedded
    ? !connectionsPending
    : !runtimeTarget || (!!health && health.status !== "checking" && (health.status !== "ok" || !connectionsPending));
  currentLaunchRequestRef.current = {
    intent,
    ready: setupReady,
    usableConnectionIds: languageConnections.map((row) => row.id),
  };
  const openSettings = () => {
    useUIStore.getState().setSettingsTab("advanced");
    useUIStore.getState().openRightPanel("settings");
  };
  const openConnections = () => useUIStore.getState().openRightPanel("connections");
  const launchChat = useCallback(
    (skipStarredPreset = false) => {
      if (!intent) return;
      if (!setupReady) return;
      const connectionId =
        languageConnections.find((row) => row.id === intent.selectedConnectionId)?.id ??
        connectionCatalogApi.selectDefaultTextConnectionId(languageConnections);
      const connection = languageConnections.find((row) => row.id === connectionId);
      if (!connection) return;
      useSetupJourneyStore.getState().markConnection(connection.id);
      const selectedIntent = { ...intent, selectedConnectionId: connection.id };
      setLaunchError(null);
      void launchOrchestratorRef.current
        ?.launch(
          {
            intent: selectedIntent,
            ready: true,
            usableConnectionIds: languageConnections.map((row) => row.id),
          },
          { skipStarredPreset },
        )
        .catch((error) => {
          setLaunchError({
            message: error instanceof Error ? error.message : "Setup could not be completed.",
            canContinueWithDefaults: error instanceof SetupPresetApplicationError,
          });
        });
    },
    [intent, languageConnections, setupReady],
  );
  const continueChat = () => launchChat();

  useEffect(() => {
    if (!intent || !setupReady) return;
    launchChat();
  }, [intent, launchChat, setupReady]);

  if (!intent || intent.completed || !readinessKnown) return null;

  return (
    <div className="flex w-full justify-center" role="region" aria-label="Setup required">
      <div className="w-full">
        {launchError && (
          <div role="alert" className="mb-3 rounded-xl border border-rose-400/30 bg-rose-400/10 p-3 text-sm">
            <p className="font-medium">Couldn’t finish setup</p>
            <p className="text-[var(--muted-foreground)]">{launchError.message}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className="rounded-lg bg-[var(--primary)] px-3 py-1.5" onClick={continueChat}>
                Retry
              </button>
              {launchError.canContinueWithDefaults && (
                <button
                  type="button"
                  className="rounded-lg border border-[var(--border)] px-3 py-1.5"
                  onClick={() => launchChat(true)}
                >
                  Continue with defaults
                </button>
              )}
            </div>
          </div>
        )}
        {!setupReady && (
          <SetupReadinessChecklist
            facts={facts}
            dismissed={intent.dismissed}
            completed={intent.completed}
            onDismiss={() => useSetupJourneyStore.getState().dismiss()}
            onResume={() => useSetupJourneyStore.getState().resume()}
            onConfigureRuntime={openSettings}
            onRepairRuntime={openSettings}
            onCreateConnection={openConnections}
            onContinueChat={continueChat}
          />
        )}
      </div>
    </div>
  );
}
