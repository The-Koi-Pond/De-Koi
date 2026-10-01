import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, Database, Loader2, Trash2, X } from "lucide-react";
import type {
  DekiWorkspaceHistoryEntry,
  DekiWorkspacePendingApproval,
  DekiWorkspaceRowChange,
} from "../../../../engine/deki/deki-entry";
import { cn } from "../../../../shared/lib/utils";
import { createDekiDeletePreviewFields, createDekiRowChangeDiffRows } from "../lib/deki-action-diff";
import { orderDekiDiffRowsForReading } from "../lib/deki-diff-presentation";
import { DekiActionDiffRowView, formatDekiActionDiffLabel } from "./DekiDiffRows";

const COLLECTION_LABELS: Record<string, [singular: string, plural: string]> = {
  characters: ["character", "characters"],
  "character-groups": ["character group", "character groups"],
  personas: ["persona", "personas"],
  "persona-groups": ["persona group", "persona groups"],
  lorebooks: ["lorebook", "lorebooks"],
  "lorebook-entries": ["lorebook entry", "lorebook entries"],
  prompts: ["prompt preset", "prompt presets"],
  "prompt-sections": ["prompt section", "prompt sections"],
  "prompt-groups": ["prompt group", "prompt groups"],
  "prompt-variables": ["prompt variable", "prompt variables"],
  "lorebook-folders": ["lorebook folder", "lorebook folders"],
  "character-gallery": ["character gallery image", "character gallery images"],
  "persona-gallery": ["persona gallery image", "persona gallery images"],
  "memory-knowledge-edges": ["knowledge link", "knowledge links"],
  "canonical-memories": ["memory", "memories"],
  chats: ["chat", "chats"],
};

type ParsedCommand = { action: "insert" | "patch" | "delete" | null; collection: string; id: string };

/** Parses the runtime's `deki data <action> <collection>/<id>` label. */
export function parseDekiDataCommand(command: string): ParsedCommand {
  const match = /^deki data (insert|patch|delete) ([a-z-]+)\/(.+)$/.exec(command.trim());
  if (!match) return { action: null, collection: "", id: "" };
  return { action: match[1] as ParsedCommand["action"], collection: match[2]!, id: match[3]! };
}

function collectionLabel(collection: string, count = 1): string {
  const labels = COLLECTION_LABELS[collection];
  if (!labels) return collection.replace(/-/g, " ");
  return count === 1 ? labels[0] : labels[1];
}

function titleFor(command: ParsedCommand): string {
  const noun = collectionLabel(command.collection);
  switch (command.action) {
    case "insert":
      return `Add a ${noun}`;
    case "patch":
      return `Edit a ${noun}`;
    case "delete":
      return `Delete a ${noun}`;
    default:
      return "Library change";
  }
}

function recordName(row: DekiWorkspaceRowChange | undefined): string | null {
  const source = row?.after ?? row?.before;
  if (!source) return null;
  const data = source.data;
  const nested =
    data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>).name : undefined;
  const name = source.name ?? nested ?? source.title ?? source.filename;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

/** Counts per collection, the record the command names first. */
function affectsLabel(affectedEntities: Record<string, number>, primary: string): string {
  const parts = Object.entries(affectedEntities)
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => Number(right === primary) - Number(left === primary))
    .map(([collection, count]) => `${count} ${collectionLabel(collection, count)}`);
  return parts.length > 0 ? parts.join(", ") : "No stored rows";
}

/** Null once the approval has expired; a label while it can still be decided. */
export function dekiApprovalExpiryLabel(expiresAt: string, now: number): string | null {
  const remainingMs = Date.parse(expiresAt) - now;
  if (!Number.isFinite(remainingMs)) return "Expires with this app session";
  if (remainingMs <= 0) return null;
  const minutes = Math.floor(remainingMs / 60_000);
  if (minutes < 1) return "Expires in under a minute";
  return `Expires in ${minutes} min`;
}

/**
 * The current time, refreshed whenever the expiry label would change and at
 * the moment of expiry, so an idle card never keeps its decision buttons
 * after its approval expires.
 */
function useDekiApprovalClock(expiresAt: string | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const remainingMs = expiresAt ? Date.parse(expiresAt) - now : Number.NaN;
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) return;
    // Wake just past the next whole minute (or the expiry), where the label changes.
    const timer = setTimeout(() => setNow(Date.now()), (remainingMs % 60_000) + 1);
    return () => clearTimeout(timer);
  }, [expiresAt, now]);
  return now;
}

