import { Loader2 } from "lucide-react";
import { useId } from "react";

import type { SpriteGenerationController } from "../hooks/use-sprite-generation";
import { hintText, smallButton } from "./dialog-styles";

/** "Transparent background": background cleanup of every sprite, always from its original picture. */
export function CleanupBar({ dialog }: { dialog: SpriteGenerationController }) {
  const strengthId = useId();
  const engineBlocked = !dialog.cleanupEngineInstalled;
  const applyDisabled =
    dialog.cleaning || dialog.slicing || dialog.framing || dialog.sprites.length === 0 || engineBlocked;
  const applyLabel = dialog.cleaning ? "Applying…" : dialog.cleanupApplied ? "Reapply cleanup" : "Apply cleanup";

  return (
    <section className="space-y-2 rounded-md border border-[var(--border)] p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={dialog.transparentBackground}
            disabled={dialog.cleaning}
            onChange={(event) => dialog.setTransparentBackground(event.target.checked)}
            className="accent-[var(--primary)]"
          />
          Transparent background
        </label>
        {dialog.transparentBackground && (
          <>
            <div className="flex min-w-48 flex-1 items-center gap-2 text-xs">
              <label htmlFor={strengthId} className="sr-only">
                Cleanup strength
              </label>
              <span aria-hidden="true" className="text-[var(--muted-foreground)]">
                Soft
              </span>
              <input
                id={strengthId}
                type="range"
                min={0}
                max={100}
                step={1}
                value={dialog.cleanupStrength}
                onChange={(event) => dialog.setCleanupStrength(Number(event.target.value))}
                className="flex-1 accent-[var(--primary)]"
              />
              <span aria-hidden="true" className="text-[var(--muted-foreground)]">
                Aggressive
              </span>
              <span aria-hidden="true" className="w-8 text-right tabular-nums">
                {dialog.cleanupStrength}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void dialog.applyCleanup()}
                disabled={applyDisabled}
                title={engineBlocked ? dialog.cleanupEngineReason : "Run background cleanup"}
                className={smallButton}
              >
                {dialog.cleaning && <Loader2 size="0.75rem" className="animate-spin" aria-hidden="true" />}
                {applyLabel}
              </button>
              {dialog.cleanupApplied && (
                <button type="button" onClick={dialog.showOriginals} className={smallButton}>
                  Use original
                </button>
              )}
            </div>
          </>
        )}
      </div>
      <p className={hintText}>
        Cleanup is applied after generation when enabled. Use Apply cleanup to rerun it on the current slices without
        regenerating.
      </p>
      {dialog.transparentBackground && engineBlocked && (
        <p className="text-xs text-amber-600 dark:text-amber-400">{dialog.cleanupEngineReason}</p>
      )}
    </section>
  );
}
