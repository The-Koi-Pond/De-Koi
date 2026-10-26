import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { toUserMessage } from "../../../../shared/lib/error-message";
import { chatKeys, useChat, useChatMessages, useDeleteMessages, useUpdateChat } from "../../../catalog/chats/index";
import { runGenerationWithUi, type GenerateArgs } from "../../../runtime/generation/index";
import type { Message, StreamEvent } from "../../../../engine/contracts/types/chat";
import type { FanficModelRecord, FanficState } from "../../../../engine/contracts/types/fanfic";
import {
  keepFanficVersion,
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
import { deleteFanficChapter, setFanficChainCanon, setFanficExtraCanon } from "../../../../engine/modes/fanfic/extras";
import { updateFanficLedger, type FanficLedgerProgress } from "../../../../engine/modes/fanfic/ledger";
import { clearFanficPlan, proposeFanficPlan } from "../../../../engine/modes/fanfic/plan";
import { removeFanficBannedPhrasesFrom } from "../../../../engine/modes/fanfic/passage";
import { fanficConnectionSupportsPhraseBans } from "../../../../engine/modes/fanfic/phrase-bans";
import { LOCAL_SIDECAR_CONNECTION_ID } from "../../../../engine/contracts/types/sidecar";
import { useConnection } from "../../../catalog/connections/index";
import { trackFanficWriteFinished, type FanficFinishedChapter } from "../lib/write-outcome";
import {
  rewriteFanficFlaggedScenes,
  runFanficEditorPass,
  type FanficEditorReport,
} from "../../../../engine/modes/fanfic/editor";
import {
  deleteFanficQualityRun,
  runFanficQualityCheck,
  type FanficQualityPhase,
} from "../../../../engine/modes/fanfic/quality";
import { fanficChapterLayout } from "../../../../engine/modes/fanfic/chapter-refs";
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
import { modelRoutingKeys } from "../../../../shared/api/model-routing-api";
import type { FanficJudgeRule } from "../../../../engine/modes/fanfic/quality";
import { storageApi } from "../../../../shared/api/storage-api";
import { useChatStore } from "../../../../shared/stores/chat.store";

/** Large enough that a whole fic loads as one page. */
const FANFIC_MESSAGE_PAGE_SIZE = 200;
const DEFAULT_CHAT_NAME = /^New Fanfic$/;

export interface FanficChapterView {
  /** The main chapter's number; for an extra, the main chapter it follows. Labels come from the chapter layout. */
  number: number;
  message: Message;
}

/** The fields of a message the chapter layout reads. */
function layoutRow(message: Message): Record<string, unknown> {
  return { id: message.id, role: message.role, content: message.content, extra: message.extra };
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
    const byId = new Map(ordered.map((message) => [message.id, message]));
    // Reading order: each main chapter, then its extras; extras whose main chapter is gone come last.
    return fanficChapterLayout(ordered.map(layoutRow)).chapters.map((chapter) => ({
      number: chapter.mainNumber,
      message: byId.get(chapter.messageId)!,
    }));
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
  /** Reset: the unfinished version of `messageId` the write replaces. */
  replacesVersion?: number;
  /** A new extra: the main chapter it follows. */
  parentChapter?: number;
}

/** Writes a chapter; resolves with it only when it saved a finished one, so follow-ups skip one kept unfinished. */
export function useFanficWriter(chatId: string, connectionId: string | null) {
  const queryClient = useQueryClient();
  return useCallback(
    async ({
      kind,
      messageId = null,
      notes = null,
      replacesVersion,
      parentChapter,
    }: FanficWriteArgs): Promise<FanficFinishedChapter | null> => {
      // A Reset of a new chapter or extra rewrites that chapter's message, so it runs (and streams) like a redo.
      const rewrites = kind === "regenerate" || kind === "revise" || replacesVersion !== undefined;
      const args: GenerateArgs & StartFanficGenerationInput = {
        chatId,
        connectionId,
        fanficKind: kind,
        notes,
        regenerateMessageId: rewrites ? messageId : null,
        ...(kind === "continue" && messageId ? { continueMessageId: messageId } : {}),
        ...(replacesVersion !== undefined ? { replacesVersion } : {}),
        ...(kind === "extra" && !rewrites && parentChapter !== undefined ? { parentChapter } : {}),
        userTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
      let finished = (): FanficFinishedChapter | null => null;
      const written = await runGenerationWithUi(queryClient, args, (streamArgs, signal) => {
        const tracked = trackFanficWriteFinished(
          startFanficGeneration(
            { storage: storageApi, llm: llmApi, integrations: integrationGateway },
            streamArgs as GenerateArgs & StartFanficGenerationInput,
            signal,
          ) as AsyncGenerator<StreamEvent>,
        );
        finished = tracked.finished;
        return tracked.events;
      });
      return written ? finished() : null;
    },
    [chatId, connectionId, queryClient],
  );
}

/** Keep as is: marks a chapter's unfinished version finished, its text untouched. */
export function useFanficKeepVersion(chatId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { handlesOwnErrors: true },
    mutationFn: (messageId: string) => keepFanficVersion(storageApi, { chatId, messageId }),
    onError: (error) =>
      toast.error(toUserMessage(error, { fallback: "Couldn't keep the chapter as it is. Try again." })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: chatKeys.messages(chatId) }),
  });
}

