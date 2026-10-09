import { useChatStore } from "../../../../../shared/stores/chat.store";

/**
 * Shown in a reply that hasn't started streaming yet, with what the generation is doing meanwhile
 * (e.g. "Calling model...", or waiting for the last reply's trackers).
 */
export function StreamingPendingIndicator({ chatId }: { chatId: string }) {
  const phase = useChatStore((s) => s.generationPhaseByChatId.get(chatId) ?? null);
  return (
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
        </span>
      )}
    </div>
  );
}
