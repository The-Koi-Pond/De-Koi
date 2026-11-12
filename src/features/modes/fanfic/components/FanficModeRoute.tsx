import { readFanficDraftRequest } from "../../../../engine/modes/fanfic/from-chat";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { toUserMessage } from "../../../../shared/lib/error-message";
import { useUpdateChatMetadata } from "../../../catalog/chats/index";
import type { FanficOutline, FanficState, FanficVoiceSheet } from "../../../../engine/contracts/types/fanfic";
import { applyFanficPlan, type FanficPlanProposal } from "../../../../engine/modes/fanfic/plan";
import { fanficVoiceCharacters, withFanficVoices } from "../../../../engine/modes/fanfic/voices";
import { approveFanficOutline, editFanficOutline } from "../../../../engine/modes/fanfic/outline";
import { withFanficResearchNotes } from "../../../../engine/modes/fanfic/research";
import { defaultFanficRequest, fanficStage } from "../../../../engine/modes/fanfic/request";
import { useChatStore } from "../../../../shared/stores/chat.store";
import { HelperRunNote } from "../../../catalog/connections/index";
import { isReportedGenerationFailure } from "../../../runtime/generation/index";
import { fanficFollowUps, type FanficFinishedChapter } from "../lib/write-outcome";
import {
  useFanficChat,
  useFanficGenerationState,
  useFanficEditor,
  useFanficLedger,
  useFanficPhraseBans,
  useFanficPlan,
  useFanficVoices,
  useFanficOutline,
  useFanficRequestSave,
  useFanficWriter,
  useFanficRunnerReattach,
  nextFanficWrite,
  type FanficWriteArgs,
} from "../hooks/use-fanfic";
import { FanficOutlineReview, FanficPlanning } from "./FanficOutlineView";
import { FanficVoicesPanel } from "./FanficVoicesPanel";
import { FanficReader } from "./FanficReader";
import { FanficRequestForm, fanficPickedLorebookIds, type FanficRequestSubmit } from "./FanficRequestForm";
import { useDiscardUntouchedNewChat } from "../../shared/chat-ui/new-chat-drafts";

export interface FanficModeRouteProps {
  activeChatId: string;
}

const PLANNING_NOTE = "mt-1 text-xs leading-snug text-[var(--muted-foreground)]";

function errorText(error: unknown, fallback = "That didn't work. Try again."): string | null {
  if (!error) return null;
  if (error instanceof DOMException && error.name === "AbortError") return null;
  return toUserMessage(error, { fallback });
}