/** One extra's canon checkbox, or the "continues from" switch that sets all of chapter N's extras canon or none. */
export type FanficCanonChange = { messageId: string; canon: boolean } | { parentChapter: number; canon: boolean };

/** Marks extras canon or side stories; after a failure the reader shows the flags as they now read. */
export function useFanficExtraCanon(chatId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { handlesOwnErrors: true },
    mutationFn: (change: FanficCanonChange) =>
      "messageId" in change
        ? setFanficExtraCanon(storageApi, chatId, change.messageId, change.canon)
        : setFanficChainCanon(storageApi, chatId, change.parentChapter, change.canon),
    onError: (error) =>
      toast.error(toUserMessage(error, { fallback: "Couldn't change which chapters are canon. Try again." })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: chatKeys.messages(chatId) }),
  });
}

/** Deletes a chapter as its delete plan says: an extra alone, or the last main chapter with its extras. */
export function useFanficDeleteChapter(chatId: string) {
  const queryClient = useQueryClient();
  const deleteMessages = useDeleteMessages(chatId);
  return useMutation({
    meta: { handlesOwnErrors: true },
    mutationFn: (messageId: string) =>
      deleteFanficChapter({ storage: storageApi, deleteMessages: deleteMessages.mutateAsync }, chatId, messageId),
    onError: (error) => toast.error(toUserMessage(error, { fallback: "Couldn't delete the chapter. Try again." })),
    // The flags may have been written even when the delete failed.
    onSettled: () => queryClient.invalidateQueries({ queryKey: chatKeys.messages(chatId) }),
  });
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

/**
 * Plans the fic (research first when the request asked for it) and reports which step is running. Planning runs on
 * the Fanfic planning helper route, else the fic's connection.
 */
export function useFanficOutline(chatId: string) {
  const queryClient = useQueryClient();
  const updateChat = useUpdateChat();
  const [phase, setPhase] = useState<FanficPlanningPhase | null>(null);
  const mutation = useMutation({
    meta: { handlesOwnErrors: true },
    mutationFn: ({ signal }: { signal?: AbortSignal }) =>
      planFanfic(
        { storage: storageApi, llm: llmApi, web: fanficResearchApi },
        { chatId },
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
      toast.error(toUserMessage(error, { fallback: "The outline couldn't be written. Try again." }));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: modelRoutingKeys.runs }),
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
    mutationFn: ({
      connectionId,
      rule,
      label,
    }: {
      connectionId: string | null;
      rule: FanficJudgeRule | null;
      label: string;
    }) => {
      const controller = new AbortController();
      controllerRef.current = controller;
      return runFanficQualityCheck(
        { storage: storageApi, llm: llmApi },
        { chatId, connectionId, rule, label },
        { signal: controller.signal, onPhase: setPhase },
      ).finally(() => {
        setPhase(null);
        if (controllerRef.current === controller) controllerRef.current = null;
      });
    },
    onSuccess: refresh,
    onError: (error) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error(toUserMessage(error, { fallback: "The quality check couldn't finish. Try again." }));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: modelRoutingKeys.runs }),
  });
  const remove = useMutation({
    meta: { handlesOwnErrors: true },
    mutationFn: (runId: string) => deleteFanficQualityRun(storageApi, chatId, runId),
    onSettled: refresh,
    onError: (error) => toast.error(toUserMessage(error, { fallback: "Couldn't delete that run. Try again." })),
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

/**
 * Keeps the story ledger current; one per open fic so the reader panel and after-chapter updates share progress. Runs
 * on the Fanfic checks helper route, else the fic's connection.
 */
export function useFanficLedger(chatId: string): FanficLedgerController {
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
        { chatId, onlyIfInUse: quiet },
        { signal: controller.signal, onProgress: setProgress },
      )
        .catch((error: unknown) => {
          if (isAbort(error)) return;
          const message = toUserMessage(error, { fallback: "The story ledger couldn't update. Try again." });
          if (quiet) toast.warning(`Story ledger not updated: ${message}`);
          else toast.error(message);
        })
        .finally(() => {
          if (controllerRef.current === controller) controllerRef.current = null;
          setRunning(false);
          setProgress(null);
          void queryClient.invalidateQueries({ queryKey: chatKeys.detail(chatId) });
          void queryClient.invalidateQueries({ queryKey: modelRoutingKeys.runs });
        });
    },
    [chatId, queryClient],
  );
  const stop = useCallback(() => controllerRef.current?.abort(), []);
  useEffect(() => () => controllerRef.current?.abort(), [chatId]);
  return { update, stop, running, progress };
}

