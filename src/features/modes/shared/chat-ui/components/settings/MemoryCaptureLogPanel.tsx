import { ChevronDown, ChevronRight, History, Loader2 } from "lucide-react";
import { useId, useState } from "react";
import {
  MEMORY_CAPTURE_LOG_LIMIT,
  MEMORY_CAPTURE_NOT_CHECKED_COPY,
  MEMORY_CAPTURE_SKIP_COPY,
  useMemoryCaptureLog,
  type MemoryCaptureLogEntry,
} from "../../../../../catalog/chats/index";

function formatCaptureTime(value: string): string {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return value || "Unknown time";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

function entryHeadline(entry: MemoryCaptureLogEntry): string {
  if (entry.state === "in_progress") return entry.error ? "Retrying" : "Still running";
  if (entry.state === "not_checked") return "Not checked";
  const parts = [entry.saved > 0 ? `Saved ${entry.saved}` : "Nothing saved"];
  if (entry.savedInactive > 0) parts.push(`${entry.savedInactive} kept but not used`);
  if (entry.skippedTotal > 0) parts.push(`${entry.skippedTotal} not saved`);
  return parts.join(" · ");
}

// Replies that saved everything they found, or found nothing, have nothing to explain.
function needsExplaining(entry: MemoryCaptureLogEntry): boolean {
  return (
    entry.state === "not_checked" || entry.state === "in_progress" || entry.skippedTotal > 0 || entry.savedInactive > 0
  );
}

export function MemoryCaptureLogPanel({
  chatId,
  open,
  captureEnabled,
}: {
  chatId: string;
  open: boolean;
  captureEnabled: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const logQuery = useMemoryCaptureLog(chatId, open);
  const summary = logQuery.data?.summary;
  const entries = logQuery.data?.entries ?? [];
  const explained = entries.filter(needsExplaining);
  const withoutDetails = summary?.withoutDetails ?? 0;
  const quiet = entries.length - explained.length - withoutDetails;

  return (
    <section
      aria-label="Memory capture log"
      className="rounded-md bg-[var(--secondary)]/40 px-3 py-2 text-[0.6875rem] ring-1 ring-[var(--border)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-[var(--muted-foreground)]" aria-live="polite">
          <History size="0.8rem" className="shrink-0" />
          <span className="font-semibold text-[var(--foreground)]">Capture log</span>
          {logQuery.isLoading ? (
            <Loader2 size="0.75rem" className="animate-spin" aria-label="Loading capture log" />
          ) : logQuery.isError ? (
            <span className="text-[var(--destructive)]">Couldn't load the capture log.</span>
          ) : summary && entries.length > 0 ? (
            <span className="tabular-nums">
              {plural(summary.checked, "reply", "replies")} checked · {plural(summary.saved, "memory", "memories")}{" "}
              saved · {summary.skipped.toLocaleString()} not saved
              {summary.savedInactive > 0 && <> · {summary.savedInactive.toLocaleString()} kept but not used</>}
              {summary.notChecked > 0 && <> · {plural(summary.notChecked, "reply", "replies")} not checked</>}
              {summary.inProgress > 0 && <> · {summary.inProgress.toLocaleString()} running</>}
            </span>
          ) : (
            <span>No replies checked yet.</span>
          )}
        </div>
        {(explained.length > 0 || withoutDetails > 0) && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-controls={listId}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 font-medium transition hover:bg-[var(--accent)]"
          >
            {expanded ? <ChevronDown size="0.75rem" /> : <ChevronRight size="0.75rem" />}
            {expanded ? "Hide why" : "Show why"}
          </button>
        )}
      </div>
      {!captureEnabled && (
        <p className="mt-1.5 text-amber-800 dark:text-amber-200" role="status">
          Memory is off for this chat, so new replies are not checked.
        </p>
      )}
      {expanded && (
        <div id={listId} className="mt-2 max-h-72 space-y-1.5 overflow-y-auto">
          {explained.map((entry) => (
            <div
              key={entry.jobId}
              className="rounded-md bg-[var(--background)]/70 px-2 py-1.5 ring-1 ring-[var(--border)]"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="font-medium text-[var(--foreground)]">{entryHeadline(entry)}</span>
                <span className="text-[0.625rem] text-[var(--muted-foreground)]">{formatCaptureTime(entry.at)}</span>
              </div>
              {entry.state === "not_checked" && (
                <p className="mt-0.5 text-[var(--muted-foreground)]">
                  {entry.notCheckedReason ? MEMORY_CAPTURE_NOT_CHECKED_COPY[entry.notCheckedReason] : entry.error}
                </p>
              )}
              {entry.state === "in_progress" && entry.error && (
                <p className="mt-0.5 text-[var(--muted-foreground)]">Last try: {entry.error}</p>
              )}
              {entry.skipped.length > 0 && (
                <ul className="mt-1 space-y-1">
                  {entry.skipped.map((skip, index) => (
                    <li key={index} className="leading-relaxed">
                      {skip.content && <span className="block text-[var(--foreground)]/80">{skip.content}</span>}
                      <span className="block text-[var(--muted-foreground)]">
                        {MEMORY_CAPTURE_SKIP_COPY[skip.reason]}
                        {skip.afterCorrection ? " (after fixing its wording)" : ""}
                      </span>
                    </li>
                  ))}
                  {entry.skippedTotal > entry.skipped.length && (
                    <li className="text-[var(--muted-foreground)]">
                      …and {(entry.skippedTotal - entry.skipped.length).toLocaleString()} more.
                    </li>
                  )}
                </ul>
              )}
            </div>
          ))}
          {quiet > 0 && (
            <p className="text-[var(--muted-foreground)]">
              {plural(quiet, "other reply", "other replies")} saved everything {quiet === 1 ? "it" : "they"} found, or
              had nothing new.
            </p>
          )}
          {withoutDetails > 0 && (
            <p className="text-[var(--muted-foreground)]">
              {plural(withoutDetails, "reply", "replies")} {withoutDetails === 1 ? "was" : "were"} checked before De-Koi
              kept skip reasons.
            </p>
          )}
          {entries.length >= MEMORY_CAPTURE_LOG_LIMIT && (
            <p className="text-[var(--muted-foreground)]">Showing the newest {MEMORY_CAPTURE_LOG_LIMIT} replies.</p>
          )}
        </div>
      )}
    </section>
  );
}