export function FanficModeRoute({ activeChatId }: FanficModeRouteProps) {
  const { chat, state, chapters, isLoading, messagesComplete, error } = useFanficChat(activeChatId);
  const generation = useFanficGenerationState(activeChatId);
  const updateMetadata = useUpdateChatMetadata();
  const saveRequest = useFanficRequestSave(activeChatId);
  const outline = useFanficOutline(activeChatId);
  const connectionId = chat?.connectionId ?? null;
  const write = useFanficWriter(activeChatId, connectionId);
  // Helpers pick their own connection (Helper Models route, else the fic's); only the writer takes the fic's here.
  const ledger = useFanficLedger(activeChatId);
  const { update: updateLedger } = ledger;
  const voices = useFanficVoices(activeChatId);
  const editor = useFanficEditor(activeChatId);
  const plan = useFanficPlan(activeChatId);
  const { propose: proposePlan } = plan;
  const phraseBans = useFanficPhraseBans(activeChatId, connectionId);
  const { remove: removeBannedPhrases, supported: bansSupported } = phraseBans;
  const [editingRequest, setEditingRequest] = useState(false);
  const outlineAbort = useRef<AbortController | null>(null);
  const lastWrite = useRef<FanficWriteArgs>({ kind: "chapter" });
  const stage = fanficStage(state);

  useEffect(() => {
    if (chat) useChatStore.getState().setActiveChat(chat);
  }, [chat]);

  // Started with New and left on the request form with nothing saved (no request, cast, lorebooks or chapters): drop it.
  useDiscardUntouchedNewChat(
    activeChatId,
    !isLoading &&
      !!chat &&
      messagesComplete &&
      stage === "request" &&
      chapters.length === 0 &&
      !saveRequest.isPending &&
      (chat.characterIds?.length ?? 0) === 0 &&
      readFanficDraftRequest(chat.metadata) === null &&
      fanficPickedLorebookIds(chat.metadata).length === 0,
  );

  // The reader streams a continue after the chapter's text so far instead of as a new chapter.
  const [continuing, setContinuing] = useState<{ messageId: string; textSoFar: string } | null>(null);
  // A new extra streams after its main chapter's chain, not as the next chapter.
  const [writingExtraAfter, setWritingExtraAfter] = useState<number | null>(null);
  const chaptersRef = useRef(chapters);
  useEffect(() => {
    chaptersRef.current = chapters;
  }, [chapters]);
  // Once a chapter is finished (written, continued, reset, kept as is or polished), the same follow-ups run for its kind.
  const afterChapterFinished = useCallback(
    (chapter: FanficFinishedChapter, options: { batch?: boolean; polish?: boolean; polishNext?: boolean } = {}) => {
      const followUps = fanficFollowUps(chapter, {
        polish: options.polish === true,
        polishNext: options.polishNext === true,
      });
      // Local models: keep the fic's banned phrases out of what was just written (backtrack and resample).
      if (bansSupported && followUps.phraseBansFor) {
        removeBannedPhrases({ messageId: followUps.phraseBansFor, quiet: true });
      }
      // Keep the story ledger current behind the scenes; it skips itself while the fic doesn't need one.
      if (followUps.updateLedger) updateLedger({ quiet: true });
      // Living outline: after each new chapter, check the rest of the plan against what was written. A "write all"
      // run follows the outline as it is, so it skips the proposals nobody is there to use.
      if (followUps.proposePlan && !options.batch) proposePlan({ quiet: true });
    },
    [bansSupported, proposePlan, removeBannedPhrases, updateLedger],
  );
  // "Write all": set while a run of chapters is going. A Stop ends the whole run and skips the chapter's polish, not
  // just the write on screen.
  const [batchRunning, setBatchRunning] = useState(false);
  const followUpsStopped = useRef(false);
  // The chapter the auto-polish is working on: the reader keeps showing it as written until the polished one lands.
  const [polishing, setPolishing] = useState<string | null>(null);
  const writeChapterRef = useRef<(args: FanficWriteArgs) => void>(() => {});
  // One write at a time: a reattach when the tab wakes between two chapters of a run must not race the run's own
  // next write (the generation hook would refuse the second, but its settle would clear the first one's state).
  const writeInFlight = useRef(false);
  // One write; it goes on by itself to the chapter's polish, and in a "write all" run to the next chapter (see
  // nextFanficWrite).
  const writeChapter = useCallback(
    (args: FanficWriteArgs) => {
      if (writeInFlight.current) return;
      writeInFlight.current = true;
      // Retrying a write followed from the server starts a new one of the same kind.
      const { runnerJobId: _followed, ...retry } = args;
      lastWrite.current = retry;
      const batch = args.batch === true;
      setBatchRunning(batch);
      const continued =
        args.kind === "continue" ? chaptersRef.current.find((chapter) => chapter.message.id === args.messageId) : null;
      setContinuing(continued ? { messageId: continued.message.id, textSoFar: continued.message.content } : null);
      setWritingExtraAfter(args.kind === "extra" && !args.messageId ? (args.parentChapter ?? null) : null);
      setPolishing(args.kind === "polish" ? (args.messageId ?? null) : null);
      void write(args)
        .then(async (finished) => {
          if (!finished) return null;
          let next: FanficWriteArgs | null = null;
          try {
            next = await nextFanficWrite(activeChatId, followUpsStopped.current, args, finished);
          } catch (error) {
            toast.error(
              toUserMessage(error, {
                fallback: batch
                  ? "Couldn't start the next chapter. Write it from the button below to carry on."
                  : "Couldn't start polishing the chapter. Its Check buttons still work.",
              }),
            );
          }
          afterChapterFinished(finished, {
            batch,
            polish: args.kind === "polish",
            polishNext: next?.kind === "polish",
          });
          return next;
        })
        .catch((error: unknown) => {
          // The write's own failures are already on screen, and a Stop needs no message.
          if (isReportedGenerationFailure(error) || (error instanceof Error && error.name === "AbortError")) {
            return null;
          }
          toast.error(toUserMessage(error, { fallback: "That write didn't finish. Try again." }));
          return null;
        })
        .then((next) => {
          writeInFlight.current = false;
          setContinuing(null);
          setWritingExtraAfter(null);
          setPolishing(null);
          if (next) writeChapterRef.current(next);
          else setBatchRunning(false);
        });
    },
    [activeChatId, afterChapterFinished, write],
  );
  useEffect(() => {
    writeChapterRef.current = writeChapter;
  }, [writeChapter]);
  // Every write the reader (or a reattach) starts; one the requester starts clears an earlier Stop.
  const runWrite = useCallback(
    (args: FanficWriteArgs) => {
      if (!args.runnerJobId) followUpsStopped.current = false;
      writeChapter(args);
    },
    [writeChapter],
  );
  const { stop: stopGeneration } = generation;
  const stopWrite = useCallback(() => {
    followUpsStopped.current = true;
    stopGeneration();
  }, [stopGeneration]);
  // A chapter still being written on the server (the phone slept or the tab closed mid-write) streams here again.
  useFanficRunnerReattach(activeChatId, messagesComplete && stage === "writing", runWrite);

  const chapterCount = useRef(chapters.length);
  useEffect(() => {
    chapterCount.current = chapters.length;
  }, [chapters.length]);
  const startOutline = useCallback(() => {
    outlineAbort.current?.abort();
    const controller = new AbortController();
    outlineAbort.current = controller;
    outline.mutate(
      { signal: controller.signal },
      {
        // With outline review skipped the plan arrives approved: go straight to chapter 1.
        onSuccess: (planned) => {
          if (planned.outlineApproved && chapterCount.current === 0) runWrite({ kind: "chapter" });
        },
      },
    );
  }, [outline, runWrite]);

  // The only place planning starts: a saved request with no outline yet (fresh submit, or a reload
  // mid-plan) plans once per submit. It waits for the request save, so the planner reads the new request.
  const [planToken, setPlanToken] = useState(0);
  const planningStartedFor = useRef<string | null>(null);
  const savingRequest = saveRequest.isPending;
  useEffect(() => {
    if (stage !== "outline" || editingRequest || savingRequest || outline.isPending || outline.isError) return;
    const key = `${activeChatId}:${planToken}`;
    if (planningStartedFor.current === key) return;
    planningStartedFor.current = key;
    startOutline();
  }, [activeChatId, editingRequest, outline.isError, outline.isPending, planToken, savingRequest, stage, startOutline]);

  useEffect(() => () => outlineAbort.current?.abort(), []);

  const saveState = (next: FanficState) => updateMetadata.mutateAsync({ id: activeChatId, fanfic: next });

  // Planning starts from the effect above once the saved request is back in the chat cache.
  const submitRequest = (value: FanficRequestSubmit) => {
    outlineAbort.current?.abort();
    outline.reset();
    saveRequest.mutate(value, {
      onSuccess: () => {
        setPlanToken((token) => token + 1);
        setEditingRequest(false);
      },
    });
  };

  const approveOutline = async (approved: FanficOutline, researchNotes: string | null) => {
    if (!state) return;
    let next: FanficState;
    try {
      next = withFanficResearchNotes(approveFanficOutline(state, approved), researchNotes);
    } catch {
      toast.error("Give every chapter a title or some beats before writing.");
      return;
    }
    try {
      await saveState(next);
    } catch (error) {
      const text = errorText(error, "Couldn't save the outline. Try again.");
      if (text) toast.error(text);
      return;
    }
    if (chapters.length === 0) runWrite({ kind: "chapter" });
  };

  const saveVoices = async (sheets: FanficVoiceSheet[]) => {
    if (!state) return;
    try {
      await saveState(withFanficVoices(state, sheets));
      toast.success("Voice sheets saved. The next chapter uses them.");
    } catch (error) {
      const text = errorText(error, "Couldn't save the voice sheets. Try again.");
      if (text) toast.error(text);
    }
  };

  const saveOutline = async (edited: FanficOutline): Promise<boolean> => {
    if (!state) return false;
    let next: FanficState;
    try {
      next = editFanficOutline(state, edited);
    } catch {
      toast.error("Give every chapter a title or some beats before saving.");
      return false;
    }
    try {
      await saveState(next);
      toast.success("Outline saved. The next chapter follows it.");
      return true;
    } catch (error) {
      const text = errorText(error, "Couldn't save the outline. Try again.");
      if (text) toast.error(text);
      return false;
    }
  };

  const applyPlanProposal = async (proposal: FanficPlanProposal) => {
    if (!state) return;
    try {
      await saveState(applyFanficPlan(state, proposal));
      await plan.dismiss();
      toast.success("The outline is updated. The next chapter follows the new plan.");
    } catch (error) {
      const text = errorText(error, "Couldn't save the new plan. Try again.");
      if (text) toast.error(text);
    }
  };

  const saveBannedPhrases = async (phrases: string[] | null) => {
    if (!state) return;
    const { bannedPhrases: _previous, ...rest } = state;
    try {
      await saveState(phrases ? { ...rest, bannedPhrases: phrases } : rest);
      toast.success(phrases ? "Banned phrases saved." : "Back to the default banned phrases.");
    } catch (error) {
      const text = errorText(error, "Couldn't save the banned phrases. Try again.");
      if (text) toast.error(text);
    }
  };

  const replan = () => {
    outline.reset();
    startOutline();
  };

  if (error && !chat) {
    return (
      <div role="alert" className="flex flex-1 items-center justify-center p-6 text-sm text-[var(--muted-foreground)]">
        {errorText(error, "This fic couldn't be opened. Go back to the chat list and open it again.")}
      </div>
    );
  }

  if (isLoading || !chat || !messagesComplete) {
    return (
      <div className="flex flex-1 items-center justify-center p-6" role="status" aria-label="Opening fic">
        <Loader2 size="1.5rem" className="animate-spin text-[var(--primary)]" aria-hidden="true" />
      </div>
    );
  }

  const showForm = stage === "request" || editingRequest;
  const planning = !showForm && (stage === "outline" || outline.isPending);

  return (
    <div
      data-component="FanficModeRoute"
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-3 py-3 sm:px-5 sm:py-5"
    >
      {showForm ? (
        <FanficRequestForm
          chatId={activeChatId}
          chatPersonaId={chat.personaId ?? null}
          initialRequest={state?.request ?? readFanficDraftRequest(chat.metadata) ?? defaultFanficRequest()}
          initialConnectionId={connectionId}
          initialCharacterIds={Array.isArray(chat.characterIds) ? chat.characterIds : []}
          initialLorebookIds={fanficPickedLorebookIds(chat.metadata)}
          submitting={saveRequest.isPending}
          submitError={errorText(saveRequest.error, "Couldn't save the request. Try again.")}
          onSubmit={submitRequest}
          onCancel={editingRequest && state?.outline ? () => setEditingRequest(false) : undefined}
        />
      ) : planning || !state ? (
        <FanficPlanning
          phase={outline.phase}
          error={errorText(outline.error, "The outline couldn't be written. Try again.")}
          onRetry={replan}
          onCancel={() => {
            outlineAbort.current?.abort();
            setEditingRequest(true);
          }}
          onEditRequest={() => setEditingRequest(true)}
        />
      ) : stage === "outline_review" && state.outline ? (
        <FanficOutlineReview
          key={JSON.stringify(state.outline)}
          outline={state.outline}
          research={state.research}
          voicesPanel={
            <FanficVoicesPanel
              voices={state.voices ?? []}
              controller={voices}
              canBuild={fanficVoiceCharacters(state.request).length > 0}
              busy={updateMetadata.isPending}
              onSave={saveVoices}
              helperNote={
                <HelperRunNote
                  task="fanficPlanning"
                  job="voice sheets"
                  chatId={activeChatId}
                  className="text-[0.6875rem] leading-snug text-[var(--muted-foreground)]"
                />
              }
            />
          }
          helperNote={
            <>
              <HelperRunNote task="fanficPlanning" job="research" chatId={activeChatId} className={PLANNING_NOTE} />
              <HelperRunNote task="fanficPlanning" job="outline" chatId={activeChatId} className={PLANNING_NOTE} />
            </>
          }
          saving={updateMetadata.isPending}
          onApprove={(approved, notes) => void approveOutline(approved, notes)}
          onReplan={replan}
          onEditRequest={() => setEditingRequest(true)}
        />
      ) : (
        <FanficReader
          chatId={activeChatId}
          chatName={chat.name}
          state={state}
          chapters={chapters}
          generating={generation.generating}
          streamText={generation.streamText}
          phase={generation.phase}
          regeneratingMessageId={generation.regeneratingMessageId}
          continuing={continuing}
          polishing={polishing}
          writingExtraAfter={writingExtraAfter}
          onWrite={runWrite}
          onChapterFinished={afterChapterFinished}
          onRetry={() => runWrite(lastWrite.current)}
          onStop={stopWrite}
          batchRunning={batchRunning}
          ledger={ledger}
          voices={voices}
          onSaveVoices={saveVoices}
          onSaveOutline={saveOutline}
          editor={editor}
          plan={plan}
          phraseBans={phraseBans}
          onSaveBannedPhrases={saveBannedPhrases}
          onUsePlan={applyPlanProposal}
        />
      )}
    </div>
  );
}
