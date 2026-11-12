import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMutation } from "../../../../shared/hooks/use-mutation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { Chat } from "../../../../engine/contracts/types/chat";
import {
  createFanficCommentThread,
  draftFanficCommentNotes,
  listFanficCommentThreads,
  readFanficCommentThread,
  type FanficCommentUse,
} from "../../../../engine/modes/fanfic/comments";
import { readString } from "../../../../engine/generation/runtime-records";
import { llmApi } from "../../../../shared/api/llm-api";
import { storageApi } from "../../../../shared/api/storage-api";
import { useChatStore } from "../../../../shared/stores/chat.store";
import { toUserMessage } from "../../../../shared/lib/error-message";
import { chatKeys } from "../../../catalog/chats/index";
import { useGenerate } from "../../../runtime/generation/index";

export const fanficCommentKeys = {
  threads: (ficChatId: string) => [...chatKeys.all, "fanfic-comments", ficChatId] as const,
};

/** A fic's comment threads (each its own chat, owned by the fic), oldest first. */
export function useFanficCommentThreads(ficChatId: string) {
  return useQuery({
    queryKey: fanficCommentKeys.threads(ficChatId),
    queryFn: async () => (await listFanficCommentThreads(storageApi, ficChatId)) as unknown as Chat[],
    staleTime: 60_000,
  });
}

/**
 * Reads the threads again when the page comes back into view: a reply the hosted runner finished while the phone
 * slept (longer than the reply stream waits for) shows without reopening the fic.
 */
export function useRefreshFanficCommentsOnReturn(ficChatId: string, threadIds: readonly string[]): void {
  const queryClient = useQueryClient();
  const key = threadIds.join(",");
  useEffect(() => {
    if (typeof document === "undefined") return;
    const ids = key ? key.split(",") : [];
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void queryClient.invalidateQueries({ queryKey: fanficCommentKeys.threads(ficChatId) });
      for (const id of ids) void queryClient.invalidateQueries({ queryKey: chatKeys.messages(id) });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [ficChatId, key, queryClient]);
}

/** The threads under one chapter. */
export function chapterCommentThreads(threads: readonly Chat[] | undefined, chapterMessageId: string): Chat[] {
  return (threads ?? []).filter(
    (thread) => readFanficCommentThread(thread.metadata)?.chapterMessageId === chapterMessageId,
  );
}

/**
 * Comments go through the shared chat reply pipeline on the thread's own chat: the comment is saved and answered like
 * a chat message (streaming, Stop, redo with versions, the hosted runner when there is one). A new thread's chat is
 * made first; if the first comment never got saved, that empty thread is removed again.
 */
export function useFanficCommentActions(ficChatId: string) {
  const queryClient = useQueryClient();
  const { generate } = useGenerate();
  const refreshThreads = useCallback(
    () => queryClient.invalidateQueries({ queryKey: fanficCommentKeys.threads(ficChatId) }),
    [ficChatId, queryClient],
  );

  /** Sends a comment: in `threadId`, or as a new thread under the chapter. Resolves once it was saved. */
  const comment = useCallback(
    async (input: { chapterMessageId: string; threadId: string | null; text: string; onAccepted: () => void }) => {
      const text = input.text.trim();
      if (!text) return;
      let threadId = input.threadId;
      let created = false;
      if (!threadId) {
        const thread = await createFanficCommentThread(storageApi, {
          ficChatId,
          chapterMessageId: input.chapterMessageId,
        });
        threadId = readString(thread.id);
        created = true;
        await refreshThreads();
      }
      let accepted = false;
      try {
        await generate({
          chatId: threadId,
          message: text,
          onUserMessageAccepted: () => {
            accepted = true;
            input.onAccepted();
          },
        });
      } finally {
        if (created && !accepted) {
          await storageApi.delete("chats", threadId);
          await refreshThreads();
        }
      }
    },
    [ficChatId, generate, refreshThreads],
  );

  /** A new version of the author's reply (the old one stays one tap back). */
  const redo = useCallback(
    (threadId: string, messageId: string) => generate({ chatId: threadId, regenerateMessageId: messageId }),
    [generate],
  );

  /** The author's reply to the thread's last comment, when it has none yet (a failed or stopped reply). */
  const answer = useCallback((threadId: string) => generate({ chatId: threadId }), [generate]);

  const stop = useCallback((threadId: string) => {
    useChatStore.getState().abortControllers.get(threadId)?.abort();
  }, []);

  const deleteThread = useMutation({
    meta: { handlesOwnErrors: true },
    mutationFn: (threadId: string) => storageApi.delete("chats", threadId),
    onError: (error) => toast.error(toUserMessage(error, { fallback: "Couldn't delete the thread. Try again." })),
    onSettled: () => refreshThreads(),
  });

  return { comment, answer, redo, stop, deleteThread };
}

/**
 * Drafts notes from a thread for the chapter's rewrite or a re-plan, on the thread's model; one draft at a time. A
 * failed draft says why; a stopped one says nothing. Resolves to null when there are no notes to show.
 */
export function useFanficCommentNotes(threadId: string) {
  const [drafting, setDrafting] = useState<FanficCommentUse | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => controllerRef.current?.abort(), [threadId]);
  const draft = useCallback(
    async (use: FanficCommentUse): Promise<string | null> => {
      if (controllerRef.current) return null;
      const controller = new AbortController();
      controllerRef.current = controller;
      setDrafting(use);
      try {
        return await draftFanficCommentNotes(
          { storage: storageApi, llm: llmApi },
          { threadChatId: threadId, use },
          { signal: controller.signal },
        );
      } catch (error) {
        if (!controller.signal.aborted) {
          toast.error(toUserMessage(error, { fallback: "Couldn't draft notes from the thread. Try again." }));
        }
        return null;
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null;
        setDrafting(null);
      }
    },
    [threadId],
  );
  const stop = useCallback(() => controllerRef.current?.abort(), []);
  return { draft, stop, drafting };
}
