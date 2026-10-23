import { useState } from "react";
import { Check, CirclePause, CircleX, Hourglass, Loader2, PenLine, Plus, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import type {
  PendingWorldTick,
  WorldTickCommand,
  WorldTickEvent,
  WorldTickEventStatus,
} from "../../../../engine/contracts/types/roleplay-world-tick";
import { WORLD_TICK_LIMITS } from "../../../../engine/modes/roleplay/world-tick/world-tick-state";
import { Modal } from "../../../../shared/components/ui/Modal";
import { toUserMessage } from "../../../../shared/lib/error-message";
import { cn } from "../../../../shared/lib/utils";
import { useWorldTick } from "../hooks/use-world-tick";

interface RoleplayWorldTickModalProps {
  chatId: string;
  open: boolean;
  onClose: () => void;
  /** Newest message in the chat, to warn when the story moved on after the events were proposed. */
  latestMessageId: string | null;
  /** A reply is being written; adding the time skip now would land in the middle of it. */
  replyInProgress: boolean;
}

const ELAPSED_PRESETS = ["A few hours", "Overnight", "A day", "A few days", "A week"] as const;

const STATUS_LABELS: Record<WorldTickEventStatus, string> = {
  proposed: "Needs a decision",
  accepted: "Accepted",
  deferred: "Put off",
  rejected: "Rejected",
};

function statusTone(status: WorldTickEventStatus): string {
  if (status === "accepted") return "bg-emerald-500/12 text-emerald-300 ring-emerald-500/30";
  if (status === "proposed") return "bg-sky-500/12 text-sky-300 ring-sky-500/30";
  if (status === "rejected") return "bg-rose-500/10 text-rose-300 ring-rose-500/25";
  return "bg-amber-500/10 text-amber-300 ring-amber-500/25";
}

/** What went wrong and what to do; service errors carry a code that says which. */
function errorText(error: unknown, fallback: string): string {
  if (error instanceof Error && error.name === "WorldTickError") {
    const code = (error as Error & { code?: unknown }).code;
    if (code === "timeout") return "The model took too long. Try again, or add your own events.";
    if (code === "connection_unavailable") return error.message;
    if (code === "invalid_output") return "The model didn't return usable events. Try again, or add your own.";
  }
  return toUserMessage(error, { fallback });
}

function sourceLabel(event: WorldTickEvent): string {
  if (event.source === "user") return "Yours";
  if (event.edited) return "Suggested, edited by you";
  return event.carried ? "Suggested earlier" : "Suggested";
}

function EventCard({
  event,
  disabled,
  onCommand,
}: {
  event: WorldTickEvent;
  disabled: boolean;
  onCommand: (command: WorldTickCommand) => void;
}) {
  const [editing, setEditing] = useState(false);
  const decide = (status: Exclude<WorldTickEventStatus, "proposed">) =>
    onCommand({ type: "set_event_status", eventId: event.id, status });
  return (
    <article
      className={cn(
        "rounded-xl border border-[var(--border)] bg-[var(--secondary)]/45 p-3",
        event.status === "rejected" && "opacity-60",
      )}
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <span className={cn("rounded-full px-2 py-0.5 text-[0.625rem] font-semibold ring-1", statusTone(event.status))}>
          {STATUS_LABELS[event.status]}
        </span>
        <span className="rounded-full bg-[var(--background)] px-2 py-0.5 text-[0.625rem] text-[var(--muted-foreground)] ring-1 ring-[var(--border)]">
          {sourceLabel(event)}
        </span>
        {event.characters.length > 0 && (
          <span className="text-[0.625rem] text-[var(--muted-foreground)]">{event.characters.join(", ")}</span>
        )}
      </div>
      {editing ? (
        <textarea
          aria-label={`Edit event: ${event.text}`}
          defaultValue={event.text}
          maxLength={WORLD_TICK_LIMITS.eventCharacters}
          rows={4}
          autoFocus
          disabled={disabled}
          onBlur={(blur) => {
            const text = blur.currentTarget.value.trim();
            setEditing(false);
            if (text && text !== event.text) onCommand({ type: "edit_event", eventId: event.id, text });
          }}
          className="w-full resize-y rounded-lg border border-[var(--ring)] bg-[var(--background)] px-2 py-1.5 text-xs leading-relaxed text-[var(--foreground)] outline-none disabled:opacity-60"
        />
      ) : (
        <p className="px-0.5 text-xs leading-relaxed text-[var(--foreground)]">{event.text}</p>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {event.status !== "accepted" && (
          <button
            type="button"
            aria-label={`Accept: ${event.text}`}
            disabled={disabled}
            onClick={() => decide("accepted")}
            className="inline-flex items-center gap-1 rounded-md bg-emerald-500/12 px-2 py-1 text-[0.6875rem] font-medium text-emerald-300 ring-1 ring-emerald-500/25 hover:bg-emerald-500/20 disabled:opacity-40"
          >
            <Check size="0.75rem" aria-hidden="true" /> Accept
          </button>
        )}
        {event.status !== "deferred" && (
          <button
            type="button"
            aria-label={`Put off: ${event.text}`}
            disabled={disabled}
            onClick={() => decide("deferred")}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-[0.6875rem] text-[var(--muted-foreground)] hover:bg-[var(--accent)] disabled:opacity-40"
          >
            <CirclePause size="0.75rem" aria-hidden="true" /> Put off
          </button>
        )}
        {event.status !== "rejected" && (
          <button
            type="button"
            aria-label={`Reject: ${event.text}`}
            disabled={disabled}
            onClick={() => decide("rejected")}
            className="inline-flex items-center gap-1 rounded-md border border-rose-500/25 px-2 py-1 text-[0.6875rem] text-rose-300 hover:bg-rose-500/10 disabled:opacity-40"
          >
            <CircleX size="0.75rem" aria-hidden="true" /> Reject
          </button>
        )}
        {!editing && (
          <button
            type="button"
            aria-label={`Edit: ${event.text}`}
            disabled={disabled}
            onClick={() => setEditing(true)}
            className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[0.6875rem] text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-40"
          >
            <PenLine size="0.75rem" aria-hidden="true" /> Edit
          </button>
        )}
      </div>
    </article>
  );
}

function ReviewStep({
  pending,
  busy,
  replyInProgress,
  storyMovedOn,
  onCommand,
  onApply,
  onDiscard,
  onProposeAgain,
}: {
  pending: PendingWorldTick;
  busy: boolean;
  replyInProgress: boolean;
  storyMovedOn: boolean;
  onCommand: (command: WorldTickCommand) => void;
  onApply: () => void;
  onDiscard: () => void;
  onProposeAgain: () => void;
}) {
  const [ownEvent, setOwnEvent] = useState("");
  const undecided = pending.events.filter((event) => event.status === "proposed").length;
  const accepted = pending.events.filter((event) => event.status === "accepted").length;
  const full = pending.events.length >= WORLD_TICK_LIMITS.eventsPerTick;
  const addOwn = () => {
    const text = ownEvent.trim();
    if (!text) return;
    onCommand({ type: "add_event", text });
    setOwnEvent("");
  };

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-[0.6875rem] font-medium text-[var(--muted-foreground)]">Time passes</span>
        <input
          key={`${pending.id}:${pending.elapsed}`}
          defaultValue={pending.elapsed}
          maxLength={WORLD_TICK_LIMITS.elapsedCharacters}
          disabled={busy}
          onBlur={(blur) => {
            const elapsed = blur.currentTarget.value.trim();
            if (elapsed && elapsed !== pending.elapsed) onCommand({ type: "set_elapsed", elapsed });
          }}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs outline-none focus:border-[var(--ring)]"
        />
      </label>

      {storyMovedOn && (
        <p
          role="status"
          className="rounded-lg bg-amber-500/10 px-3 py-2 text-[0.6875rem] text-amber-200 ring-1 ring-amber-500/25"
        >
          The chat moved on after these were suggested. Check they still fit, or propose again.
        </p>
      )}

      {pending.events.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--border)] px-3 py-4 text-center text-xs text-[var(--muted-foreground)]">
          The model didn't think anything notable would happen. Add your own event, or apply to just move the clock.
        </p>
      ) : (
        <div className="space-y-2">
          {pending.events.map((event) => (
            <EventCard key={event.id} event={event} disabled={busy} onCommand={onCommand} />
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          value={ownEvent}
          onChange={(change) => setOwnEvent(change.target.value)}
          onKeyDown={(key) => {
            if (key.key === "Enter") addOwn();
          }}
          maxLength={WORLD_TICK_LIMITS.eventCharacters}
          disabled={busy || full}
          placeholder={full ? "This time skip is full" : "Add something that happens…"}
          aria-label="Your own event"
          className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs outline-none focus:border-[var(--ring)]"
        />
        <button
          type="button"
          onClick={addOwn}
          disabled={busy || full || !ownEvent.trim()}
          className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-2 text-xs hover:bg-[var(--accent)] disabled:opacity-40"
        >
          <Plus size="0.8rem" aria-hidden="true" /> Add
        </button>
      </div>

      <div className="sticky -bottom-4 z-10 -mx-5 -mb-4 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] bg-[var(--card)]/95 px-5 py-3 backdrop-blur">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onDiscard}
            disabled={busy}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)] hover:bg-[var(--accent)] disabled:opacity-40"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={onProposeAgain}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)] hover:bg-[var(--accent)] disabled:opacity-40"
          >
            <RotateCcw size="0.75rem" aria-hidden="true" /> Suggest again
          </button>
        </div>
        <div className="flex items-center gap-2">
          {replyInProgress && (
            <span className="text-[0.6875rem] text-[var(--muted-foreground)]">Wait for the reply to finish.</span>
          )}
          {!replyInProgress && undecided > 0 && (
            <span className="text-[0.6875rem] text-[var(--muted-foreground)]">
              {undecided === 1 ? "1 event needs a decision" : `${undecided} events need a decision`}
            </span>
          )}
          <button
            type="button"
            onClick={onApply}
            disabled={busy || replyInProgress || undecided > 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-40"
          >
            {busy ? (
              <Loader2 size="0.8rem" className="animate-spin" aria-hidden="true" />
            ) : (
              <Hourglass size="0.8rem" aria-hidden="true" />
            )}
            {undecided > 0
              ? "Apply"
              : accepted === 0
                ? "Apply: just move the clock"
                : `Apply: add ${accepted === 1 ? "1 event" : `${accepted} events`} to the chat`}
          </button>
        </div>
      </div>
    </div>
  );
}

function StartStep({
  busy,
  deferredCount,
  onPropose,
}: {
  busy: boolean;
  deferredCount: number;
  onPropose: (input: { elapsed: string; guidance: string }) => void;
}) {
  const [elapsed, setElapsed] = useState("");
  const [guidance, setGuidance] = useState("");
  return (
    <form
      className="space-y-3"
      onSubmit={(submit) => {
        submit.preventDefault();
        if (elapsed.trim()) onPropose({ elapsed: elapsed.trim(), guidance: guidance.trim() });
      }}
    >
      <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">
        Skip ahead and see what the world got up to. You review every suggestion first; only what you accept is added to
        the chat, and nothing is decided for your character.
      </p>
      <fieldset>
        <legend className="mb-1.5 text-[0.6875rem] font-medium text-[var(--muted-foreground)]">
          How much time passes?
        </legend>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {ELAPSED_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              aria-pressed={elapsed === preset}
              onClick={() => setElapsed(preset)}
              className={cn(
                "rounded-full px-2.5 py-1 text-[0.6875rem] ring-1 ring-[var(--border)] hover:bg-[var(--accent)]",
                elapsed === preset &&
                  "bg-[var(--primary)]/15 font-semibold text-[var(--foreground)] ring-[var(--primary)]",
              )}
            >
              {preset}
            </button>
          ))}
        </div>
        <input
          value={elapsed}
          onChange={(change) => setElapsed(change.target.value)}
          maxLength={WORLD_TICK_LIMITS.elapsedCharacters}
          placeholder="Or type it: three weeks, until spring…"
          aria-label="How much time passes"
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs outline-none focus:border-[var(--ring)]"
        />
      </fieldset>
      <label className="block">
        <span className="mb-1 block text-[0.6875rem] font-medium text-[var(--muted-foreground)]">
          Anything that should or shouldn't happen? (optional)
        </span>
        <textarea
          value={guidance}
          onChange={(change) => setGuidance(change.target.value)}
          maxLength={WORLD_TICK_LIMITS.guidanceCharacters}
          rows={2}
          className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs outline-none focus:border-[var(--ring)]"
        />
      </label>
      {deferredCount > 0 && (
        <p className="text-[0.6875rem] text-[var(--muted-foreground)]">
          {deferredCount === 1 ? "1 event you put off" : `${deferredCount} events you put off`} will come back for
          review.
        </p>
      )}
      <button
        type="submit"
        disabled={busy || !elapsed.trim()}
        className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-40"
      >
        {busy ? (
          <Loader2 size="0.8rem" className="animate-spin" aria-hidden="true" />
        ) : (
          <Hourglass size="0.8rem" aria-hidden="true" />
        )}
        {busy ? "Asking what happens…" : "Suggest what happens"}
      </button>
    </form>
  );
}

