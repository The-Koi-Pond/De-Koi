import { RotateCcw, StepForward } from "lucide-react";
import type { MessageExtra } from "../../../../../engine/contracts/types/chat";
import type { RegenerateOptions } from "../types";

export function GenerationInterruptedStatus({
  interruption,
  messageId,
  forCharacterId,
  onRegenerate,
}: {
  interruption?: MessageExtra["generationInterrupted"] | null;
  messageId: string;
  forCharacterId?: string | null;
  onRegenerate?: (messageId: string, options?: RegenerateOptions) => void | Promise<void>;
}) {
  if (!interruption) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-amber-400/30 bg-amber-500/10 px-2.5 py-2 text-xs">
      <span className="font-medium text-amber-700 dark:text-amber-300">{interruption.message}</span>
      {onRegenerate ? (
        <span className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Continue interrupted generation"
            className="inline-flex items-center gap-1 rounded px-2 py-1 font-medium text-[var(--foreground)] hover:bg-[var(--accent)]"
            onClick={() =>
              void onRegenerate(messageId, {
                continueResponse: true,
                forCharacterId: forCharacterId ?? null,
                skipTouchConfirm: true,
              })
            }
          >
            <StepForward size="0.75rem" aria-hidden="true" />
            Continue
          </button>
          <button
            type="button"
            aria-label="Regenerate interrupted generation"
            className="inline-flex items-center gap-1 rounded px-2 py-1 font-medium text-[var(--foreground)] hover:bg-[var(--accent)]"
            onClick={() => void onRegenerate(messageId, { forCharacterId: forCharacterId ?? null })}
          >
            <RotateCcw size="0.75rem" aria-hidden="true" />
            Regenerate
          </button>
        </span>
      ) : null}
    </div>
  );
}
