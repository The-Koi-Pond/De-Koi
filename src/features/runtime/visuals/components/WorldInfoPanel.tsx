import { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Globe, Loader2, X } from "lucide-react";
import type { LorebookActivationTraceEntry, LorebookActivationTraceStatus } from "../../../../engine/contracts/types/lorebook";
import { useActiveLorebookEntries } from "../../../catalog/lorebooks/index";

type TraceFilter = LorebookActivationTraceStatus | "all";

const FILTERS: Array<{ id: TraceFilter; label: string }> = [
  { id: "included", label: "Included" },
  { id: "matched", label: "Matched" },
  { id: "skipped", label: "Skipped" },
  { id: "all", label: "All" },
];

function reasonLabel(reason: LorebookActivationTraceEntry["reason"]): string {
  switch (reason) {
    case "keyword_match":
      return "Keyword";
    case "constant":
      return "Constant";
    case "sticky":
      return "Sticky";
    case "semantic_match":
      return "Semantic";
    case "primary_key_miss":
      return "No primary key";
    case "secondary_key_miss":
      return "Secondary key";
    case "disabled":
      return "Disabled";
    case "scope_filter":
      return "Scope filter";
    case "condition_miss":
      return "Condition";
    case "schedule_miss":
      return "Schedule";
    case "timing_blocked":
      return "Timing";
    case "probability_failed":
      return "Probability";
    case "group_loser":
      return "Group";
    case "budget_lorebook":
      return "Lorebook budget";
    case "budget_chat":
      return "Chat budget";
    case "budget_both":
      return "Budgets";
    case "folder_disabled":
      return "Folder";
    case "empty_content":
      return "Empty";
    case "position_disabled":
      return "Position";
    case "recursion_blocked":
      return "Recursion";
    case "unscanned":
      return "Not scanned";
  }
}

function statusClass(status: LorebookActivationTraceStatus): string {
  if (status === "included") return "bg-emerald-400 text-emerald-100 border-emerald-400/25";
  if (status === "matched") return "bg-amber-400 text-amber-100 border-amber-400/25";
  return "bg-zinc-400 text-zinc-100 border-zinc-400/25";
}

