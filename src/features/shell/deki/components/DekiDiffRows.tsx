import { cn } from "../../../../shared/lib/utils";
import type { DekiActionDiffPart, DekiActionDiffRow } from "../lib/deki-action-diff";

export function DekiActionDiffRowView({ row, create }: { row: DekiActionDiffRow; create: boolean }) {
  return (
    <div className="border-b border-[var(--border)]/60 px-2.5 py-2 last:border-b-0">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[0.6875rem] font-semibold text-[var(--foreground)]/85">
          {formatDekiActionDiffLabel(row.path)}
        </span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[0.625rem] font-semibold",
            row.status === "added" && "bg-emerald-500/10 text-emerald-500",
            row.status === "changed" && "bg-sky-500/10 text-sky-500",
            row.status === "removed" && "bg-red-500/10 text-red-500",
            row.status === "unchanged" && "bg-[var(--card)] text-[var(--muted-foreground)]",
          )}
        >
          {row.status}
        </span>
      </div>
      <DekiActionInlineDiff parts={create ? [{ text: row.after, kind: "added" }] : row.inlineDiff} />
    </div>
  );
}

export function formatDekiActionDiffLabel(path: string): string {
  const label = path
    .split(".")
    .filter((segment) => segment !== "data")
    .at(-1);
  const fallback = label || path;
  return fallback
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function DekiActionInlineDiff({ parts }: { parts: DekiActionDiffPart[] }) {
  return (
    <div className="min-h-9 whitespace-pre-wrap break-words rounded-md bg-[var(--card)]/70 px-2.5 py-2 text-[0.75rem] leading-relaxed text-[var(--foreground)]/85">
      {parts.length > 0
        ? parts.map((part, index) => (
            <span
              key={index}
              className={cn(
                part.kind === "added" && "rounded-sm bg-emerald-500/15 font-semibold text-emerald-400",
                part.kind === "removed" &&
                  "rounded-sm bg-red-500/10 text-red-400 line-through decoration-red-400/80 decoration-2",
              )}
            >
              {part.text}
            </span>
          ))
        : "-"}
    </div>
  );
}
