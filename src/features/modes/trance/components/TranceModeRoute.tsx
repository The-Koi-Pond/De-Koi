import { useEffect, useMemo, useState } from "react";
import { Loader2, Orbit, Play, RefreshCw, SlidersHorizontal } from "lucide-react";
import { useCharacterSummariesByIds } from "../../../catalog/characters/index";
import type { TranceAfter, TranceFinish, TranceState } from "../../../../engine/contracts/types/trance";
import {
  TRANCE_ENDING_LABELS,
  defaultTranceRequest,
  tranceEstimatedMinutes,
  tranceStage,
  tranceTagSummary,
} from "../../../../engine/modes/trance/request";
import { toUserMessage } from "../../../../shared/lib/error-message";
import { useChatStore } from "../../../../shared/stores/chat.store";
import { useTranceChat, useTranceRecordRun, useTranceRequestSave, useTranceScript } from "../hooks/use-trance";
import { TrancePlayer } from "./TrancePlayer";
import { TranceRequestForm, type TranceRequestSubmit } from "./TranceRequestForm";

export interface TranceModeRouteProps {
  activeChatId: string;
}

function errorText(error: unknown, fallback: string): string | null {
  if (!error) return null;
  if (error instanceof DOMException && error.name === "AbortError") return null;
  return toUserMessage(error, { fallback });
}

const FINISH_LABELS: Record<TranceFinish, string> = {
  completed: "Finished",
  gentle: "Woke early",
  calm: "Left through the calm exit",
  stop: "Stopped",
};

