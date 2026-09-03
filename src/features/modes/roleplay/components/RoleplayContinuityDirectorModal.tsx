import { ArrowDown, ArrowUp, Check, CirclePause, CircleX, Loader2, RefreshCw, RotateCcw, Sparkles } from "lucide-react";
import { toast } from "sonner";

import type {
  ContinuityDirectorBeat,
  ContinuityDirectorBeatStatus,
  ContinuityDirectorCommand,
  ContinuityDirectorThread,
  ContinuityDirectorThreadStatus,
  RoleplayContinuityDirectorState,
} from "../../../../engine/contracts/types/roleplay-continuity-director";
import { CONTINUITY_DIRECTOR_CADENCE_OPTIONS } from "../../../../engine/modes/roleplay/continuity-director/continuity-director-state";
import { Modal } from "../../../../shared/components/ui/Modal";
import { cn } from "../../../../shared/lib/utils";
import { useConnections } from "../../../catalog/connections";
import { useContinuityDirector } from "../hooks/use-continuity-director";

interface RoleplayContinuityDirectorModalProps {
  chatId: string;
  open: boolean;
  onClose: () => void;
}

const STATUS_LABELS: Record<ContinuityDirectorBeatStatus, string> = {
  proposed: "Proposed",
  approved: "Approved",
  deferred: "Deferred",
  rejected: "Rejected",
  fulfilled: "Fulfilled",
};

const THREAD_STATUS_LABELS: Record<ContinuityDirectorThreadStatus, string> = {
  open: "Open",
  deferred: "Deferred",
  resolved: "Resolved",
};

function statusTone(status: ContinuityDirectorBeatStatus): string {
  if (status === "approved") return "bg-emerald-500/12 text-emerald-300 ring-emerald-500/30";
  if (status === "proposed") return "bg-sky-500/12 text-sky-300 ring-sky-500/30";
  if (status === "fulfilled") return "bg-violet-500/12 text-violet-300 ring-violet-500/30";
  if (status === "rejected") return "bg-rose-500/10 text-rose-300 ring-rose-500/25";
  return "bg-amber-500/10 text-amber-300 ring-amber-500/25";
}

function errorText(error: unknown): string | null {
  return error instanceof Error ? error.message : error ? String(error) : null;
}

function ThreadCard({
  thread,
  disabled,
  onCommand,
}: {
  thread: ContinuityDirectorThread;
  disabled: boolean;
  onCommand: (command: ContinuityDirectorCommand) => void;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--secondary)]/35 p-2.5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="rounded-full bg-[var(--background)] px-2 py-0.5 text-[0.5625rem] font-semibold text-[var(--muted-foreground)] ring-1 ring-[var(--border)]">
          {THREAD_STATUS_LABELS[thread.status]}
        </span>
        {thread.source === "user" && (
          <span className="text-[0.5625rem] text-[var(--muted-foreground)]">User edited</span>
        )}
      </div>
      <input
        aria-label={`Edit ${thread.text}`}
        defaultValue={thread.text}
        maxLength={280}
        disabled={disabled}
        onBlur={(event) => {
          const text = event.currentTarget.value.trim();
          if (text && text !== thread.text) onCommand({ type: "edit_thread", threadId: thread.id, text });
        }}
        className="w-full rounded border border-transparent bg-transparent px-1 py-1 text-xs outline-none focus:border-[var(--ring)]"
      />
      {thread.status === "open" && (
        <div className="mt-1 flex gap-1.5">
          <button
            type="button"
            aria-label={`Defer ${thread.text}`}
            disabled={disabled}
            onClick={() => onCommand({ type: "set_thread_status", threadId: thread.id, status: "deferred" })}
            className="text-[0.5625rem] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            Defer
          </button>
          <button
            type="button"
            aria-label={`Resolve ${thread.text}`}
            disabled={disabled}
            onClick={() => onCommand({ type: "set_thread_status", threadId: thread.id, status: "resolved" })}
            className="text-[0.5625rem] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            Resolve
          </button>
        </div>
      )}
    </div>
  );
}

