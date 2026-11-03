import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { readString } from "../../../../engine/generation/runtime-records";
import { startChatFromFanfic, type StartChatFromFanficInput } from "../../../../engine/modes/fanfic/to-chat";
import { llmApi } from "../../../../shared/api/llm-api";
import { storageApi } from "../../../../shared/api/storage-api";
import { toUserMessage } from "../../../../shared/lib/error-message";
import { useChatStore } from "../../../../shared/stores/chat.store";
import { characterKeys } from "../../../catalog/characters/index";
import { chatKeys } from "../../../catalog/chats/index";
import { personaKeys } from "../../../catalog/personas/index";

/** Continues a fic as a roleplay or chat; the new chat opens when it is set up. One at a time; Stop drops it. */
export function useFanficToChat(ficChatId: string) {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => controllerRef.current?.abort(), [ficChatId]);

  const start = useCallback(
    async (input: Omit<StartChatFromFanficInput, "ficChatId">) => {
      if (controllerRef.current) return;
      const controller = new AbortController();
      controllerRef.current = controller;
      setRunning(true);
      try {
        const chat = await startChatFromFanfic(
          { storage: storageApi, llm: llmApi },
          { ...input, ficChatId },
          { signal: controller.signal },
        );
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: chatKeys.list() }),
          queryClient.invalidateQueries({ queryKey: characterKeys.all }),
          queryClient.invalidateQueries({ queryKey: personaKeys.list }),
        ]);
        useChatStore.getState().setActiveChatId(readString(chat.id));
        toast.success(
          `The ${input.mode === "roleplay" ? "roleplay" : "chat"} picks up after the last chapter. The story so far is in its summary.`,
        );
      } catch (error) {
        if (!controller.signal.aborted) {
          toast.error(toUserMessage(error, { fallback: "Couldn't set up the chat. Try again." }));
        }
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null;
        setRunning(false);
      }
    },
    [ficChatId, queryClient],
  );
  const stop = useCallback(() => controllerRef.current?.abort(), []);
  return { start, stop, running };
}
