import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { readString } from "../../../../../engine/generation/runtime-records";
import { startTranceFromChat } from "../../../../../engine/modes/trance/from-chat";
import { llmApi } from "../../../../../shared/api/llm-api";
import { storageApi } from "../../../../../shared/api/storage-api";
import { toUserMessage } from "../../../../../shared/lib/error-message";
import { useChatStore } from "../../../../../shared/stores/chat.store";
import { chatKeys } from "../../../../catalog/chats/index";

// One at a time, and it outlives the drawer or panel that started it: closing it doesn't throw the work away.
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
 * Makes a trance session from a chat, roleplay or fic: the source's model suggests three sessions drawn from it, and
 * the new session opens on them. `drafting` is the chat being turned into a trance, while that runs.
 */
export function useStartTranceFromChat() {
  const queryClient = useQueryClient();
  const drafting = useSyncExternalStore(subscribe, draftingChatId, draftingChatId);

  const start = useCallback(
    async (chatId: string, characterId?: string | null) => {
      if (running) return;
      const controller = new AbortController();
      running = { chatId, controller };
      notify();
      try {
        const session = await startTranceFromChat(
          { storage: storageApi, llm: llmApi },
          { chatId, characterId },
          { signal: controller.signal },
        );
        await queryClient.invalidateQueries({ queryKey: chatKeys.list() });
        useChatStore.getState().setActiveChatId(readString(session.id));
        toast.success("Three trance ideas are ready. Say how you feel, then pick one.");
      } catch (error) {
        if (!controller.signal.aborted) {
          toast.error(toUserMessage(error, { fallback: "Couldn't make a trance from the chat. Try again." }));
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
