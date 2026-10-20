import { useChatStore } from "../../../../../shared/stores/chat.store";
import { SLOW_REPLY_HINT, useReplyWait } from "../lib/reply-wait";

/**
 * Shown in a reply that hasn't started streaming yet, with what the generation is doing meanwhile
 * (e.g. "Calling model...", or waiting for the last reply's trackers). A long wait also shows how long
 * the step has run and how to stop it, so it doesn't look like a hang.
 */
export function StreamingPendingIndicator({ chatId }: { chatId: string }) {
  const phase = useChatStore((s) => s.generationPhaseByChatId.get(chatId) ?? null);
  const startedAt = useChatStore((s) => s.generationPhaseStartedAtByChatId.get(chatId) ?? null);
  const wait = useReplyWait(phase ? startedAt : null);
  return (
    <>
      <div
        className="mari-streaming-pending mari-message-typing inline-flex items-center gap-2 py-0.5"
        role="status"
        aria-label={phase ?? "Assistant response is starting"}
      >
        <span className="mari-streaming-pending-glow" aria-hidden="true" />
        <span className="mari-streaming-pending-line" aria-hidden="true" />
        {phase && (
          <span className="mari-streaming-pending-phase" aria-hidden="true">
            {phase}
            {wait.elapsed && <span className="tabular-nums"> · {wait.elapsed}</span>}
          </span>
        )}
      </div>
      {wait.slow && (
        <p className="mari-streaming-pending-hint mt-1 text-xs text-[var(--muted-foreground)]" aria-live="polite">
          {SLOW_REPLY_HINT}
        </p>
      )}
    </>
  );
}