type Outcome = { label: string; tone: "success" | "neutral" | "warning" | "error" };

export type DekiApprovalAvailability = "loading" | "ready" | "unavailable";

export function dekiApprovalOutcome(
  status: DekiWorkspaceHistoryEntry["status"],
  pending: boolean,
  availability: DekiApprovalAvailability,
): Outcome | null {
  if (pending) return null;
  if (status === "dry-run" && availability === "loading") return { label: "Checking...", tone: "neutral" };
  if (status === "dry-run" && availability === "unavailable") return { label: "Unavailable", tone: "neutral" };
  switch (status) {
    case "approved":
      return { label: "Applied", tone: "success" };
    case "rejected":
      return { label: "Rejected", tone: "neutral" };
    case "cancelled":
      return { label: "Cancelled", tone: "neutral" };
    case "state_changed":
      return { label: "Not applied: data changed", tone: "warning" };
    case "blocked":
      return { label: "Not applied: blocked", tone: "warning" };
    case "failed":
      return { label: "Not applied: failed", tone: "error" };
    case "timed_out":
    case "dry-run":
      return { label: "Expired", tone: "neutral" };
  }
}

function SideEffectRows({ title, tone, rows }: { title: string; tone: string; rows: DekiWorkspaceRowChange[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="border-t border-[var(--border)]/70 px-2.5 py-2 text-[0.6875rem] text-[var(--foreground)]/80">
      <div className={cn("mb-1 font-semibold", tone)}>{title}</div>
      <ul className="grid gap-0.5">
        {rows.map((row) => (
          <li key={`${row.entity}/${row.id}`} className="truncate" title={row.effect}>
            {collectionLabel(row.entity)}: {recordName(row) ?? row.id}
            {row.effect && <span className="text-[var(--muted-foreground)]"> · {row.effect}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DekiDataApprovalCard({
  entry,
  pending: pendingApproval,
  availability,
  deciding,
  error,
  onDecide,
}: {
  entry: DekiWorkspaceHistoryEntry;
  pending: DekiWorkspacePendingApproval | null;
  availability: DekiApprovalAvailability;
  deciding: boolean;
  error?: string;
  onDecide: (approve: boolean) => void;
}) {
  const now = useDekiApprovalClock(pendingApproval?.expiresAt ?? null);
  const expiryLabel = pendingApproval ? dekiApprovalExpiryLabel(pendingApproval.expiresAt, now) : null;
  // A pending approval past its expiry is shown as expired, never as actionable.
  const pending = pendingApproval && expiryLabel !== null ? pendingApproval : null;
  const command = parseDekiDataCommand(entry.command);
  const preview = pending?.diffPreview ?? [];
  const primary = preview[0];
  const alsoDeleted = preview.slice(1).filter((row) => row.action === "delete");
  const alsoChanged = preview.slice(1).filter((row) => row.action !== "delete");
  const primaryRows = useMemo(
    () =>
      primary && primary.action !== "delete" ? orderDekiDiffRowsForReading(createDekiRowChangeDiffRows(primary)) : [],
    [primary],
  );
  const deletedFields = useMemo(
    () => (primary && primary.action === "delete" ? createDekiDeletePreviewFields(primary) : []),
    [primary],
  );
  const outcome = dekiApprovalOutcome(entry.status, !!pending, availability);
  const destructive = command.action === "delete";
  const name = recordName(primary);
  return (
    <div
      className={cn(
        "deki-data-approval mb-3 ml-[4.5rem] mr-4 mt-2 rounded-xl border bg-[var(--card)] px-3 py-3 text-xs text-[var(--foreground)]",
        pending
          ? destructive
            ? "border-red-400/35 shadow-lg shadow-red-500/10"
            : "border-emerald-400/30 shadow-lg shadow-emerald-500/10"
          : "border-[var(--border)]",
      )}
      aria-label={titleFor(command)}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
            destructive ? "bg-red-500/10 text-red-400" : "bg-emerald-500/10 text-emerald-500",
          )}
        >
          {destructive ? <Trash2 size="0.875rem" /> : <Database size="0.875rem" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">
            {titleFor(command)}
            {name && <span className="font-normal text-[var(--foreground)]/70"> · {name}</span>}
          </div>
          <div className="truncate text-[0.6875rem] text-[var(--muted-foreground)]" title={entry.command}>
            {pending ? "Waiting for your approval" : "Library change"} ·{" "}
            {affectsLabel(entry.affectedEntities, command.collection)}
          </div>
        </div>
        {outcome && (
          <span
            className={cn(
              "inline-flex h-6 shrink-0 items-center gap-1 rounded-lg px-2 font-semibold",
              outcome.tone === "success" && "bg-emerald-500/10 text-emerald-500",
              outcome.tone === "neutral" && "bg-[var(--secondary)] text-[var(--muted-foreground)]",
              outcome.tone === "warning" && "bg-amber-500/10 text-amber-500",
              outcome.tone === "error" && "bg-red-500/10 text-red-500",
            )}
          >
            {outcome.tone === "success" ? <Check size="0.75rem" /> : null}
            {outcome.label}
          </span>
        )}
      </div>
      {entry.reason && <p className="mt-2 leading-relaxed text-[var(--foreground)]/75">{entry.reason}</p>}
      {pending && (
        <div className="mt-3 overflow-hidden rounded-lg border border-[var(--border)]/70 bg-[var(--secondary)]/55">
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)]/70 px-2.5 py-1.5">
            <div
              className={cn(
                "min-w-0 flex-1 text-[0.6875rem] font-semibold",
                destructive ? "text-red-400" : "text-[var(--muted-foreground)]",
              )}
            >
              {destructive ? "Will be deleted" : "Change preview"}
            </div>
            {!destructive && (
              <span className="rounded-full bg-[var(--card)] px-2 py-0.5 text-[0.625rem] font-semibold text-[var(--muted-foreground)]">
                {primaryRows.length} field{primaryRows.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
          {destructive ? (
            deletedFields.length > 0 ? (
              <dl className="grid max-h-80 gap-2 overflow-auto border-l-2 border-red-400/60 px-2.5 py-2.5">
                {deletedFields.map((field) => (
                  <div key={field.label} className="grid gap-0.5">
                    <dt className="text-[0.6875rem] font-semibold text-[var(--muted-foreground)]">
                      {formatDekiActionDiffLabel(field.label)}
                    </dt>
                    <dd className="whitespace-pre-wrap break-words text-[0.75rem] leading-relaxed text-[var(--foreground)]/80">
                      {field.value}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <div className="px-2.5 py-3 text-[0.6875rem] text-[var(--muted-foreground)]">No field preview.</div>
            )
          ) : primaryRows.length > 0 ? (
            <div className="max-h-80 overflow-auto">
              {primaryRows.map((row) => (
                <DekiActionDiffRowView key={row.path} row={row} />
              ))}
            </div>
          ) : (
            <div className="px-2.5 py-3 text-[0.6875rem] text-[var(--muted-foreground)]">No field preview.</div>
          )}
          <SideEffectRows title="Also deleted" tone="text-red-400" rows={alsoDeleted} />
          <SideEffectRows title="Also changed" tone="text-amber-500" rows={alsoChanged} />
          {pending.diffTruncated && (
            <div className="border-t border-[var(--border)]/70 px-2.5 py-1.5 text-[0.6875rem] text-[var(--muted-foreground)]">
              …and more rows; the counts above include every row.
            </div>
          )}
        </div>
      )}
      {error && (
        <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-red-500/10 px-2 py-1.5 text-[0.6875rem] text-red-500">
          <AlertCircle size="0.75rem" className="mt-[0.0625rem] shrink-0" />
          <span className="min-w-0">{error}</span>
        </div>
      )}
      {pending && (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          <span className="basis-full text-[0.6875rem] text-[var(--muted-foreground)] sm:mr-auto sm:basis-auto">
            {expiryLabel}
          </span>
          <button
            type="button"
            disabled={deciding}
            onClick={() => onDecide(false)}
            className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 sm:flex-none rounded-lg border border-[var(--border)] px-3 font-semibold text-[var(--foreground)]/75 transition-all hover:bg-[var(--accent)] active:scale-95 disabled:cursor-default disabled:opacity-60"
          >
            <X size="0.8125rem" />
            Reject
          </button>
          <button
            type="button"
            disabled={deciding}
            onClick={() => onDecide(true)}
            className={cn(
              "inline-flex h-8 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 font-semibold text-white sm:flex-none transition-all active:scale-95 disabled:cursor-wait",
              destructive
                ? "bg-red-500 hover:bg-red-400 disabled:bg-red-500/60"
                : "bg-emerald-500 hover:bg-emerald-400 disabled:bg-emerald-500/60",
            )}
          >
            {deciding ? <Loader2 size="0.8125rem" className="animate-spin" /> : <Check size="0.8125rem" />}
            {destructive ? "Delete" : "Approve"}
          </button>
        </div>
      )}
    </div>
  );
}
