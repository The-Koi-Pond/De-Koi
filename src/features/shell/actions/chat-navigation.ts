import { useCallback, useEffect } from "react";
import { useExitGameSetupFromShell } from "../../modes/game/startup";
import { useChatStore } from "../../../shared/stores/chat.store";
import { useUIStore } from "../../../shared/stores/ui.store";
import { confirmDiscardPendingAppWork } from "../../../shared/lib/app-close-guard";
import {
  LOCAL_NOTIFICATION_ACTIVATION_EVENT,
  type LocalNotificationActivationDetail,
} from "../../../shared/lib/local-notifications";

export function useNavigateToChatFromShell() {
  const setActiveChatId = useChatStore((state) => state.setActiveChatId);
  const setShouldOpenSettings = useChatStore((state) => state.setShouldOpenSettings);
  const setShouldOpenWizard = useChatStore((state) => state.setShouldOpenWizard);
  const setShouldOpenWizardInShortcutMode = useChatStore((state) => state.setShouldOpenWizardInShortcutMode);
  const setPendingNewChatMode = useChatStore((state) => state.setPendingNewChatMode);
  const closeAllDetails = useUIStore((state) => state.closeAllDetails);
  const exitGameSetup = useExitGameSetupFromShell();

  return useCallback(
    async (chatId: string) => {
      if (useChatStore.getState().activeChatId === chatId) return;
      if (
        !(await confirmDiscardPendingAppWork({
          purpose: "navigation",
          title: "Switch chats?",
          confirmLabel: "Switch anyway",
        }))
      ) {
        return;
      }
      closeAllDetails();
      setPendingNewChatMode(null);
      setShouldOpenSettings(false);
      setShouldOpenWizard(false);
      setShouldOpenWizardInShortcutMode(false);
      exitGameSetup();
      setActiveChatId(chatId);
    },
    [
      closeAllDetails,
      exitGameSetup,
      setActiveChatId,
      setPendingNewChatMode,
      setShouldOpenSettings,
      setShouldOpenWizard,
      setShouldOpenWizardInShortcutMode,
    ],
  );
}

export function useLocalNotificationNavigation() {
  const navigateToChat = useNavigateToChatFromShell();

  useEffect(() => {
    const handleActivation = (event: Event) => {
      const chatId = (event as CustomEvent<LocalNotificationActivationDetail>).detail?.chatId?.trim();
      if (chatId) void navigateToChat(chatId);
    };

    window.addEventListener(LOCAL_NOTIFICATION_ACTIVATION_EVENT, handleActivation);
    return () => window.removeEventListener(LOCAL_NOTIFICATION_ACTIVATION_EVENT, handleActivation);
  }, [navigateToChat]);
}
