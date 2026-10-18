import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  applyFanficContinuityFixesToChapter,
  checkFanficChapterContinuity,
  type FanficChapterContinuityCheck,
  type FanficContinuityFix,
  type FanficContinuityPhase,
} from "../../../../engine/modes/fanfic/continuity";
import { updateFanficLedger, type FanficLedgerProgress } from "../../../../engine/modes/fanfic/ledger";
import {
  deleteFanficQualityRun,
  runFanficQualityCheck,
  type FanficQualityPhase,
} from "../../../../engine/modes/fanfic/quality";
import type { FanficChapterRef } from "../../../../engine/modes/fanfic/chapter-refs";
import { stripFanficChapterHeading } from "../../../../engine/modes/fanfic/prompts";
import { readFanficState } from "../../../../engine/modes/fanfic/request";
import { planFanfic, type FanficPlanningPhase } from "../../../../engine/modes/fanfic/research";
import {
  checkFanficChapterVoice,
  type FanficChapterVoiceCheck,
  type FanficVoiceCheckPhase,
} from "../../../../engine/modes/fanfic/voice-check";
import {
  buildFanficVoiceSheets,
  type FanficVoicePhase,
  type FanficVoicesResult,
} from "../../../../engine/modes/fanfic/voices";
import { saveFanficRequest, type SaveFanficRequestInput } from "../../../../engine/modes/fanfic/request-save";
import { useMutation } from "../../../../shared/hooks/use-mutation";
import { fanficResearchApi } from "../../../../shared/api/fanfic-research-api";
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

