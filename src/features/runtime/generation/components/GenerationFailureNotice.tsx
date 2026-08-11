import { AlertCircle, RefreshCw, X } from "lucide-react";

import { useChatStore } from "../../../../shared/stores/chat.store";

interface GenerationFailureNoticeProps {
  chatId: string | null;
  onRetry: () => void;
}

export function GenerationFailureNotice({ chatId, onRetry }: GenerationFailureNoticeProps) {
  const failure = useChatStore((state) => (chatId ? state.generationFailures.get(chatId) : undefined));
  const setGenerationFailure = useChatStore((state) => state.setGenerationFailure);
  if (!chatId || !failure) return null;

  return (
    <div
      role="alert"
      className="mb-2 flex items-start gap-2 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-foreground"
    >
      <AlertCircle size="0.9rem" className="mt-0.5 shrink-0 text-red-400" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">No response came back.</p>
        <p className="mt-0.5 break-words text-foreground/70">{failure.message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-1 font-medium text-foreground hover:bg-foreground/10"
        >
          <RefreshCw size="0.75rem" aria-hidden="true" />
          Retry
        </button>
      </div>
      <button
        type="button"
        onClick={() => setGenerationFailure(chatId, null)}
        className="rounded-md p-1 text-foreground/50 hover:bg-foreground/10 hover:text-foreground"
        aria-label="Dismiss generation error"
      >
        <X size="0.8rem" aria-hidden="true" />
      </button>
    </div>
  );
}
