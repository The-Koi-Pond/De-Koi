import { useState, type ReactNode } from "react";
import { ArrowRight, ChevronDown } from "lucide-react";
import { cn } from "../../../../shared/lib/utils";
import type { DekiActionDiffPart, DekiActionDiffRow } from "../lib/deki-action-diff";
import { dekiDiffFieldLabel, presentDekiDiffRow, type DekiDiffPresentation } from "../lib/deki-diff-presentation";

export function DekiActionDiffRowView({ row }: { row: DekiActionDiffRow }) {
  const presentation = presentDekiDiffRow(row);
  return (
    <div className="border-b border-[var(--border)]/60 px-2.5 py-2 last:border-b-0">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[0.6875rem] font-semibold text-[var(--foreground)]/85">
          {dekiDiffFieldLabel(row.path, row.label)}
        </span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[0.625rem] font-semibold",
            row.statusLabel
              ? "bg-sky-500/10 text-sky-500"
              : [
                  row.status === "added" && "bg-emerald-500/10 text-emerald-500",
                  row.status === "changed" && "bg-sky-500/10 text-sky-500",
                  row.status === "removed" && "bg-red-500/10 text-red-500",
                  row.status === "unchanged" && "bg-[var(--card)] text-[var(--muted-foreground)]",
                ],
          )}
        >
          {row.statusLabel ?? row.status}
        </span>
      </div>
      <DekiTypedDiffBody presentation={presentation} />
    </div>
  );
}

export function formatDekiActionDiffLabel(path: string): string {
  return dekiDiffFieldLabel(path);
}

function DekiTypedDiffBody({ presentation }: { presentation: DekiDiffPresentation }) {
  switch (presentation.kind) {
    case "scalar":
      return <DekiBeforeAfter before={presentation.before} after={presentation.after} render={renderText} />;
    case "state":
      return <DekiBeforeAfter before={presentation.before} after={presentation.after} render={renderPill} />;
    case "color":
      return <DekiBeforeAfter before={presentation.before} after={presentation.after} render={renderSwatch} />;
    case "list":
      return <DekiListDiff added={presentation.added} removed={presentation.removed} kept={presentation.kept} />;
    case "prose":
      return <DekiProseDiff parts={presentation.parts} collapsible={presentation.collapsible} />;
  }
}

type Tone = "before" | "after";

function renderText(value: string, tone: Tone) {
  return (
    <span
      className={cn(
        "break-words",
        tone === "before" ? "text-red-400/90 line-through decoration-red-400/70" : "font-semibold text-emerald-400",
      )}
    >
      {value}
    </span>
  );
}

function renderPill(value: string, tone: Tone) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold",
        tone === "before"
          ? "bg-[var(--secondary)] text-[var(--muted-foreground)] line-through"
          : "bg-sky-500/10 text-sky-400",
      )}
    >
      {value}
    </span>
  );
}

function renderSwatch(value: string, tone: Tone) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-mono", tone === "before" && "opacity-70 line-through")}>
      <span
        className="inline-block h-3.5 w-3.5 shrink-0 rounded border border-[var(--border)]"
        style={{ background: value }}
        aria-hidden
      />
      {value}
    </span>
  );
}

function DekiBeforeAfter({
  before,
  after,
  render,
}: {
  before: string | null;
  after: string;
  render: (value: string, tone: Tone) => ReactNode;
}) {
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-2 rounded-md bg-[var(--card)]/70 px-2.5 py-2 text-[0.75rem] text-[var(--foreground)]/85">
      {before !== null && (
        <>
          {render(before, "before")}
          <ArrowRight size="0.75rem" className="shrink-0 text-[var(--muted-foreground)]" aria-label="becomes" />
        </>
      )}
      {after ? render(after, "after") : <span className="text-[var(--muted-foreground)]">(empty)</span>}
    </div>
  );
}

function DekiListDiff({ added, removed, kept }: { added: string[]; removed: string[]; kept: string[] }) {
  const chip = "inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-[0.6875rem] font-medium";
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md bg-[var(--card)]/70 px-2.5 py-2">
      {added.map((item, index) => (
        <span key={`added-${index}-${item}`} className={cn(chip, "bg-emerald-500/15 text-emerald-400")}>
          <span className="sr-only">Added: </span>+ {item}
        </span>
      ))}
      {removed.map((item, index) => (
        <span key={`removed-${index}-${item}`} className={cn(chip, "bg-red-500/10 text-red-400 line-through")}>
          <span className="sr-only">Removed: </span>
          {item}
        </span>
      ))}
      {kept.map((item, index) => (
        <span
          key={`kept-${index}-${item}`}
          className={cn(chip, "bg-[var(--secondary)] text-[var(--muted-foreground)]")}
        >
          {item}
        </span>
      ))}
      {added.length + removed.length + kept.length === 0 && (
        <span className="text-[0.75rem] text-[var(--muted-foreground)]">(empty)</span>
      )}
    </div>
  );
}

function DekiProseDiff({ parts, collapsible }: { parts: DekiActionDiffPart[]; collapsible: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const collapsed = collapsible && !expanded;
  return (
    <div className="grid gap-1">
      <div className={cn("relative", collapsed && "max-h-28 overflow-hidden")}>
        <DekiActionInlineDiff parts={parts} />
        {collapsed && (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-10 rounded-b-md bg-gradient-to-t from-[var(--card)] to-transparent"
            aria-hidden
          />
        )}
      </div>
      {collapsible && (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          className="inline-flex w-fit items-center gap-1 rounded-md px-1 py-0.5 text-[0.6875rem] font-semibold text-sky-400 transition-colors hover:text-sky-300"
        >
          <ChevronDown size="0.75rem" className={cn("transition-transform", expanded && "rotate-180")} aria-hidden />
          {expanded ? "Show less" : "Show full text"}
        </button>
      )}
    </div>
  );
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
