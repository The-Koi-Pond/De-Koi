import { ChevronDown, FlaskConical, X } from "lucide-react";
import type { LorebookActivationTraceEntry } from "../../../../../engine/contracts/types/lorebook";
import { cn } from "../../../../../shared/lib/utils";

export function LorebookKeywordTestPanel({
  open,
  text,
  previewActive,
  previewMatchCount,
  enabledEntryCount,
  traceEntries,
  onOpenChange,
  onTextChange,
}: {
  open: boolean;
  text: string;
  previewActive: boolean;
  previewMatchCount: number;
  enabledEntryCount: number;
  traceEntries: LorebookActivationTraceEntry[];
  onOpenChange: (open: boolean) => void;
  onTextChange: (text: string) => void;
}) {
  const includedCount = traceEntries.filter((entry) => entry.status === "included").length;
  const matchedCount = traceEntries.filter((entry) => entry.status === "matched").length;
  const skippedCount = traceEntries.filter((entry) => entry.status === "skipped").length;
  const firstSkipped = traceEntries.find((entry) => entry.status === "skipped");

  return (
    <div className="rounded-xl bg-[var(--secondary)]/60 ring-1 ring-[var(--border)]">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs font-medium transition-colors hover:bg-[var(--accent)]/30"
        aria-expanded={open}
      >
        <FlaskConical size="0.8125rem" className="shrink-0 text-amber-400" />
        <span className="flex-1">Keyword test</span>
        {previewActive && (
          <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[0.625rem] font-medium text-emerald-300 ring-1 ring-emerald-400/25">
            {previewMatchCount} match{previewMatchCount === 1 ? "" : "es"}
          </span>
        )}
        <ChevronDown
          size="0.8125rem"
          className={cn(
            "shrink-0 text-[var(--muted-foreground)] transition-transform",
            open ? "rotate-0" : "-rotate-90",
          )}
        />
      </button>
      {open && (
        <div className="space-y-2 border-t border-[var(--border)] px-3 py-3">
          <p className="text-[0.6875rem] text-[var(--muted-foreground)]">
            Paste sample chat text to inspect entry activation with keyword, secondary-key, probability, timing, and
            semantic trace metadata available to this editor preview.
          </p>
          <div className="relative">
            <textarea
              value={text}
              onChange={(event) => onTextChange(event.target.value)}
              placeholder="Paste a paragraph or sample messages here…"
              rows={4}
              className="w-full resize-y rounded-xl bg-[var(--background)] px-3 py-2 pr-8 text-xs ring-1 ring-[var(--border)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
            />
            {text && (
              <button
                type="button"
                onClick={() => onTextChange("")}
                className="absolute right-2 top-2 rounded p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                title="Clear keyword test"
                aria-label="Clear keyword test"
              >
                <X size="0.75rem" />
              </button>
            )}
          </div>
          {previewActive && (
            <div className="space-y-1 text-[0.6875rem] text-[var(--muted-foreground)]">
              <p>
                {previewMatchCount === 0
                  ? "No entries would activate on this text."
                  : `${previewMatchCount} of ${enabledEntryCount} enabled entr${
                      enabledEntryCount === 1 ? "y" : "ies"
                    } would activate.`}
              </p>
              <p>
                Trace: {includedCount} included, {matchedCount} matched, {skippedCount} skipped
              </p>
              {firstSkipped && <p>First skipped: {firstSkipped.name} - {firstSkipped.hint}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
