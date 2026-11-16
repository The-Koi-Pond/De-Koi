import { useCallback, useEffect, useRef } from "react";
import { useDeleteChat } from "../../../../catalog/chats/index";
import { useChatStore } from "../../../../../shared/stores/chat.store";
import { isEmptyNewChatSetup } from "../lib/empty-new-chat";

type DraftOverlays = {
  newChatSetupChatId: string | null;
  setWizardOpen: (open: boolean) => void;
  clearNewChatSetup: () => void;
  finishWizard: () => void;
};

/**
 * New chat makes the chat before its setup wizard opens, so the wizard decides whether that draft stays.
 *
 * - Skip / Done keeps it unless nobody was picked and nothing was written.
 * - Close (X, Escape, the backdrop) drops a draft nothing was written in. On any other chat it only closes the
 *   wizard: close used to delete whatever chat was active, which could be a real chat opened while the wizard
 *   was still up.
 * - Leaving a draft with nobody in it and nothing written (Home, another chat, New chat again) drops it, so
 *   half-started chats don't pile up in the chat list and Recent.
 *
 * A draft left by a reload is kept on purpose: it shows the "Continue setup" card instead.
 */
export function useNewChatDraft({
  activeChatId,
  overlays,
  chatCharIds,
  totalMessageCount,
  messagesLoaded,
}: {
  activeChatId: string | null;
  overlays: DraftOverlays;
  chatCharIds: string[];
  totalMessageCount: number;
  messagesLoaded: boolean;
}) {
  const deleteChat = useDeleteChat();
  const setActiveChatId = useChatStore((state) => state.setActiveChatId);

  const isSetupDraft = Boolean(activeChatId) && overlays.newChatSetupChatId === activeChatId;
  const nothingWritten = messagesLoaded && totalMessageCount === 0;
  const unusedDraft = isSetupDraft && nothingWritten && chatCharIds.length === 0;

  // What the last committed render knew, read when the active chat changes or the route unmounts.
  const leavingRef = useRef<{ chatId: string | null; unusedDraft: boolean }>({ chatId: null, unusedDraft: false });
  const deleteRef = useRef(deleteChat.mutate);
  // Drafts already being deleted by Skip or close, so leaving them doesn't send a second delete.
  const discardedRef = useRef(new Set<string>());

  const discard = useCallback(() => {
    const chatId = activeChatId;
    if (!chatId) return;
    discardedRef.current.add(chatId);
    overlays.setWizardOpen(false);
    void deleteChat
      .mutateAsync(chatId)
      .then(() => {
        overlays.clearNewChatSetup();
        if (useChatStore.getState().activeChatId === chatId) setActiveChatId(null);
      })
      .catch(() => {
        discardedRef.current.delete(chatId);
        if (useChatStore.getState().activeChatId === chatId) overlays.setWizardOpen(true);
      });
  }, [activeChatId, deleteChat, overlays, setActiveChatId]);

  const finish = useCallback(() => {
    if (
      isEmptyNewChatSetup({
        activeChatId,
        setupChatId: overlays.newChatSetupChatId,
        chatCharIds,
        totalMessageCount,
        messagesLoaded,
      })
    ) {
      discard();
      return;
    }
    overlays.finishWizard();
  }, [activeChatId, chatCharIds, discard, messagesLoaded, overlays, totalMessageCount]);

  const cancel = useCallback(() => {
    if (isSetupDraft && nothingWritten) {
      discard();
      return;
    }
    overlays.finishWizard();
  }, [discard, isSetupDraft, nothingWritten, overlays]);

  useEffect(
    () => () => {
      const leaving = leavingRef.current;
      if (!leaving.chatId || !leaving.unusedDraft || discardedRef.current.has(leaving.chatId)) return;
      discardedRef.current.add(leaving.chatId);
      deleteRef.current(leaving.chatId);
    },
    [activeChatId],
  );

  useEffect(() => {
    leavingRef.current = { chatId: activeChatId, unusedDraft };
    deleteRef.current = deleteChat.mutate;
  });

  return { finish, cancel };
}
