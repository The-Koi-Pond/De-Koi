import { useEffect, useRef } from "react";
import { useDeleteChat } from "../../../../catalog/chats/index";
import { useChatStore } from "../../../../../shared/stores/chat.store";

/**
 * For modes whose request form is the setup (Fanfic, Trance): New makes the chat before the form shows, so a
 * chat that was started with New and left before anything was saved is dropped, instead of piling up as an
 * empty fic or session in the chat list and Recent.
 *
 * Only chats this screen saw arrive from New count (it consumes their new-chat setup intent). A chat opened
 * from the list, or still there after a reload, is never deleted. `untouched` is the route's own test: loaded,
 * still on its request form, and nothing saved to it.
 */
export function useDiscardUntouchedNewChat(activeChatId: string, untouched: boolean) {
  const deleteChat = useDeleteChat();
  const startedHereRef = useRef(new Set<string>());
  // What the last committed render knew, read when the active chat changes or the route unmounts.
  const leavingRef = useRef<{ chatId: string; untouched: boolean }>({ chatId: activeChatId, untouched: false });
  const deleteRef = useRef(deleteChat.mutate);

  // New-chat setup opens the shared settings drawer and wizard in other modes; here the request form is the setup.
  useEffect(() => {
    if (useChatStore.getState().consumeNewChatSetupIntent(activeChatId)) startedHereRef.current.add(activeChatId);
  }, [activeChatId]);

  useEffect(
    () => () => {
      const leaving = leavingRef.current;
      if (!leaving.untouched || !startedHereRef.current.delete(leaving.chatId)) return;
      deleteRef.current(leaving.chatId);
    },
    [activeChatId],
  );

  useEffect(() => {
    leavingRef.current = { chatId: activeChatId, untouched };
    deleteRef.current = deleteChat.mutate;
  });
}