/** The reader's chapters in the engine's shape (heading stripped), for ledger freshness and continuity fixes. */
export function fanficChapterViewRefs(chapters: readonly FanficChapterView[]): FanficChapterRef[] {
  return chapters.map((chapter) => ({
    number: chapter.number,
    messageId: chapter.message.id,
    content: stripFanficChapterHeading(chapter.message.content),
  }));
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

/** Plans the fic (research first when the request asked for it) and reports which step is running. */
export function useFanficOutline(chatId: string) {
  const queryClient = useQueryClient();
  const updateChat = useUpdateChat();
  const [phase, setPhase] = useState<FanficPlanningPhase | null>(null);
  const mutation = useMutation({
    meta: { handlesOwnErrors: true },
    mutationFn: ({ connectionId, signal }: { connectionId: string | null; signal?: AbortSignal }) =>
      planFanfic(
        { storage: storageApi, llm: llmApi, web: fanficResearchApi },
        { chatId, connectionId },
        { signal, onPhase: setPhase, onWarning: (message) => toast.warning(message) },
      ).finally(() => setPhase(null)),
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
  return { ...mutation, phase };
}

/** Runs a quality check on the fic, reporting the step, and lets the requester stop it or drop old runs. */
export function useFanficQuality(chatId: string) {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<FanficQualityPhase | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: chatKeys.detail(chatId) });
  const run = useMutation({
    meta: { handlesOwnErrors: true },
    mutationFn: ({ connectionId, label }: { connectionId: string | null; label: string }) => {
      const controller = new AbortController();
      controllerRef.current = controller;
      return runFanficQualityCheck(
        { storage: storageApi, llm: llmApi },
        { chatId, connectionId, label },
        { signal: controller.signal, onPhase: setPhase },
      ).finally(() => {
        setPhase(null);
        if (controllerRef.current === controller) controllerRef.current = null;
      });
    },
    onSuccess: refresh,
    onError: (error) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error(error instanceof Error ? error.message : "The quality check could not finish.");
    },
  });
  const remove = useMutation({
    meta: { handlesOwnErrors: true },
    mutationFn: (runId: string) => deleteFanficQualityRun(storageApi, chatId, runId),
    onSettled: refresh,
    onError: (error) => toast.error(error instanceof Error ? error.message : "The run could not be deleted."),
  });
  const stop = useCallback(() => controllerRef.current?.abort(), []);
  return { run, remove, phase, stop };
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export interface FanficLedgerController {
  /**
   * Reads the chapters the ledger hasn't covered yet. The quiet update after each chapter only runs while the ledger is
   * in use (see fanficLedgerInUse) and reports failures as a warning.
   */
  update: (options?: { quiet?: boolean }) => void;
  stop: () => void;
  running: boolean;
  progress: FanficLedgerProgress | null;
}

/** Keeps the story ledger current; one per open fic so the reader panel and after-chapter updates share progress. */
export function useFanficLedger(chatId: string, connectionId: string | null): FanficLedgerController {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<FanficLedgerProgress | null>(null);
  const [running, setRunning] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const update = useCallback(
    ({ quiet = false }: { quiet?: boolean } = {}) => {
      if (controllerRef.current) return;
      const controller = new AbortController();
      controllerRef.current = controller;
      setRunning(true);
      void updateFanficLedger(
        { storage: storageApi, llm: llmApi },
        { chatId, connectionId, onlyIfInUse: quiet },
        { signal: controller.signal, onProgress: setProgress },
      )
        .catch((error: unknown) => {
          if (isAbort(error)) return;
          const message = error instanceof Error ? error.message : "The story ledger could not update.";
          if (quiet) toast.warning(`Story ledger not updated: ${message}`);
          else toast.error(message);
        })
        .finally(() => {
          if (controllerRef.current === controller) controllerRef.current = null;
          setRunning(false);
          setProgress(null);
          void queryClient.invalidateQueries({ queryKey: chatKeys.detail(chatId) });
        });
    },
    [chatId, connectionId, queryClient],
  );
  const stop = useCallback(() => controllerRef.current?.abort(), []);
  useEffect(() => () => controllerRef.current?.abort(), [chatId]);
  return { update, stop, running, progress };
}

interface FanficChapterCheckResult {
  messageId: string;
  textKey: string;
  issues: Array<{ fix: FanficContinuityFix | null }>;
}

export interface FanficChapterCheckController<Result extends FanficChapterCheckResult, Phase extends string> {
  check: (messageId: string) => void;
  stop: () => void;
  /** The chapter being checked, if any. */
  running: string | null;
  phase: Phase | null;
  results: Record<string, Result>;
  dismiss: (messageId: string) => void;
  applyFixes: (check: Result, fixes: FanficContinuityFix[]) => Promise<void>;
  fixing: boolean;
}

/**
 * Per-chapter checks for the open fic (continuity, voice), kept while the reader is open. Fixes save a new version;
 * fixed issues leave the list and the rest stay fixable against the new text.
 */
function useFanficChapterCheck<Result extends FanficChapterCheckResult, Phase extends string>(
  chatId: string,
  runCheck: (messageId: string, signal: AbortSignal, onPhase: (phase: Phase) => void) => Promise<Result>,
  copy: { failed: string; one: string; many: string },
): FanficChapterCheckController<Result, Phase> {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [fixing, setFixing] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const runRef = useRef(runCheck);
  useEffect(() => {
    runRef.current = runCheck;
  }, [runCheck]);

  const check = useCallback(
    (messageId: string) => {
      if (controllerRef.current) return;
      const controller = new AbortController();
      controllerRef.current = controller;
      setRunning(messageId);
      void runRef
        .current(messageId, controller.signal, setPhase)
        .then((result) => setResults((current) => ({ ...current, [messageId]: result })))
        .catch((error: unknown) => {
          if (!isAbort(error)) toast.error(error instanceof Error ? error.message : copy.failed);
        })
        .finally(() => {
          if (controllerRef.current === controller) controllerRef.current = null;
          setRunning(null);
          setPhase(null);
          // A continuity check can update the ledger first.
          void queryClient.invalidateQueries({ queryKey: chatKeys.detail(chatId) });
        });
    },
    [chatId, copy.failed, queryClient],
  );
  const stop = useCallback(() => controllerRef.current?.abort(), []);
  useEffect(() => () => controllerRef.current?.abort(), [chatId]);
  const dismiss = useCallback((messageId: string) => {
    setResults((current) => {
      const next = { ...current };
      delete next[messageId];
      return next;
    });
  }, []);
  const applyFixes = useCallback(
    async (result: Result, fixes: FanficContinuityFix[]) => {
      setFixing(true);
      try {
        const { applied, skipped, appliedIndexes, textKey } = await applyFanficContinuityFixesToChapter(storageApi, {
          chatId,
          check: result,
          fixes,
        });
        const fixed = new Set(appliedIndexes.map((index) => fixes[index]));
        setResults((current) => {
          const shown = current[result.messageId];
          if (!shown) return current;
          const next = { ...current };
          const issues = shown.issues.filter((issue) => !issue.fix || !fixed.has(issue.fix));
          if (issues.length === 0) delete next[result.messageId];
          else next[result.messageId] = { ...shown, issues, textKey };
          return next;
        });
        await queryClient.invalidateQueries({ queryKey: chatKeys.messages(chatId) });
        const noun = applied === 1 ? copy.one : copy.many;
        const unplaced = skipped ? ` (${skipped} couldn't be placed)` : "";
        toast.success(`Fixed ${applied} ${noun}${unplaced}. Saved as a new version, so the old one is one tap back.`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "The fix could not be saved.");
      } finally {
        setFixing(false);
      }
    },
    [chatId, copy.many, copy.one, queryClient],
  );
  return { check, stop, running, phase, results, dismiss, applyFixes, fixing };
}

export type FanficContinuityController = FanficChapterCheckController<
  FanficChapterContinuityCheck,
  FanficContinuityPhase
>;

const CONTINUITY_COPY = { failed: "The continuity check failed.", one: "slip", many: "slips" };
const VOICE_COPY = { failed: "The voice check failed.", one: "line", many: "lines" };

/** Per-chapter continuity checks for the open fic, kept while the reader is open. */
export function useFanficContinuity(chatId: string, connectionId: string | null): FanficContinuityController {
  const run = useCallback(
    (messageId: string, signal: AbortSignal, onPhase: (phase: FanficContinuityPhase) => void) =>
      checkFanficChapterContinuity(
        { storage: storageApi, llm: llmApi },
        { chatId, messageId, connectionId },
        { signal, onPhase },
      ),
    [chatId, connectionId],
  );
  return useFanficChapterCheck(chatId, run, CONTINUITY_COPY);
}

export type FanficVoiceCheckController = FanficChapterCheckController<FanficChapterVoiceCheck, FanficVoiceCheckPhase>;

/** Per-chapter out-of-character checks against the fic's voice sheets. */
export function useFanficVoiceCheck(chatId: string, connectionId: string | null): FanficVoiceCheckController {
  const run = useCallback(
    (messageId: string, signal: AbortSignal, onPhase: (phase: FanficVoiceCheckPhase) => void) =>
      checkFanficChapterVoice(
        { storage: storageApi, llm: llmApi },
        { chatId, messageId, connectionId },
        { signal, onPhase },
      ),
    [chatId, connectionId],
  );
  return useFanficChapterCheck(chatId, run, VOICE_COPY);
}

function voicesReadyMessage(result: FanficVoicesResult): string {
  const quotes = (result.state.voices ?? []).reduce((sum, sheet) => sum + sheet.quotes.length, 0);
  if (!result.state.request.research) return "Voice sheets ready. Turn on research in the request to add canon lines.";
  if (result.pagesRead === 0) return "Voice sheets ready. No pages could be read, so there are no canon lines.";
  const left = result.droppedQuotes ? ` (${result.droppedQuotes} left out: not found on the pages)` : "";
  return `Voice sheets ready: ${quotes} canon ${quotes === 1 ? "line" : "lines"} from ${result.pagesRead} ${result.pagesRead === 1 ? "page" : "pages"}${left}.`;
}

export interface FanficVoicesController {
  build: () => void;
  stop: () => void;
  running: boolean;
  phase: FanficVoicePhase | null;
}

/** Builds (or rebuilds) the fic's voice sheets, reporting the step. */
export function useFanficVoices(chatId: string, connectionId: string | null): FanficVoicesController {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<FanficVoicePhase | null>(null);
  const [running, setRunning] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const build = useCallback(() => {
    if (controllerRef.current) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setRunning(true);
    void buildFanficVoiceSheets(
      { storage: storageApi, llm: llmApi, web: fanficResearchApi },
      { chatId, connectionId },
      { signal: controller.signal, onPhase: setPhase },
    )
      .then((result) => toast.success(voicesReadyMessage(result)))
      .catch((error: unknown) => {
        if (!isAbort(error))
          toast.error(error instanceof Error ? error.message : "The voice sheets could not be written.");
      })
      .finally(() => {
        if (controllerRef.current === controller) controllerRef.current = null;
        setRunning(false);
        setPhase(null);
        void queryClient.invalidateQueries({ queryKey: chatKeys.detail(chatId) });
      });
  }, [chatId, connectionId, queryClient]);
  const stop = useCallback(() => controllerRef.current?.abort(), []);
  useEffect(() => () => controllerRef.current?.abort(), [chatId]);
  return { build, stop, running, phase };
}
