import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { startFanficFromChat } from "../../../../../engine/modes/fanfic/from-chat";
import { readString } from "../../../../../engine/generation/runtime-records";
import { llmApi } from "../../../../../shared/api/llm-api";
import { storageApi } from "../../../../../shared/api/storage-api";
import { toUserMessage } from "../../../../../shared/lib/error-message";
import { useChatStore } from "../../../../../shared/stores/chat.store";
import { chatKeys } from "../../../../catalog/chats/index";

// One draft at a time, and it outlives the drawer that started it: closing the drawer doesn't throw the work away.
let running: { chatId: string; controller: AbortController } | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const draftingChatId = () => running?.chatId ?? null;

/**
 * Turns a chat or roleplay into a fic: the chat's model drafts the fic's request, the new fic opens with its request
 * form filled in. `drafting` is the chat being turned into a fic, while that runs.
 */
export function useStartFanficFromChat() {
  const queryClient = useQueryClient();
  const drafting = useSyncExternalStore(subscribe, draftingChatId, draftingChatId);

  const start = useCallback(
    async (chatId: string) => {
      if (running) return;
      const controller = new AbortController();
      running = { chatId, controller };
      notify();
      try {
        const fic = await startFanficFromChat(
          { storage: storageApi, llm: llmApi },
          { chatId },
          { signal: controller.signal },
        );
        await queryClient.invalidateQueries({ queryKey: chatKeys.list() });
        useChatStore.getState().setActiveChatId(readString(fic.id));
        toast.success("The fic's request is filled in from the chat. Change anything, then start the fic.");
      } catch (error) {
        if (!controller.signal.aborted) {
          toast.error(toUserMessage(error, { fallback: "Couldn't turn the chat into a fic. Try again." }));
        }
      } finally {
        running = null;
        notify();
      }
    },
    [queryClient],
  );
  const stop = useCallback(() => running?.controller.abort(), []);
  return { start, stop, drafting };
}
