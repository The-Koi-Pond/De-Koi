import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { isRecord, readString, type JsonRecord } from "../../../../../engine/generation/runtime-records";
import { canLinkCarriedChat, carryChatOn } from "../../../../../engine/shared/carry-on";
import { chatCommandApi } from "../../../../../shared/api/chat-command-api";
import { llmApi } from "../../../../../shared/api/llm-api";
import { storageApi } from "../../../../../shared/api/storage-api";
import { toUserMessage } from "../../../../../shared/lib/error-message";
import { useChatStore } from "../../../../../shared/stores/chat.store";
import { chatKeys } from "../../../../catalog/chats/index";

// One at a time, and it outlives the picker that started it: closing the picker doesn't throw the work away.
let running: { chatId: string; controller: AbortController } | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const carryingChatId = () => running?.chatId ?? null;

/** Links the new chat to its source when the source has no linked chat yet; says whether it did. */
async function linkToSource(sourceId: string, newChatId: string): Promise<boolean> {
  const source = await storageApi.get<JsonRecord>("chats", sourceId);
  if (!isRecord(source) || !canLinkCarriedChat(readString(source.mode), !!readString(source.connectedChatId).trim()))
    return false;
  await chatCommandApi.connect(newChatId, sourceId);
  return true;
}

/**
 * Carries a chat on as a roleplay, or a roleplay on as a chat: the source's model writes the story so far and a first
 * message, the new chat opens, and the two are linked when the source isn't linked to another. `carrying` is the
 * source's id while that runs.
 */
export function useCarryChatOn() {
  const queryClient = useQueryClient();
  const carrying = useSyncExternalStore(subscribe, carryingChatId, carryingChatId);

  const start = useCallback(
    async (chatId: string, characterId?: string | null) => {
      if (running) return;
      const controller = new AbortController();
      running = { chatId, controller };
      notify();
      try {
        const chat = await carryChatOn(
          { storage: storageApi, llm: llmApi },
          { chatId, characterId },
          { signal: controller.signal },
        );
        const newId = readString(chat.id);
        // The new chat stands on its own if linking fails: the story so far is already in its summaries.
        const linked = await linkToSource(chatId, newId).catch((error: unknown) => {
          toast.warning(`Couldn't link the two (${toUserMessage(error)}). You can link them in the chat's settings.`);
          return false;
        });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: chatKeys.list() }),
          queryClient.invalidateQueries({ queryKey: chatKeys.detail(chatId) }),
        ]);
        useChatStore.getState().setActiveChatId(newId);
        const kind = readString(chat.mode) === "roleplay" ? "roleplay" : "chat";
        toast.success(
          `Your ${kind} picks up from here, with the story so far in its summaries.${linked ? " The two are linked, so each knows what happens in the other." : ""}`,
        );
      } catch (error) {
        if (!controller.signal.aborted) {
          toast.error(toUserMessage(error, { fallback: "Couldn't carry this on. Try again." }));
        }
      } finally {
        running = null;
        notify();
      }
    },
    [queryClient],
  );
  const stop = useCallback(() => running?.controller.abort(), []);
  return { start, stop, carrying };
}