function BeatCard({
  beat,
  index,
  count,
  disabled,
  onCommand,
  onReroll,
}: {
  beat: ContinuityDirectorBeat;
  index: number;
  count: number;
  disabled: boolean;
  onCommand: (command: ContinuityDirectorCommand) => void;
  onReroll: (beatId: string) => void;
}) {
  const label = beat.text;
  return (
    <article className="group relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--secondary)]/45 p-3 shadow-sm">
      <div className="absolute inset-y-0 left-0 w-0.5 bg-[var(--primary)]/60" aria-hidden="true" />
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--background)] text-[0.625rem] font-semibold text-[var(--muted-foreground)] ring-1 ring-[var(--border)]">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span
              className={cn("rounded-full px-2 py-0.5 text-[0.5625rem] font-semibold ring-1", statusTone(beat.status))}
            >
              {STATUS_LABELS[beat.status]}
            </span>
            {beat.source === "user" && (
              <span className="rounded-full bg-[var(--background)] px-2 py-0.5 text-[0.5625rem] text-[var(--muted-foreground)] ring-1 ring-[var(--border)]">
                User edited
              </span>
            )}
          </div>
          <textarea
            key={`${beat.id}:${beat.updatedAt}`}
            aria-label={`Edit ${label}`}
            defaultValue={beat.text}
            maxLength={280}
            rows={2}
            disabled={disabled}
            onBlur={(event) => {
              const text = event.currentTarget.value.trim();
              if (text && text !== beat.text) onCommand({ type: "edit_beat", beatId: beat.id, text });
            }}
            className="min-h-14 w-full resize-y rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-xs leading-relaxed text-[var(--foreground)] outline-none transition-colors hover:border-[var(--border)] focus:border-[var(--ring)] focus:bg-[var(--background)] disabled:opacity-60"
          />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-8">
        {beat.status !== "approved" && beat.status !== "fulfilled" && (
          <button
            type="button"
            aria-label={`Approve ${label}`}
            disabled={disabled}
            onClick={() => onCommand({ type: "set_beat_status", beatId: beat.id, status: "approved" })}
            className="inline-flex items-center gap-1 rounded-md bg-emerald-500/12 px-2 py-1 text-[0.625rem] font-medium text-emerald-300 ring-1 ring-emerald-500/25 transition-colors hover:bg-emerald-500/20 disabled:opacity-40"
          >
            <Check size="0.7rem" aria-hidden="true" /> Approve
          </button>
        )}
        {beat.status === "approved" && (
          <button
            type="button"
            aria-label={`Fulfill ${label}`}
            disabled={disabled}
            onClick={() => onCommand({ type: "set_beat_status", beatId: beat.id, status: "fulfilled" })}
            className="inline-flex items-center gap-1 rounded-md bg-violet-500/12 px-2 py-1 text-[0.625rem] font-medium text-violet-300 ring-1 ring-violet-500/25 disabled:opacity-40"
          >
            <Check size="0.7rem" aria-hidden="true" /> Fulfilled
          </button>
        )}
        {beat.status !== "deferred" && beat.status !== "fulfilled" && (
          <button
            type="button"
            aria-label={`Defer ${label}`}
            disabled={disabled}
            onClick={() => onCommand({ type: "set_beat_status", beatId: beat.id, status: "deferred" })}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-[0.625rem] text-[var(--muted-foreground)] hover:bg-[var(--accent)] disabled:opacity-40"
          >
            <CirclePause size="0.7rem" aria-hidden="true" /> Defer
          </button>
        )}
        {beat.status !== "rejected" && beat.status !== "fulfilled" && (
          <button
            type="button"
            aria-label={`Reject ${label}`}
            disabled={disabled}
            onClick={() => onCommand({ type: "set_beat_status", beatId: beat.id, status: "rejected" })}
            className="inline-flex items-center gap-1 rounded-md border border-rose-500/25 px-2 py-1 text-[0.625rem] text-rose-300 hover:bg-rose-500/10 disabled:opacity-40"
          >
            <CircleX size="0.7rem" aria-hidden="true" /> Reject
          </button>
        )}
        {beat.status !== "fulfilled" && (
          <button
            type="button"
            aria-label={`Reroll ${label}`}
            disabled={disabled}
            onClick={() => onReroll(beat.id)}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-[0.625rem] text-[var(--muted-foreground)] hover:bg-[var(--accent)] disabled:opacity-40"
          >
            <RotateCcw size="0.7rem" aria-hidden="true" /> Reroll
          </button>
        )}
        <span className="ml-auto flex items-center gap-1">
          <button
            type="button"
            aria-label={`Move ${label} up`}
            disabled={disabled || index === 0}
            onClick={() => onCommand({ type: "move_beat", beatId: beat.id, direction: "up" })}
            className="de-koi-icon-target rounded-md text-[var(--muted-foreground)] hover:bg-[var(--accent)] disabled:opacity-25"
          >
            <ArrowUp size="0.75rem" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={`Move ${label} down`}
            disabled={disabled || index === count - 1}
            onClick={() => onCommand({ type: "move_beat", beatId: beat.id, direction: "down" })}
            className="de-koi-icon-target rounded-md text-[var(--muted-foreground)] hover:bg-[var(--accent)] disabled:opacity-25"
          >
            <ArrowDown size="0.75rem" aria-hidden="true" />
          </button>
        </span>
      </div>
    </article>
  );
}

