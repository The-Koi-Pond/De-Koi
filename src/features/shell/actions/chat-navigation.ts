import { useCallback } from "react";
import { useExitGameSetupFromShell } from "../../modes/game/startup";
import { useChatStore } from "../../../shared/stores/chat.store";
import { useUIStore } from "../../../shared/stores/ui.store";
import { showConfirmDialog } from "../../../shared/lib/app-dialogs";

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
        useUIStore.getState().editorDirty &&
        !(await showConfirmDialog({
          title: "Unsaved Changes",
          message: "You have unsaved changes. Discard and continue?",
          confirmLabel: "Discard",
          tone: "destructive",
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
