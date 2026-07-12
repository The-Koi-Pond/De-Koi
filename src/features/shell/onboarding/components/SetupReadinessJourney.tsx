import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { chatKeys, useCreateChat, useUpdateChat } from "../../../catalog/chats";
import { useApplyUserStarredChatPreset } from "../../../catalog/chat-presets";
import { useConnections } from "../../../catalog/connections";
import { checkRemoteRuntimeHealth, hasEmbeddedTauriRuntime, type RemoteRuntimeHealthCheck } from "../../../../shared/api/remote-runtime";
import { filterLanguageGenerationConnections } from "../../../../shared/lib/connection-filters";
import { useChatStore } from "../../../../shared/stores/chat.store";
import { useSetupJourneyStore } from "../../../../shared/stores/setup-journey.store";
import { useUIStore } from "../../../../shared/stores/ui.store";
import { storageApi } from "../../../../shared/api/storage-api";
import { SetupReadinessChecklist } from "./SetupReadinessChecklist";
import { buildSetupReadinessFacts } from "../lib/setup-readiness";
import { isSetupReady } from "../../../../engine/onboarding";
import { createSetupChatLaunchOrchestrator, type SetupLaunchRequest } from "../../../modes/router/shell";

type Health = RemoteRuntimeHealthCheck | { status: "checking"; message: string };
type CheckedHealth = { checkedUrl: string; result: Health };

export function SetupReadinessJourney() {
  const remoteRuntimeUrl = useUIStore((state) => state.remoteRuntimeUrl);
  const [checkedHealth, setCheckedHealth] = useState<CheckedHealth | null>(null);
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
      reconcileChat: (chat, input) =>
        launchDependenciesRef.current.updateChat.mutateAsync({ id: chat.id, ...input }),
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
  const runtimeTarget = remoteRuntimeUrl.trim();
  const health = checkedHealth?.checkedUrl === runtimeTarget ? checkedHealth.result : null;
  const journeyActive = !!intent && !intent.completed;
  const { data: connections } = useConnections(journeyActive && (embedded || health?.status === "ok"));

  useEffect(() => {
    if (!journeyActive || embedded || !runtimeTarget) { setCheckedHealth(null); return; }
    const controller = new AbortController();
    setCheckedHealth({ checkedUrl: runtimeTarget, result: { status: "checking", message: "Checking De-Koi server" } });
    void checkRemoteRuntimeHealth(runtimeTarget, { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) setCheckedHealth({ checkedUrl: runtimeTarget, result });
    }).catch((error) => {
      if (!controller.signal.aborted) setCheckedHealth({ checkedUrl: runtimeTarget, result: { status: "unreachable", message: error instanceof Error ? error.message : "Server unavailable" } });
    });
    return () => controller.abort();
  }, [embedded, journeyActive, runtimeTarget]);

  const languageConnections = useMemo(() => filterLanguageGenerationConnections(connections).filter((row) => row.provider !== "tts" && row.provider !== "text_to_speech"), [connections]);
  const facts = buildSetupReadinessFacts({
    embedded, runtimeUrl: remoteRuntimeUrl, runtimeHealth: health, connections: languageConnections,
    selectedConnectionId: intent?.selectedConnectionId, connectionTestCapability: "unavailable",
  });
  currentLaunchRequestRef.current = {
    intent,
    ready: isSetupReady(facts),
    usableConnectionIds: languageConnections.map((row) => row.id),
  };
  const openSettings = () => { useUIStore.getState().setSettingsTab("advanced"); useUIStore.getState().openRightPanel("settings"); };
  const openConnections = () => useUIStore.getState().openRightPanel("connections");
  const continueChat = () => {
    if (!intent) return;
    if (!isSetupReady(facts)) return;
    const connection = languageConnections.find((row) => row.id === intent?.selectedConnectionId) ?? languageConnections[0];
    if (!connection) return;
    useSetupJourneyStore.getState().markConnection(connection.id);
    const selectedIntent = { ...intent, selectedConnectionId: connection.id };
    void launchOrchestratorRef.current?.launch({
      intent: selectedIntent,
      ready: true,
      usableConnectionIds: languageConnections.map((row) => row.id),
    }).catch(() => {
      // The mutation owner exposes the error; only pre-create rejection is retryable by the orchestrator.
    });
  };

  if (!intent || intent.completed) return null;

  return (
    <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-3" role="dialog" aria-label="Setup required">
      <SetupReadinessChecklist facts={facts} dismissed={intent?.dismissed} completed={intent?.completed}
        onDismiss={() => useSetupJourneyStore.getState().dismiss()} onResume={() => useSetupJourneyStore.getState().resume()}
        onConfigureRuntime={openSettings} onRepairRuntime={openSettings} onCreateConnection={openConnections}
        onTestConnection={openConnections} onContinueChat={continueChat} />
    </div>
  );
}