interface FanficChapterCheckResult {
  messageId: string;
  textKey: string;
  issues: Array<{ fix: FanficContinuityFix | null }>;
  /** The model that wrote the fixes; the version they save credits it. */
  model: FanficModelRecord;
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
          if (!isAbort(error)) toast.error(toUserMessage(error, { fallback: `${copy.failed} Try again.` }));
        })
        .finally(() => {
          if (controllerRef.current === controller) controllerRef.current = null;
          setRunning(null);
          setPhase(null);
          // A continuity check can update the ledger first.
          void queryClient.invalidateQueries({ queryKey: chatKeys.detail(chatId) });
          void queryClient.invalidateQueries({ queryKey: modelRoutingKeys.runs });
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
        toast.error(toUserMessage(error, { fallback: "Couldn't save the fix. Try again." }));
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

/** Per-chapter continuity checks for the open fic, kept while the reader is open; on the Fanfic checks route. */
export function useFanficContinuity(chatId: string): FanficContinuityController {
  const run = useCallback(
    (messageId: string, signal: AbortSignal, onPhase: (phase: FanficContinuityPhase) => void) =>
      checkFanficChapterContinuity({ storage: storageApi, llm: llmApi }, { chatId, messageId }, { signal, onPhase }),
    [chatId],
  );
  return useFanficChapterCheck(chatId, run, CONTINUITY_COPY);
}

export type FanficVoiceCheckController = FanficChapterCheckController<FanficChapterVoiceCheck, FanficVoiceCheckPhase>;

/** Per-chapter out-of-character checks against the fic's voice sheets; on the Fanfic checks route. */
export function useFanficVoiceCheck(chatId: string): FanficVoiceCheckController {
  const run = useCallback(
    (messageId: string, signal: AbortSignal, onPhase: (phase: FanficVoiceCheckPhase) => void) =>
      checkFanficChapterVoice({ storage: storageApi, llm: llmApi }, { chatId, messageId }, { signal, onPhase }),
    [chatId],
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

/** Builds (or rebuilds) the fic's voice sheets, reporting the step; on the Fanfic planning route. */
export function useFanficVoices(chatId: string): FanficVoicesController {
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
      { chatId },
      { signal: controller.signal, onPhase: setPhase },
    )
      .then((result) => toast.success(voicesReadyMessage(result)))
      .catch((error: unknown) => {
        if (!isAbort(error))
          toast.error(toUserMessage(error, { fallback: "The voice sheets couldn't be written. Try again." }));
      })
      .finally(() => {
        if (controllerRef.current === controller) controllerRef.current = null;
        setRunning(false);
        setPhase(null);
        void queryClient.invalidateQueries({ queryKey: chatKeys.detail(chatId) });
        void queryClient.invalidateQueries({ queryKey: modelRoutingKeys.runs });
      });
  }, [chatId, queryClient]);
  const stop = useCallback(() => controllerRef.current?.abort(), []);
  useEffect(() => () => controllerRef.current?.abort(), [chatId]);
  return { build, stop, running, phase };
}

export interface FanficEditorController {
  /** Scores chapters without a current report, or the ones named. */
  run: (messageIds?: string[]) => void;
  /** `onDone` runs after the new version is saved (the reader then checks its continuity). */
  rewrite: (report: FanficEditorReport, onDone?: () => void) => void;
  stop: () => void;
  /** "pass" while scoring, the chapter's message id while rewriting it. */
  running: "pass" | string | null;
  progress: FanficLedgerProgress | null;
}

/**
 * The editor pass and its scene rewrites for the open fic; one job at a time. The pass runs on the Fanfic checks
 * route; rewrites are writing, so they stay on the fic's connection.
 */
export function useFanficEditor(chatId: string): FanficEditorController {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState<"pass" | string | null>(null);
  const [progress, setProgress] = useState<FanficLedgerProgress | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const start = useCallback(
    (label: "pass" | string, job: (signal: AbortSignal) => Promise<string | null>, failed: string) => {
      if (controllerRef.current) return;
      const controller = new AbortController();
      controllerRef.current = controller;
      setRunning(label);
      void job(controller.signal)
        .then((message) => {
          if (message) toast.success(message);
        })
        .catch((error: unknown) => {
          if (!isAbort(error))
            toast.error(toUserMessage(error, { fallback: `${failed.replace(/\.$/, "")}. Try again.` }));
        })
        .finally(() => {
          if (controllerRef.current === controller) controllerRef.current = null;
          setRunning(null);
          setProgress(null);
          void queryClient.invalidateQueries({ queryKey: chatKeys.detail(chatId) });
          void queryClient.invalidateQueries({ queryKey: chatKeys.messages(chatId) });
          void queryClient.invalidateQueries({ queryKey: modelRoutingKeys.runs });
        });
    },
    [chatId, queryClient],
  );

  const run = useCallback(
    (messageIds?: string[]) =>
      start(
        "pass",
        async (signal) => {
          await runFanficEditorPass(
            { storage: storageApi, llm: llmApi },
            { chatId, messageIds },
            { signal, onProgress: setProgress },
          );
          return null;
        },
        "The editor pass failed.",
      ),
    [chatId, start],
  );

  const rewrite = useCallback(
    (report: FanficEditorReport, onDone?: () => void) =>
      start(
        report.messageId,
        async (signal) => {
          const { rewritten, skipped, label } = await rewriteFanficFlaggedScenes(
            { storage: storageApi, llm: llmApi },
            { chatId, report },
            { signal, onProgress: setProgress },
          );
          await queryClient.invalidateQueries({ queryKey: chatKeys.messages(chatId) });
          onDone?.();
          const left = skipped ? ` (${skipped} couldn't be found)` : "";
          return `Rewrote ${rewritten} ${rewritten === 1 ? "scene" : "scenes"} in chapter ${label}${left}. Saved as a new version; checking it against the rest of the story now.`;
        },
        "The rewrite failed.",
      ),
    [chatId, queryClient, start],
  );

  const stop = useCallback(() => controllerRef.current?.abort(), []);
  useEffect(() => () => controllerRef.current?.abort(), [chatId]);
  return { run, rewrite, stop, running, progress };
}

export interface FanficPlanController {
  /** Re-plans from what's written; `quiet` (after each chapter) reports failures as a warning. */
  propose: (options?: { steer?: string; quiet?: boolean }) => void;
  stop: () => void;
  running: boolean;
  /** Drops the stored suggestion. */
  dismiss: () => Promise<void>;
}

/** The living outline: suggestions for the rest of the plan, made after each chapter or on request (planning route). */
export function useFanficPlan(chatId: string): FanficPlanController {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const propose = useCallback(
    ({ steer = "", quiet = false }: { steer?: string; quiet?: boolean } = {}) => {
      if (controllerRef.current) return;
      const controller = new AbortController();
      controllerRef.current = controller;
      setRunning(true);
      void proposeFanficPlan({ storage: storageApi, llm: llmApi }, { chatId, steer }, { signal: controller.signal })
        .catch((error: unknown) => {
          if (isAbort(error)) return;
          const message = toUserMessage(error, { fallback: "The plan couldn't be updated. Try again." });
          if (quiet) toast.warning(`Plan not updated: ${message}`);
          else toast.error(message);
        })
        .finally(() => {
          if (controllerRef.current === controller) controllerRef.current = null;
          setRunning(false);
          void queryClient.invalidateQueries({ queryKey: chatKeys.detail(chatId) });
          void queryClient.invalidateQueries({ queryKey: modelRoutingKeys.runs });
        });
    },
    [chatId, queryClient],
  );
  const stop = useCallback(() => controllerRef.current?.abort(), []);
  useEffect(() => () => controllerRef.current?.abort(), [chatId]);
  const dismiss = useCallback(async () => {
    await clearFanficPlan(storageApi, chatId);
    await queryClient.invalidateQueries({ queryKey: chatKeys.detail(chatId) });
  }, [chatId, queryClient]);
  return { propose, stop, running, dismiss };
}

/** Whether the fic's connection can keep banned phrases out (the built-in local model or a llama.cpp server here). */
export function useFanficPhraseBanSupport(connectionId: string | null): boolean {
  const { data } = useConnection(connectionId);
  if (connectionId === LOCAL_SIDECAR_CONNECTION_ID) return true;
  return fanficConnectionSupportsPhraseBans(data ?? null);
}

export interface FanficPhraseBanController {
  supported: boolean;
  /** Takes banned phrases out of a chapter (default: the last one); `quiet` only speaks up when it changed something. */
  remove: (options?: { messageId?: string | null; quiet?: boolean }) => void;
  /** The chapter being cleaned, or "latest" while cleaning the newest one. */
  running: string | null;
  stop: () => void;
}

/** Phrase bans for local models: after each chapter, and on request per chapter. */
export function useFanficPhraseBans(chatId: string, connectionId: string | null): FanficPhraseBanController {
  const queryClient = useQueryClient();
  const supported = useFanficPhraseBanSupport(connectionId);
  const [running, setRunning] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const remove = useCallback(
    ({ messageId = null, quiet = false }: { messageId?: string | null; quiet?: boolean } = {}) => {
      if (controllerRef.current || !supported) return;
      const controller = new AbortController();
      controllerRef.current = controller;
      setRunning(messageId ?? "latest");
      void removeFanficBannedPhrasesFrom(
        { storage: storageApi, llm: llmApi },
        { chatId, messageId, connectionId },
        { signal: controller.signal },
      )
        .then(({ chapter, repaired, remaining }) => {
          const left = remaining ? ` ${remaining} couldn't be rewritten around.` : "";
          if (repaired > 0) {
            toast.success(
              `Kept ${repaired} banned ${repaired === 1 ? "phrase" : "phrases"} out of chapter ${chapter}. Saved as a new version.${left}`,
            );
          } else if (!quiet) {
            toast.message(
              remaining
                ? `Chapter ${chapter}: nothing could be changed.${left}`
                : `Chapter ${chapter} has no banned phrases.`,
            );
          }
        })
        .catch((error: unknown) => {
          if (isAbort(error)) return;
          const message = toUserMessage(error, { fallback: "The banned phrases couldn't be removed. Try again." });
          if (quiet) toast.warning(`Banned phrases not removed: ${message}`);
          else toast.error(message);
        })
        .finally(() => {
          if (controllerRef.current === controller) controllerRef.current = null;
          setRunning(null);
          void queryClient.invalidateQueries({ queryKey: chatKeys.messages(chatId) });
        });
    },
    [chatId, connectionId, queryClient, supported],
  );
  const stop = useCallback(() => controllerRef.current?.abort(), []);
  useEffect(() => () => controllerRef.current?.abort(), [chatId]);
  return { supported, remove, running, stop };
}