export function RoleplayContinuityDirectorModal({ chatId, open, onClose }: RoleplayContinuityDirectorModalProps) {
  const director = useContinuityDirector(chatId);
  const connections = useConnections(open);
  const state = director.state;
  const pending = director.command.isPending || director.refresh.isPending || director.reroll.isPending;
  const visibleError =
    errorText(director.refresh.error) ||
    errorText(director.reroll.error) ||
    errorText(director.command.error) ||
    errorText(director.error);
  const openThreads = state?.openThreads.filter((thread) => thread.status === "open") ?? [];
  const threadHistory = state?.openThreads.filter((thread) => thread.status !== "open") ?? [];

  const command = (value: ContinuityDirectorCommand) => {
    if (!state) return;
    director.command.mutate(
      { command: value, expectedRevision: state.revision },
      {
        onError: (error) => toast.error(errorText(error) ?? "Continuity plan update failed."),
      },
    );
  };

  const reroll = (beatId: string) => {
    director.reroll.mutate(beatId, {
      onSuccess: () => toast.success("Fresh beat proposed for review."),
      onError: (error) => toast.error(errorText(error) ?? "Beat reroll failed."),
    });
  };

  return (
    <Modal open={open} onClose={onClose} title="Continuity Director" width="max-w-3xl">
      {director.isLoading ? (
        <div className="flex min-h-52 items-center justify-center gap-2 text-xs text-[var(--muted-foreground)]">
          <Loader2 size="1rem" className="animate-spin" aria-hidden="true" /> Loading continuity plan...
        </div>
      ) : !state ? (
        <div className="flex min-h-52 flex-col items-center justify-center gap-3 px-6 text-center">
          <p role="alert" className="text-xs text-rose-300">
            {visibleError ?? "Continuity plan could not be loaded."}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              aria-label="Retry loading continuity plan"
              onClick={() => void director.refetch()}
              className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)]"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted-foreground)]"
            >
              Close
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <section className="relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--secondary)]/45 p-4">
            <div className="relative flex flex-wrap items-start justify-between gap-3">
              <div className="max-w-xl">
                <div className="flex items-center gap-2">
                  <Sparkles size="0.9rem" className="text-[var(--primary)]" aria-hidden="true" />
                  <h3 className="text-xs font-semibold text-[var(--foreground)]">
                    Plan the story. Never commandeer the player.
                  </h3>
                </div>
                <p className="mt-1.5 text-[0.625rem] leading-relaxed text-[var(--muted-foreground)]">
                  Approved beats can guide future replies. Your newest message always wins, and the writer model still
                  owns the prose.
                </p>
              </div>
              <label className="flex cursor-pointer items-center gap-2 rounded-full bg-[var(--background)] px-3 py-1.5 text-[0.625rem] font-medium ring-1 ring-[var(--border)]">
                <input
                  type="checkbox"
                  checked={state.enabled}
                  disabled={pending}
                  onChange={(event) => command({ type: "set_enabled", enabled: event.currentTarget.checked })}
                  className="accent-[var(--primary)]"
                />
                {state.enabled ? "Enabled" : "Disabled"}
              </label>
            </div>

            <div className="relative mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <label className="grid gap-1 text-[0.625rem] font-medium text-[var(--muted-foreground)]">
                Planning model
                <select
                  aria-label="Continuity Director connection"
                  value={state.connectionId ?? ""}
                  disabled={pending}
                  onChange={(event) =>
                    command({ type: "set_connection", connectionId: event.currentTarget.value || null })
                  }
                  className="h-9 rounded-lg border border-[var(--input)] bg-[var(--background)] px-2.5 text-xs text-[var(--foreground)] outline-none focus:ring-1 focus:ring-[var(--ring)]"
                >
                  <option value="">Use chat model</option>
                  {(connections.data ?? []).map((connection) => (
                    <option key={connection.id} value={connection.id}>
                      {connection.name || connection.id}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                aria-label="Refresh continuity plan"
                disabled={!state.enabled || pending}
                onClick={() =>
                  director.refresh.mutate(undefined, {
                    onSuccess: (result) =>
                      toast.success(
                        result.rejectedUnsafeBeats > 0
                          ? `Plan refreshed. ${result.rejectedUnsafeBeats} unsafe beat${result.rejectedUnsafeBeats === 1 ? " was" : "s were"} discarded.`
                          : "Continuity plan refreshed.",
                      ),
                    onError: (error) => toast.error(errorText(error) ?? "Continuity plan refresh failed."),
                  })
                }
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 text-[0.6875rem] font-semibold text-[var(--primary-foreground)] shadow-sm transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {director.refresh.isPending ? (
                  <Loader2 size="0.75rem" className="animate-spin" />
                ) : (
                  <RefreshCw size="0.75rem" />
                )}
                {state.sourceSnapshot ? "Refresh plan" : "Create plan"}
              </button>
            </div>

            <div className="relative mt-3 grid gap-3 border-t border-[var(--border)]/60 pt-3 sm:grid-cols-2">
              <label className="grid gap-1 text-[0.625rem] font-medium text-[var(--muted-foreground)]">
                Automatic refresh
                <select
                  aria-label="Continuity Director refresh mode"
                  value={state.refreshMode}
                  disabled={pending}
                  onChange={(event) => {
                    const mode = event.currentTarget.value as RoleplayContinuityDirectorState["refreshMode"];
                    command({
                      type: "set_refresh_policy",
                      mode,
                      everyAssistantTurns: mode === "cadence" ? (state.refreshEveryAssistantTurns ?? 10) : null,
                    });
                  }}
                  className="h-9 rounded-lg border border-[var(--input)] bg-[var(--background)] px-2.5 text-xs text-[var(--foreground)] outline-none focus:ring-1 focus:ring-[var(--ring)]"
                >
                  <option value="manual">Manual only</option>
                  <option value="scene_events">After scene changes</option>
                  <option value="cadence">Every few assistant replies</option>
                </select>
              </label>
              {state.refreshMode === "cadence" && (
                <label className="grid gap-1 text-[0.625rem] font-medium text-[var(--muted-foreground)]">
                  Refresh frequency
                  <select
                    aria-label="Continuity Director cadence"
                    value={state.refreshEveryAssistantTurns ?? 10}
                    disabled={pending}
                    onChange={(event) =>
                      command({
                        type: "set_refresh_policy",
                        mode: "cadence",
                        everyAssistantTurns: Number(event.currentTarget.value),
                      })
                    }
                    className="h-9 rounded-lg border border-[var(--input)] bg-[var(--background)] px-2.5 text-xs text-[var(--foreground)] outline-none focus:ring-1 focus:ring-[var(--ring)]"
                  >
                    {CONTINUITY_DIRECTOR_CADENCE_OPTIONS.map((turns) => (
                      <option key={turns} value={turns}>
                        Every {turns} assistant replies
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <p className="text-[0.5625rem] leading-relaxed text-[var(--muted-foreground)] sm:col-span-2">
                {state.refreshMode === "manual"
                  ? "No background model calls. Refresh only when you ask."
                  : state.refreshMode === "scene_events"
                    ? "Runs a background planning call after a scene is created or concluded, only when the story sources changed."
                    : "Runs a background planning call at the selected low-frequency boundary. Replies never wait for it."}
              </p>
            </div>
          </section>

          {(director.isStale || director.sourceUnavailable || visibleError) && (
            <div className="rounded-lg border border-amber-500/25 bg-amber-500/8 px-3 py-2 text-[0.625rem] leading-relaxed text-amber-200">
              {visibleError
                ? visibleError
                : director.sourceUnavailable
                  ? "The latest story sources could not be checked. Your saved plan is still available."
                  : "Plan needs a refresh — the story has moved since these beats were proposed."}
            </div>
          )}

          <section className="grid gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
                Current arc
              </h3>
              {state.currentArc?.source === "user" && (
                <span className="text-[0.5625rem] text-[var(--muted-foreground)]">User edited</span>
              )}
            </div>
            <textarea
              key={state.currentArc?.updatedAt ?? "empty-arc"}
              aria-label="Current story arc"
              defaultValue={state.currentArc?.text ?? ""}
              placeholder="Create a plan to establish the current arc."
              maxLength={600}
              rows={3}
              disabled={pending}
              onBlur={(event) => {
                const text = event.currentTarget.value.trim();
                if (text !== (state.currentArc?.text ?? "")) command({ type: "edit_arc", text });
              }}
              className="w-full resize-y rounded-xl border border-[var(--input)] bg-[var(--background)] px-3 py-2.5 text-xs leading-relaxed outline-none focus:ring-1 focus:ring-[var(--ring)] disabled:opacity-60"
            />
          </section>

          {openThreads.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
                Open threads
              </h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {openThreads.map((thread) => (
                  <ThreadCard key={thread.id} thread={thread} disabled={pending} onCommand={command} />
                ))}
              </div>
            </section>
          )}

          {threadHistory.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
                Thread history
              </h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {threadHistory.map((thread) => (
                  <ThreadCard key={thread.id} thread={thread} disabled={pending} onCommand={command} />
                ))}
              </div>
            </section>
          )}

          <section className="space-y-2">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h3 className="text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
                  Story beats
                </h3>
                <p className="mt-1 text-[0.5625rem] text-[var(--muted-foreground)]">
                  Only Approved beats enter prompts.
                </p>
              </div>
              <span className="text-[0.5625rem] tabular-nums text-[var(--muted-foreground)]">
                {state.beats.length} saved
              </span>
            </div>
            {state.beats.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-xs text-[var(--muted-foreground)]">
                {state.enabled
                  ? "Create a plan to get reviewable story beats."
                  : "Enable the director to create reviewable story beats."}
              </div>
            ) : (
              <div className="space-y-2">
                {state.beats.map((beat, index) => (
                  <BeatCard
                    key={beat.id}
                    beat={beat}
                    index={index}
                    count={state.beats.length}
                    disabled={pending}
                    onCommand={command}
                    onReroll={reroll}
                  />
                ))}
              </div>
            )}
          </section>

          {state.sourceSnapshot && (
            <p className="text-[0.5625rem] leading-relaxed text-[var(--muted-foreground)]">
              Based on {state.sourceSnapshot.storyProjectionIds.length} story projection
              {state.sourceSnapshot.storyProjectionIds.length === 1 ? "" : "s"},{" "}
              {state.sourceSnapshot.knowledgeEdgeIds.length} knowledge edge
              {state.sourceSnapshot.knowledgeEdgeIds.length === 1 ? "" : "s"}, and transcript through{" "}
              {state.sourceSnapshot.lastMessageId ?? "the current opening"}.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
