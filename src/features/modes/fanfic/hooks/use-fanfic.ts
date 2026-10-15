import { useCallback, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { chatKeys, useChat, useChatMessages, useUpdateChat } from "../../../catalog/chats/index";
import { runGenerationWithUi, type GenerateArgs } from "../../../runtime/generation/index";
import type { Message, StreamEvent } from "../../../../engine/contracts/types/chat";
import type { FanficState } from "../../../../engine/contracts/types/fanfic";
import {
  startFanficGeneration,
  type FanficGenerationKind,
  type StartFanficGenerationInput,
} from "../../../../engine/modes/fanfic/chapters";
import { generateFanficOutline } from "../../../../engine/modes/fanfic/outline";
import { readFanficState } from "../../../../engine/modes/fanfic/request";
import { saveFanficRequest, type SaveFanficRequestInput } from "../../../../engine/modes/fanfic/request-save";
import { useMutation } from "../../../../shared/hooks/use-mutation";
import { integrationGateway } from "../../../../shared/api/integration-gateway";
import { llmApi } from "../../../../shared/api/llm-api";
import { storageApi } from "../../../../shared/api/storage-api";
import { useChatStore } from "../../../../shared/stores/chat.store";

/** Large enough that a whole fic loads as one page. */
const FANFIC_MESSAGE_PAGE_SIZE = 200;
const DEFAULT_CHAT_NAME = /^New Fanfic$/;

export interface FanficChapterView {
  number: number;
  message: Message;
}

export function useFanficChat(chatId: string) {
  const chatQuery = useChat(chatId);
  const messagesQuery = useChatMessages(chatId, FANFIC_MESSAGE_PAGE_SIZE);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = messagesQuery;

  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const chat = chatQuery.data ?? null;
  const state = useMemo(() => readFanficState(chat?.metadata), [chat?.metadata]);
  const chapters = useMemo<FanficChapterView[]>(() => {
    const pages = messagesQuery.data?.pages ?? [];
    const ordered = [...pages].reverse().flat() as Message[];
    return ordered
      .filter((message) => message.role === "assistant")
      .map((message, index) => ({ number: index + 1, message }));
  }, [messagesQuery.data]);

  return {
    chat,
    state,
    chapters,
    isLoading: chatQuery.isLoading || messagesQuery.isLoading,
    messagesComplete: !hasNextPage,
    error: chatQuery.error ?? messagesQuery.error ?? null,
  };
}

/** Per-chat generation state from the shared chat store. */
export function useFanficGenerationState(chatId: string) {
  const generating = useChatStore((state) => state.abortControllers.has(chatId));
  const streamText = useChatStore((state) => state.streamBuffers.get(chatId) ?? "");
  const phase = useChatStore((state) => state.generationPhaseByChatId.get(chatId) ?? null);
  const regeneratingMessageId = useChatStore((state) => state.regenerateMessageIdByChatId.get(chatId) ?? null);
  const stop = useCallback(() => {
    useChatStore.getState().abortControllers.get(chatId)?.abort();
  }, [chatId]);
  return { generating, streamText, phase, regeneratingMessageId, stop };
}

export interface FanficWriteArgs {
  kind: FanficGenerationKind;
  messageId?: string | null;
  notes?: string | null;
}

export function useFanficWriter(chatId: string, connectionId: string | null) {
  const queryClient = useQueryClient();
  return useCallback(
    ({ kind, messageId = null, notes = null }: FanficWriteArgs): Promise<boolean> => {
      const args: GenerateArgs & StartFanficGenerationInput = {
        chatId,
        connectionId,
        fanficKind: kind,
        notes,
        regenerateMessageId: kind === "chapter" ? null : messageId,
        userTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
      return runGenerationWithUi(
        queryClient,
        args,
        (streamArgs, signal) =>
          startFanficGeneration(
            { storage: storageApi, llm: llmApi, integrations: integrationGateway },
            streamArgs as GenerateArgs & StartFanficGenerationInput,
            signal,
          ) as AsyncGenerator<StreamEvent>,
      );
    },
    [chatId, connectionId, queryClient],
  );
}

/** Saves a submitted request (connection, linked cards, request) as one unit; see saveFanficRequest. */
export function useFanficRequestSave(chatId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { handlesOwnErrors: true },
    mutationFn: (input: Omit<SaveFanficRequestInput, "chatId">) => saveFanficRequest(storageApi, { chatId, ...input }),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: chatKeys.detail(chatId) }),
        queryClient.invalidateQueries({ queryKey: chatKeys.list() }),
      ]),
  });
}

export function useFanficOutline(chatId: string) {
  const queryClient = useQueryClient();
  const updateChat = useUpdateChat();
  return useMutation({
    meta: { handlesOwnErrors: true },
    mutationFn: ({ connectionId, signal }: { connectionId: string | null; signal?: AbortSignal }) =>
      generateFanficOutline({ storage: storageApi, llm: llmApi }, { chatId, connectionId }, signal),
    onSuccess: async (state: FanficState) => {
      await queryClient.invalidateQueries({ queryKey: chatKeys.detail(chatId) });
      const chatName = queryClient.getQueryData<{ name?: string }>(chatKeys.detail(chatId))?.name ?? "";
      const title = state.outline?.title.trim();
      if (title && title !== "Untitled" && DEFAULT_CHAT_NAME.test(chatName.trim())) {
        updateChat.mutate({ id: chatId, name: title });
      }
    },
    onError: (error) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error(error instanceof Error ? error.message : "The outline could not be written.");
    },
  });
}
