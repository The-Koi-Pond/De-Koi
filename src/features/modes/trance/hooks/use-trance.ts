import { useCallback, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { chatKeys, useChat } from "../../../catalog/chats/index";
import type { TranceAfter, TranceState } from "../../../../engine/contracts/types/trance";
import { readTranceState } from "../../../../engine/modes/trance/request";
import { generateTranceScript } from "../../../../engine/modes/trance/script";
import {
  suggestTrancePitches,
  type SuggestTranceInput,
  type TrancePitch,
} from "../../../../engine/modes/trance/pitches";
import {
  recordTranceRun,
  saveTranceRequest,
  type SaveTranceRequestInput,
} from "../../../../engine/modes/trance/session";
import {
  buildTranceShare,
  NOT_A_SHARED_TRANCE,
  openSharedTrance,
  parseTranceShare,
  tranceShareFilename,
  TranceShareError,
} from "../../../../engine/modes/trance/share";
import { triggerDownload } from "../../../../shared/api/download-payload";
import { useMutation } from "../../../../shared/hooks/use-mutation";
import { llmApi } from "../../../../shared/api/llm-api";
import { storageApi } from "../../../../shared/api/storage-api";

export function useTranceChat(chatId: string) {
  const chatQuery = useChat(chatId);
  const chat = chatQuery.data ?? null;
  const state = useMemo(() => readTranceState(chat?.metadata), [chat?.metadata]);
  return { chat, state, isLoading: chatQuery.isLoading, error: chatQuery.error ?? null };
}

function useInvalidateChat(chatId: string) {
  const queryClient = useQueryClient();
  return useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: chatKeys.detail(chatId) }),
        queryClient.invalidateQueries({ queryKey: chatKeys.list() }),
      ]),
    [chatId, queryClient],
  );
}

/** Saves a submitted request (connection, character, request) as one unit; see saveTranceRequest. */
export function useTranceRequestSave(chatId: string) {
  const invalidate = useInvalidateChat(chatId);
  return useMutation({
    meta: { handlesOwnErrors: true },
    mutationFn: (input: Omit<SaveTranceRequestInput, "chatId">) => saveTranceRequest(storageApi, { chatId, ...input }),
    onSettled: invalidate,
  });
}

/** Writes the session's script on the chat's connection. `stop` drops the call; nothing is saved then. */
export function useTranceScript(chatId: string) {
  const invalidate = useInvalidateChat(chatId);
  const controller = useRef<AbortController | null>(null);
  const mutation = useMutation({
    meta: { handlesOwnErrors: true },
    mutationFn: (): Promise<TranceState> => {
      controller.current?.abort();
      const next = new AbortController();
      controller.current = next;
      return generateTranceScript({ storage: storageApi, llm: llmApi }, chatId, { signal: next.signal });
    },
    onSettled: invalidate,
  });
  const stop = useCallback(() => controller.current?.abort(), []);
  return { ...mutation, stop };
}

/** Saves how one run of the session went. */
export function useTranceRecordRun(chatId: string) {
  const invalidate = useInvalidateChat(chatId);
  return useMutation({
    meta: { handlesOwnErrors: true },
    mutationFn: (run: TranceAfter) => recordTranceRun(storageApi, chatId, run),
    onSettled: invalidate,
  });
}

/** Saves the written session as a .trance.json file a friend can open in their own De-Koi. */
export function shareTranceSession(state: TranceState, guideName: string) {
  const share = buildTranceShare(state, guideName, new Date());
  triggerDownload({
    blob: new Blob([JSON.stringify(share, null, 2)], { type: "application/json" }),
    filename: tranceShareFilename(share),
  });
}

/** Opens a shared .trance.json file in this (empty) trance chat, ready to play with no model call. */
export function useOpenSharedTrance(chatId: string) {
  const invalidate = useInvalidateChat(chatId);
  return useMutation({
    meta: { handlesOwnErrors: true },
    mutationFn: async (file: File): Promise<TranceState> => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        throw new TranceShareError(NOT_A_SHARED_TRANCE);
      }
      return openSharedTrance(storageApi, chatId, parseTranceShare(parsed));
    },
    onSettled: invalidate,
  });
}

/** Session ideas (or a preview of chosen settings) before anything is written. Nothing is saved; `stop` drops the call. */
export function useTrancePitches() {
  const controller = useRef<AbortController | null>(null);
  const mutation = useMutation({
    meta: { handlesOwnErrors: true },
    mutationFn: (input: SuggestTranceInput): Promise<TrancePitch[]> => {
      controller.current?.abort();
      const next = new AbortController();
      controller.current = next;
      return suggestTrancePitches({ storage: storageApi, llm: llmApi }, input, next.signal);
    },
  });
  const stop = useCallback(() => controller.current?.abort(), []);
  return { ...mutation, stop };
}