function TraceEntryRow({ entry, content }: { entry: LorebookActivationTraceEntry; content?: string }) {
  const [expanded, setExpanded] = useState(false);
  const timing = entry.timing;

  return (
    <button
      type="button"
      className="w-full rounded-lg bg-[var(--secondary)] p-2 text-left text-xs transition-colors hover:bg-[var(--accent)]"
      onClick={() => setExpanded((prev) => !prev)}
    >
      <div className="flex items-center gap-2">
        {expanded ? <ChevronDown size="0.75rem" /> : <ChevronRight size="0.75rem" />}
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusClass(entry.status).split(" ")[0]}`} />
        <span className="min-w-0 flex-1 truncate font-medium text-[var(--foreground)]/85">{entry.name}</span>
        <span className="shrink-0 rounded border px-1.5 py-0.5 text-[0.5625rem] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
          {reasonLabel(entry.reason)}
        </span>
      </div>
      <p className="mt-1 truncate pl-5 text-[0.625rem] text-[var(--muted-foreground)]">
        {entry.hint}
      </p>
      {expanded && (
        <div className="mt-2 space-y-1.5 border-t border-[var(--border)] pt-2 pl-5 text-[0.625rem] leading-relaxed text-[var(--muted-foreground)]">
          <p>
            Status: <span className="text-[var(--foreground)]/80">{entry.status}</span>
          </p>
          <p>
            Position: {entry.injection.position} / role {entry.injection.role} / order {entry.injection.order}
          </p>
          <p>Estimate: ~{entry.tokenEstimate.toLocaleString()} tokens</p>
          {entry.matchedKeys.length > 0 && <p>Matched: {entry.matchedKeys.slice(0, 6).join(", ")}</p>}
          {entry.probability && (
            <p>
              Probability: {entry.probability.configured}%
              {entry.probability.roll === null ? "" : `, roll ${entry.probability.roll.toFixed(2)}`}
            </p>
          )}
          {typeof entry.semanticScore === "number" && <p>Semantic score: {entry.semanticScore.toFixed(3)}</p>}
          {timing && (
            <p>
              Timing: sticky {timing.stickyCount}, cooldown {timing.cooldownRemaining}, delay {timing.delayRemaining}
            </p>
          )}
          {entry.recursive && <p>Recursion pass: {entry.recursive.depth}</p>}
          {content && (
            <p className="max-h-36 overflow-y-auto whitespace-pre-wrap border-t border-[var(--border)] pt-1.5 text-[0.6875rem]">
              {content}
            </p>
          )}
        </div>
      )}
    </button>
  );
}

function emptyText(filter: TraceFilter): string {
  if (filter === "included") return "No included entries for this scan";
  if (filter === "matched") return "No matched entries were skipped";
  if (filter === "skipped") return "No skipped entries for this scan";
  return "No lorebook trace entries for this scan";
}

export function WorldInfoPanel({
  chatId,
  isMobile,
  onClose,
}: {
  chatId: string;
  isMobile: boolean;
  onClose: () => void;
}) {
  const { data, isLoading, isError, error } = useActiveLorebookEntries(chatId, true, {
    includeTestScanTrigger: true,
  });
  const [filter, setFilter] = useState<TraceFilter>("all");
  const traceEntries = data?.activationTrace.entries ?? [];
  const activeContentById = useMemo(
    () => new Map((data?.entries ?? []).map((entry) => [entry.id, entry.content])),
    [data?.entries],
  );
  const counts = useMemo(() => {
    return {
      included: traceEntries.filter((entry) => entry.status === "included").length,
      matched: traceEntries.filter((entry) => entry.status === "matched").length,
      skipped: traceEntries.filter((entry) => entry.status === "skipped").length,
      all: traceEntries.length,
    } satisfies Record<TraceFilter, number>;
  }, [traceEntries]);
  const visibleEntries = filter === "all" ? traceEntries : traceEntries.filter((entry) => entry.status === filter);
  const errorMessage = error instanceof Error ? error.message : "The lorebook inspector scan could not complete.";

  return (
    <>
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[var(--foreground)]">
        <Globe size="0.75rem" />
        Lorebook Inspector
        {isMobile && (
          <button
            onClick={onClose}
            className="ml-auto rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
          >
            <X size="0.75rem" />
          </button>
        )}
      </h3>
      {isLoading ? (
        <div className="flex items-center gap-2 py-4 text-xs text-[var(--muted-foreground)]">
          <Loader2 size="0.75rem" className="animate-spin" />
          Scanning entries...
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-[var(--destructive)]/30 bg-[var(--destructive)]/10 p-2 text-xs text-[var(--destructive)]">
          <div className="flex items-center gap-1.5 font-medium">
            <AlertTriangle size="0.75rem" />
            Lorebook scan failed
          </div>
          <p className="mt-1 leading-relaxed text-[var(--destructive)]/80">{errorMessage}</p>
        </div>
      ) : (
        <>
          <p className="mb-2 text-[0.625rem] text-[var(--muted-foreground)]">
            {counts.included} included * {counts.matched} matched * {counts.skipped} skipped
          </p>
          <div className="mb-2 grid grid-cols-4 gap-1 rounded-lg bg-[var(--secondary)] p-1">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`rounded-md px-1.5 py-1 text-[0.625rem] font-medium transition-colors ${
                  filter === item.id
                    ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm"
                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                }`}
                onClick={() => setFilter(item.id)}
              >
                {item.label} {counts[item.id]}
              </button>
            ))}
          </div>
          {visibleEntries.length === 0 ? (
            <p className="py-3 text-center text-xs text-[var(--muted-foreground)]">{emptyText(filter)}</p>
          ) : (
            <div className="space-y-1.5">
              {visibleEntries.map((entry) => (
                <TraceEntryRow key={entry.entryId} entry={entry} content={activeContentById.get(entry.entryId)} />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