export function RoleplayWorldTickModal({
  chatId,
  open,
  onClose,
  latestMessageId,
  replyInProgress,
}: RoleplayWorldTickModalProps) {
  const worldTick = useWorldTick(open ? chatId : null);
  const state = worldTick.state;
  const busy = worldTick.propose.isPending || worldTick.command.isPending || worldTick.apply.isPending;

  const command = (value: WorldTickCommand) => {
    if (!state) return;
    worldTick.command.mutate(
      { command: value, expectedRevision: state.revision },
      { onError: (error) => toast.error(errorText(error, "Couldn't save that change. Try again.")) },
    );
  };

  const propose = (input: { elapsed: string; guidance: string; replacePending?: boolean }) => {
    worldTick.propose.mutate(input, {
      onSuccess: (result) => {
        if (result.rejectedUnsafeEvents > 0) {
          toast.info(
            result.rejectedUnsafeEvents === 1
              ? "Left out 1 suggestion that decided something for your character."
              : `Left out ${result.rejectedUnsafeEvents} suggestions that decided things for your character.`,
          );
        }
      },
      onError: (error) => toast.error(errorText(error, "Couldn't suggest events. Try again.")),
    });
  };

  const apply = () => {
    const pending = state?.pending;
    if (!state || !pending) return;
    worldTick.apply.mutate(
      { tickId: pending.id, expectedRevision: state.revision },
      {
        onSuccess: () => {
          toast.success("Time passed. The next reply picks up from here.");
          onClose();
        },
        onError: (error) => toast.error(errorText(error, "Couldn't apply the time skip. Try again.")),
      },
    );
  };

  return (
    <Modal open={open} onClose={onClose} title="Let time pass" width="max-w-2xl">
      {worldTick.isLoading ? (
        <div className="flex min-h-40 items-center justify-center gap-2 text-xs text-[var(--muted-foreground)]">
          <Loader2 size="1rem" className="animate-spin" aria-hidden="true" /> Loading…
        </div>
      ) : !state ? (
        <p role="alert" className="px-2 py-8 text-center text-xs text-rose-300">
          {errorText(worldTick.error, "Couldn't load this chat's time skips. Close this and try again.")}
        </p>
      ) : state.pending ? (
        <ReviewStep
          pending={state.pending}
          busy={busy}
          replyInProgress={replyInProgress}
          storyMovedOn={Boolean(
            latestMessageId && state.pending.anchorMessageId && latestMessageId !== state.pending.anchorMessageId,
          )}
          onCommand={command}
          onApply={apply}
          onDiscard={() => command({ type: "discard_pending" })}
          onProposeAgain={() =>
            propose({ elapsed: state.pending!.elapsed, guidance: state.pending!.guidance, replacePending: true })
          }
        />
      ) : (
        <StartStep busy={busy} deferredCount={state.deferred.length} onPropose={propose} />
      )}
    </Modal>
  );
}
