import { useEffect, useMemo, useState } from "react";
import { useCreateChat } from "../../../catalog/chats";
import { useApplyUserStarredChatPreset } from "../../../catalog/chat-presets";
import { useConnections } from "../../../catalog/connections";
import { checkRemoteRuntimeHealth, hasEmbeddedTauriRuntime, type RemoteRuntimeHealthCheck } from "../../../../shared/api/remote-runtime";
import { filterLanguageGenerationConnections } from "../../../../shared/lib/connection-filters";
import { useChatStore } from "../../../../shared/stores/chat.store";
import { useSetupJourneyStore } from "../../../../shared/stores/setup-journey.store";
import { useUIStore } from "../../../../shared/stores/ui.store";
import { SetupReadinessChecklist } from "./SetupReadinessChecklist";
import { buildSetupReadinessFacts } from "../lib/setup-readiness";
import { isSetupReady } from "../../../../engine/onboarding";

type Health = RemoteRuntimeHealthCheck | { status: "checking"; message: string };
type CheckedHealth = { checkedUrl: string; result: Health };

export function SetupReadinessJourney() {
  const remoteRuntimeUrl = useUIStore((state) => state.remoteRuntimeUrl);
  const [checkedHealth, setCheckedHealth] = useState<CheckedHealth | null>(null);
  const intent = useSetupJourneyStore((state) => state.intent);
  const createChat = useCreateChat();
  const applyPreset = useApplyUserStarredChatPreset();
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
  const openSettings = () => { useUIStore.getState().setSettingsTab("advanced"); useUIStore.getState().openRightPanel("settings"); };
  const openConnections = () => useUIStore.getState().openRightPanel("connections");
  const continueChat = () => {
    if (!intent) return;
    if (!isSetupReady(facts)) return;
    const mode = intent.mode;
    const connection = languageConnections.find((row) => row.id === intent?.selectedConnectionId) ?? languageConnections[0];
    if (!connection) return;
    useSetupJourneyStore.getState().markConnection(connection.id);
    const label = mode === "conversation" ? "Conversation" : mode === "game" ? "Game" : "Roleplay";
    createChat.mutate({ name: `New ${label}`, mode, characterIds: [], connectionId: connection.id }, { onSuccess: async (chat) => {
      useSetupJourneyStore.getState().markCompleted();
      const chatStore = useChatStore.getState();
      chatStore.setPendingNewChatMode(null); chatStore.setActiveChatId(chat.id);
      try { await applyPreset({ mode, chatId: chat.id }); } catch { /* chat remains usable with defaults */ }
      chatStore.setShouldOpenSettings(true, chat.id); chatStore.setShouldOpenWizard(true, chat.id);
    } });
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