function PastRuns({ state }: { state: TranceState }) {
  if (state.runs.length === 0) return null;
  return (
    <section className="w-full rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
      <h3 className="mb-2 text-sm font-bold text-[var(--foreground)]">Past runs</h3>
      <ul className="flex flex-col gap-2">
        {state.runs.slice(0, 5).map((run) => (
          <li key={run.at} className="text-sm text-[var(--foreground)]">
            <span className="font-semibold">{FINISH_LABELS[run.finishedBy]}</span>
            {run.rating !== null && <span className="text-[var(--muted-foreground)]"> · felt {run.rating}/10</span>}
            {run.fullyAwake === false && <span className="text-[var(--muted-foreground)]"> · needed waking more</span>}
            {run.seconds !== null && (
              <span className="text-[var(--muted-foreground)]">
                {" "}
                · took {Math.max(1, Math.round(run.seconds / 60))} min
              </span>
            )}
            {run.at && <span className="text-[var(--muted-foreground)]"> · {new Date(run.at).toLocaleString()}</span>}
            {run.note && <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{run.note}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function TranceModeRoute({ activeChatId }: TranceModeRouteProps) {
  const { chat, state, isLoading, error } = useTranceChat(activeChatId);
  const saveRequest = useTranceRequestSave(activeChatId);
  const script = useTranceScript(activeChatId);
  const recordRun = useTranceRecordRun(activeChatId);
  const [editing, setEditing] = useState(false);
  const [playing, setPlaying] = useState(false);
  const stage = tranceStage(state);
  const characterIds = useMemo(() => chat?.characterIds ?? [], [chat?.characterIds]);
  const { data: characterRows } = useCharacterSummariesByIds(characterIds.slice(0, 1), characterIds.length > 0);
  const characterName =
    (characterRows as Array<{ data?: { name?: string } }> | undefined)?.[0]?.data?.name?.trim() || "Your guide";

  useEffect(() => {
    if (chat) useChatStore.getState().setActiveChat(chat);
  }, [chat]);

  // New-chat setup opens the shared settings drawer and wizard in other modes; here the session form is the setup.
  useEffect(() => {
    useChatStore.getState().consumeNewChatSetupIntent(activeChatId);
  }, [activeChatId]);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-[var(--muted-foreground)]">
        <Loader2 className="animate-spin" aria-hidden="true" />
        <span className="sr-only">Loading the session</span>
      </div>
    );
  }
  if (error || !chat) {
    return (
      <p role="alert" className="p-6 text-sm text-[var(--foreground)]">
        {errorText(error, "This session couldn't be loaded.") ?? "This session couldn't be loaded."}
      </p>
    );
  }

  if (playing && state?.script) {
    // The session covers the whole app: one line on a quiet screen, nothing else to read.
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Trance session"
        className="fixed inset-0 z-[100] flex flex-col overflow-y-auto pt-[env(safe-area-inset-top)]"
      >
        <TrancePlayer
          key={state.script.createdAt}
          script={state.script}
          ending={state.request.ending}
          saving={recordRun.isPending}
          saveError={errorText(recordRun.error, "That couldn't be saved. Try again.")}
          onFinish={(after: TranceAfter) => recordRun.mutate(after, { onSuccess: () => setPlaying(false) })}
        />
      </div>
    );
  }

  const submit = (input: TranceRequestSubmit) => {
    script.reset();
    saveRequest.mutate(
      { request: input.request, connectionId: input.connectionId, characterId: input.characterId },
      {
        onSuccess: () => {
          setEditing(false);
          script.mutate();
        },
      },
    );
  };

  if (stage === "request" || editing) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <TranceRequestForm
          initial={state?.request ?? defaultTranceRequest()}
          initialCharacterId={characterIds[0] ?? null}
          initialConnectionId={chat.connectionId ?? null}
          submitting={saveRequest.isPending}
          error={errorText(saveRequest.error, "The session couldn't be saved. Try again.")}
          onSubmit={submit}
          initialPath={stage === "request" ? null : "build"}
          onCancel={stage === "request" ? undefined : () => setEditing(false)}
        />
      </div>
    );
  }

  const request = state!.request;
  const writeError = errorText(script.error, "The session couldn't be written. Try again.");
  const minutes = state?.script ? tranceEstimatedMinutes(state.script.lines.length) : request.minutes;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 px-4 py-8 text-center">
        <Orbit size="2rem" className="text-[var(--primary)]" aria-hidden="true" />
        <div>
          <h2 className="text-lg font-bold text-[var(--foreground)]">{request.pitch?.title ?? characterName}</h2>
          {request.pitch && <p className="text-sm text-[var(--muted-foreground)]">with {characterName}</p>}
          {request.pitch?.summary && (
            <p className="mx-auto mt-1 max-w-md text-sm text-[var(--foreground)]">{request.pitch.summary}</p>
          )}
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {tranceTagSummary(request)} · about {minutes} min · {TRANCE_ENDING_LABELS[request.ending]}
          </p>
        </div>

        {script.isPending ? (
          <div className="flex flex-col items-center gap-3 py-4" role="status">
            <Loader2 className="animate-spin text-[var(--primary)]" aria-hidden="true" />
            <p className="text-sm text-[var(--foreground)]">Writing your session…</p>
            <p className="text-xs text-[var(--muted-foreground)]">
              Get comfortable. Longer sessions take a little longer to write.
            </p>
            <button
              type="button"
              onClick={script.stop}
              className="rounded-lg px-3 py-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              Stop
            </button>
          </div>
        ) : stage === "ready" ? (
          <>
            <p className="max-w-md text-sm text-[var(--muted-foreground)]">
              Settle in somewhere comfortable. Read each line as it comes and press the button (or Space) to go on.{" "}
              <strong className="font-semibold text-[var(--foreground)]">I need out</strong> is always at the top if you
              want to stop.
            </p>
            <button
              type="button"
              onClick={() => {
                recordRun.reset();
                setPlaying(true);
              }}
              className="inline-flex items-center gap-2 rounded-full bg-[var(--primary)] px-8 py-3 text-base font-semibold text-[var(--primary-foreground)]"
            >
              <Play size="1.125rem" aria-hidden="true" />
              Start
            </button>
          </>
        ) : (
          <div className="flex flex-col items-center gap-3 py-2">
            {writeError ? (
              <p role="alert" className="text-sm text-[var(--foreground)]">
                {writeError}
              </p>
            ) : (
              <p className="text-sm text-[var(--muted-foreground)]">This session hasn't been written yet.</p>
            )}
            <button
              type="button"
              onClick={() => script.mutate()}
              className="rounded-full bg-[var(--primary)] px-6 py-2.5 text-sm font-semibold text-[var(--primary-foreground)]"
            >
              Write the session
            </button>
          </div>
        )}

        {!script.isPending && (
          <div className="flex flex-wrap justify-center gap-2">
            {stage === "ready" && (
              <button
                type="button"
                onClick={() => script.mutate()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--foreground)]"
              >
                <RefreshCw size="0.875rem" aria-hidden="true" />
                New script, same settings
              </button>
            )}
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--foreground)]"
            >
              <SlidersHorizontal size="0.875rem" aria-hidden="true" />
              Change settings
            </button>
          </div>
        )}
        {stage === "ready" && writeError && (
          <p role="alert" className="text-sm text-[var(--foreground)]">
            {writeError}
          </p>
        )}
        {state && <PastRuns state={state} />}
      </div>
    </div>
  );
}
