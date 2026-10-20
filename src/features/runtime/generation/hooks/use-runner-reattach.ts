import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { generationRunnerApi, generationRunnerAvailable } from "../../../../shared/api/generation-runner-api";
import { useChatStore } from "../../../../shared/stores/chat.store";
import { followRunnerReply, runGenerationWithUi, type GenerateArgs } from "./use-generate";

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * When the open chat has a reply still running on the hosted runner (started in a tab that was closed, on another
 * device, or before the phone went to sleep), show it streaming here. Checks on chat open and whenever the tab
 * becomes visible again.
 */
export function useRunnerReattach(chatId: string | null): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!chatId) return;
    let disposed = false;
    let checking = false;

    const check = async () => {
      if (disposed || checking) return;
      checking = true;
      try {
        if (useChatStore.getState().abortControllers.has(chatId)) return;
        if (!(await generationRunnerAvailable())) return;
        const job = (await generationRunnerApi.list(chatId)).find((entry) => entry.status === "running");
        if (!job || disposed || useChatStore.getState().abortControllers.has(chatId)) return;
        // No userMessage: the replay already carries the saved user message.
        const args: GenerateArgs = {
          chatId,
          connectionId: null,
          ...(readString(job.input.regenerateMessageId)
            ? { regenerateMessageId: readString(job.input.regenerateMessageId) }
            : {}),
          ...(readString(job.input.forCharacterId) ? { forCharacterId: readString(job.input.forCharacterId) } : {}),
          ...(job.input.impersonate === true ? { impersonate: true } : {}),
        };
        await runGenerationWithUi(queryClient, args, (_args, signal) => followRunnerReply(job.id, signal));
      } catch (error) {
        console.warn("[generation] could not reattach to the reply running on the server", error);
      } finally {
        checking = false;
      }
    };

    void check();
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [chatId, queryClient]);
}
