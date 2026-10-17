import { useMemo, useState } from "react";
import { Gauge, Loader2, Square, Trash2 } from "lucide-react";
import { useChat } from "../../../catalog/chats/index";
import { useConnections } from "../../../catalog/connections/index";
import type { FanficQualityGroupId, FanficQualityRun } from "../../../../engine/contracts/types/fanfic";
import {
  FANFIC_CONTINUITY_CATEGORY_LABELS,
  FANFIC_QUALITY_CRITERIA,
  FANFIC_QUALITY_GROUP_LABELS,
  fanficTextKey,
  readFanficQualityStore,
  type FanficQualityPhase,
} from "../../../../engine/modes/fanfic/quality";
import { stripFanficChapterHeading } from "../../../../engine/modes/fanfic/prompts";
import { showConfirmDialog } from "../../../../shared/lib/app-dialogs";
import { filterLanguageGenerationConnections } from "../../../../shared/lib/connection-filters";
import { applyInlineMarkdown } from "../../../../shared/lib/markdown";
import { cn } from "../../../../shared/lib/utils";
import { useFanficQuality } from "../hooks/use-fanfic";
import { FanficButton, fanficInputClass } from "./fanfic-ui";

const PHASE_LABELS: Record<FanficQualityPhase, string> = {
  counting: "Counting habits and repeats…",
  judging: "The judge is reading the whole fic…",
  verifying_continuity: "Double-checking the continuity slips it found…",
};

const GROUPS = Object.keys(FANFIC_QUALITY_GROUP_LABELS) as FanficQualityGroupId[];
const GROUP_SHORT_LABELS: Record<FanficQualityGroupId, string> = {
  creativity: "Creat.",
  coherence: "Coher.",
  character: "Char.",
  prose: "Prose",
};

function judgeName(run: FanficQualityRun): string {
  return run.judge.model || run.judge.connectionName || "unknown model";
}

/** Same judge prompt and model: only then do score changes mean the fic changed, not the judge. */
function comparable(left: FanficQualityRun, right: FanficQualityRun): boolean {
  return left.judgeVersion === right.judgeVersion && judgeName(left) === judgeName(right);
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** A change within `noise` (how far the judge's own reads disagreed) is shown greyed out: it may not be real. */
function Delta({
  now,
  before,
  lowerIsBetter,
  noise = 0,
}: {
  now: number;
  before: number | null;
  lowerIsBetter?: boolean;
  noise?: number;
}) {
  if (before === null) return null;
  const change = Math.round((now - before) * 10) / 10;
  if (change === 0) return <span className="text-[0.6875rem] text-[var(--muted-foreground)]">±0</span>;
  if (Math.abs(change) <= noise) {
    return (
      <span
        className="text-[0.6875rem] text-[var(--muted-foreground)]"
        title="Within the judge's own noise"
        aria-label={`changed by ${change}, within the judge's noise`}
      >
        {change > 0 ? "+" : "−"}
        {Math.abs(change)} (noise)
      </span>
    );
  }
  const better = lowerIsBetter ? change < 0 : change > 0;
  return (
    <span
      className={cn("text-[0.6875rem] font-semibold", better ? "text-emerald-500" : "text-rose-500")}
      aria-label={`${better ? "better" : "worse"} by ${Math.abs(change)}`}
    >
      {change > 0 ? "▲" : "▼"} {Math.abs(change)}
    </span>
  );
}

function Tile({
  label,
  value,
  unit,
  before,
  lowerIsBetter,
  hint,
  strong,
  noise,
}: {
  label: string;
  value: number;
  unit: string;
  before: number | null;
  lowerIsBetter?: boolean;
  hint?: string;
  strong?: boolean;
  noise?: number;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--secondary)]/35 px-2.5 py-2",
        strong && "border-[var(--primary)]/50 bg-[var(--primary)]/10",
      )}
    >
      <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
        {label}
      </span>
      <span className="flex flex-wrap items-baseline gap-x-1.5">
        <span className={cn("font-bold text-[var(--foreground)]", strong ? "text-xl" : "text-base")}>{value}</span>
        <span className="text-[0.6875rem] text-[var(--muted-foreground)]">{unit}</span>
        <Delta now={value} before={before} lowerIsBetter={lowerIsBetter} noise={noise} />
      </span>
      {hint && <span className="text-[0.6875rem] leading-tight text-[var(--muted-foreground)]">{hint}</span>}
    </div>
  );
}

function RunDetails({ run, prior }: { run: FanficQualityRun; prior: FanficQualityRun | null }) {
  const [open, setOpen] = useState<"notes" | "scores" | null>(null);
  const { mechanics, rubric, continuity } = run;
  const notCounted = continuity.ungrounded + continuity.rejected;
  // Older runs saved before averaging have no spread; treat them as exact.
  // With the same text, any change is the judge reading it differently. Otherwise use how far its own reads disagreed.
  const sameText = Boolean(prior && prior.textKey === run.textKey);
  const noise = sameText ? Number.POSITIVE_INFINITY : Math.max(rubric.spread ?? 0, prior?.rubric.spread ?? 0);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-[var(--muted-foreground)]">
        {run.label ? <span className="font-semibold text-[var(--foreground)]">{run.label} · </span> : null}
        {formatDate(run.createdAt)} · {run.chapterCount} {run.chapterCount === 1 ? "chapter" : "chapters"},{" "}
        {mechanics.words.toLocaleString()} words · judged by {judgeName(run)}
        {rubric.passes > 1 ? `, ${rubric.passes} reads ${rubric.spread} apart` : ""}
        {prior ? ` · compared with ${prior.label || formatDate(prior.createdAt)}${sameText ? " (same text)" : ""}` : ""}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile
          label="Overall"
          value={rubric.overall}
          unit="/10"
          before={prior?.rubric.overall ?? null}
          noise={noise}
          strong
        />
        {GROUPS.map((group) => (
          <Tile
            key={group}
            label={FANFIC_QUALITY_GROUP_LABELS[group]}
            value={rubric.groups[group]}
            unit="/10"
            before={prior?.rubric.groups[group] ?? null}
            noise={noise}
          />
        ))}
        <Tile
          label="AI habits"
          value={mechanics.aiTellsPer1k}
          unit="per 1k words"
          before={prior?.mechanics.aiTellsPer1k ?? null}
          lowerIsBetter
          hint="Lower is better"
        />
        <Tile
          label="Repeats"
          value={mechanics.repeatUsesPer1k}
          unit="per 1k words"
          before={prior?.mechanics.repeatUsesPer1k ?? null}
          lowerIsBetter
          hint={
            mechanics.repeats.length > 0
              ? mechanics.repeats
                  .slice(0, 2)
                  .map((repeat) => `“${repeat.term}” ${repeat.count}×`)
                  .join(", ")
              : "Nothing overused"
          }
        />
        <Tile
          label="Continuity"
          value={continuity.issues.length}
          unit={continuity.issues.length === 1 ? "slip" : "slips"}
          before={prior ? prior.continuity.issues.length : null}
          lowerIsBetter
          noise={sameText ? noise : 0}
          hint={`${continuity.per10k} per 10k words`}
        />
      </div>

      {continuity.issues.length > 0 && (
        <ol className="flex flex-col gap-2" aria-label="Continuity slips">
          {continuity.issues.map((issue, index) => (
            <li
              key={`${issue.earlierQuote}-${index}`}
              className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-2.5 text-xs leading-relaxed"
            >
              <p className="font-semibold text-[var(--foreground)]">
                {FANFIC_CONTINUITY_CATEGORY_LABELS[issue.category]}
                {issue.subtype ? ` · ${issue.subtype}` : ""}
              </p>
              <p className="mt-1 text-[var(--muted-foreground)]">
                <span className="font-semibold text-[var(--foreground)]">Ch {issue.earlierChapter}:</span> “
                {issue.earlierQuote}”
              </p>
              <p className="text-[var(--muted-foreground)]">
                <span className="font-semibold text-[var(--foreground)]">Ch {issue.laterChapter}:</span> “
                {issue.laterQuote}”
              </p>
              <p className="mt-1 text-[var(--foreground)]/85">{issue.explanation}</p>
            </li>
          ))}
        </ol>
      )}
      {notCounted > 0 && (
        <p className="text-[0.6875rem] text-[var(--muted-foreground)]">
          Not counted: {continuity.ungrounded > 0 && `${continuity.ungrounded} quoted lines that aren't in the fic`}
          {continuity.ungrounded > 0 && continuity.rejected > 0 && ", "}
          {continuity.rejected > 0 && `${continuity.rejected} that didn't hold up on a second read`}.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <FanficButton onClick={() => setOpen(open === "notes" ? null : "notes")} aria-expanded={open === "notes"}>
          {open === "notes" ? "Hide critic's notes" : "Critic's notes"}
        </FanficButton>
        <FanficButton onClick={() => setOpen(open === "scores" ? null : "scores")} aria-expanded={open === "scores"}>
          {open === "scores" ? "Hide all scores" : "All 16 scores"}
        </FanficButton>
      </div>
      {open === "notes" && (
        <p className="text-[0.8125rem] leading-relaxed text-[var(--foreground)]/90">
          {rubric.analysis
            ? rubric.analysis
                .split("\n")
                .flatMap((line, index) => [
                  index > 0 ? <br key={`br-${index}`} /> : null,
                  ...applyInlineMarkdown(line, `notes-${index}`),
                ])
            : "The judge left no notes."}
        </p>
      )}
      {open === "scores" && (
        <ul className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
          {FANFIC_QUALITY_CRITERIA.map((criterion) => (
            <li key={criterion.id} className="flex justify-between gap-2 border-b border-[var(--border)]/60 py-0.5">
              <span className="text-[var(--muted-foreground)]">
                {criterion.name}
                {criterion.negative && <span className="text-[0.6875rem]"> (fault, lower is better)</span>}
              </span>
              <span className="font-semibold text-[var(--foreground)]">{rubric.criteria[criterion.id]}/20</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function History({
  runs,
  selectedId,
  onSelect,
  onDelete,
  deleting,
}: {
  runs: FanficQualityRun[];
  selectedId: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  deleting: boolean;
}) {
  const newestFirst = [...runs].reverse();
  const judges = new Set(runs.map((run) => `${judgeName(run)} v${run.judgeVersion}`));
  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-xs font-bold text-[var(--foreground)]">All runs</h4>
      <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
        <table className="w-full min-w-[34rem] text-left text-xs">
          <thead className="bg-[var(--secondary)]/40 text-[0.6875rem] uppercase tracking-wide text-[var(--muted-foreground)]">
            <tr>
              <th scope="col" className="px-2 py-1.5 font-semibold">
                Run
              </th>
              <th scope="col" className="px-2 py-1.5 font-semibold">
                Overall
              </th>
              {GROUPS.map((group) => (
                <th key={group} scope="col" className="px-2 py-1.5 font-semibold">
                  {GROUP_SHORT_LABELS[group]}
                </th>
              ))}
              <th scope="col" className="px-2 py-1.5 font-semibold" title="AI habits per 1k words">
                AI/1k
              </th>
              <th scope="col" className="px-2 py-1.5 font-semibold" title="Repeat uses per 1k words">
                Rep/1k
              </th>
              <th scope="col" className="px-2 py-1.5 font-semibold" title="Continuity slips">
                Slips
              </th>
              <th scope="col" className="px-2 py-1.5">
                <span className="sr-only">Delete</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {newestFirst.map((run, index) => {
              const older = newestFirst[index + 1];
              const sameText = older && older.textKey === run.textKey;
              const selected = run.id === selectedId;
              return (
                <tr
                  key={run.id}
                  aria-selected={selected}
                  className={cn(
                    "border-t border-[var(--border)]/70",
                    selected ? "bg-[var(--primary)]/10" : "hover:bg-[var(--accent)]/30",
                  )}
                >
                  <td className="px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => onSelect(run.id)}
                      className="text-left font-semibold text-[var(--foreground)] underline-offset-2 hover:underline"
                    >
                      {run.label || formatDate(run.createdAt)}
                    </button>
                    <span className="block text-[0.6875rem] text-[var(--muted-foreground)]">
                      {run.label ? `${formatDate(run.createdAt)} · ` : ""}
                      {run.chapterCount} ch{sameText ? " · same text" : ""}
                      {judges.size > 1 ? ` · ${judgeName(run)}` : ""}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 font-semibold">{run.rubric.overall}</td>
                  {GROUPS.map((group) => (
                    <td key={group} className="px-2 py-1.5">
                      {run.rubric.groups[group]}
                    </td>
                  ))}
                  <td className="px-2 py-1.5">{run.mechanics.aiTellsPer1k}</td>
                  <td className="px-2 py-1.5">{run.mechanics.repeatUsesPer1k}</td>
                  <td className="px-2 py-1.5">{run.continuity.issues.length}</td>
                  <td className="px-1 py-1.5 text-right">
                    <button
                      type="button"
                      aria-label={`Delete run ${run.label || formatDate(run.createdAt)}`}
                      disabled={deleting}
                      onClick={() => onDelete(run.id)}
                      className="inline-flex size-7 items-center justify-center rounded-md text-[var(--muted-foreground)] hover:bg-red-500/15 hover:text-red-400 disabled:opacity-50"
                    >
                      <Trash2 size="0.8rem" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {judges.size > 1 && (
        <p className="text-[0.6875rem] text-[var(--muted-foreground)]">
          Runs judged by different models score differently, so compare runs from the same judge.
        </p>
      )}
    </div>
  );
}

/**
 * Whole-fic quality check: detector counts, a critic's rubric, and quoted continuity slips, saved per run so a fic
 * can be compared before and after rewrites.
 */
export function FanficQualityPanel({
  chatId,
  chapterTexts,
  busy,
}: {
  chatId: string;
  chapterTexts: string[];
  busy: boolean;
}) {
  const { data: chat } = useChat(chatId);
  const connectionId = chat?.connectionId ?? null;
  const runs = useMemo(() => readFanficQualityStore(chat?.metadata).runs, [chat?.metadata]);
  const { data: connections } = useConnections();
  const judges = useMemo(
    () =>
      filterLanguageGenerationConnections(
        (connections ?? []) as Array<{ id: string; name?: string; provider?: string; model?: string }>,
      ),
    [connections],
  );
  const lastJudge = runs.at(-1)?.judge.connectionId ?? null;
  const preferred = [lastJudge, connectionId].find((id) => id && judges.some((judge) => judge.id === id));
  const [judgeId, setJudgeId] = useState<string | null>(null);
  const activeJudge = judgeId ?? preferred ?? judges[0]?.id ?? null;
  const [label, setLabel] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { run, remove, phase, stop } = useFanficQuality(chatId);

  const found = runs.findIndex((entry) => entry.id === selectedId);
  const shownIndex = found >= 0 ? found : runs.length - 1;
  const shown = runs[shownIndex] ?? null;
  const previous = shown
    ? ([...runs.slice(0, Math.max(0, shownIndex))].reverse().find((entry) => comparable(entry, shown)) ?? null)
    : null;
  const currentKey = useMemo(
    () => fanficTextKey(chapterTexts.map((text) => stripFanficChapterHeading(text))),
    [chapterTexts],
  );
  const latest = runs.at(-1);
  const deleteRun = async (id: string) => {
    const confirmed = await showConfirmDialog({
      title: "Delete run",
      message: "Delete this quality run? Its scores can't be brought back.",
      confirmLabel: "Delete run",
      tone: "destructive",
    });
    if (confirmed) remove.mutate(id);
  };
  const changedSinceLatest = Boolean(latest && latest.textKey !== currentKey);

  return (
    <section
      aria-label="Quality check"
      className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-sm sm:p-4"
    >
      <div>
        <h3 className="flex items-center gap-1.5 text-sm font-bold text-[var(--foreground)]">
          <Gauge size="1rem" aria-hidden="true" />
          Quality check
        </h3>
        <p className="mt-0.5 text-xs leading-snug text-[var(--muted-foreground)]">
          Scores the whole fic as it reads now: AI-sounding habits and repeats are counted, a judge model rates it like
          a critic and lists continuity slips with quotes from both chapters. Every run is saved here so you can compare
          before and after rewrites. The judge gets the whole fic five times (mostly at once), so a long fic takes a few
          minutes.
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor="fanfic-quality-judge" className="text-[0.8125rem] font-semibold text-[var(--foreground)]">
            Judge
          </label>
          <select
            id="fanfic-quality-judge"
            className={fanficInputClass}
            value={activeJudge ?? ""}
            onChange={(event) => setJudgeId(event.target.value || null)}
            disabled={run.isPending}
          >
            {judges.length === 0 && <option value="">Add a text model connection first</option>}
            {judges.map((judge) => (
              <option key={judge.id} value={judge.id}>
                {judge.name || judge.model || judge.id}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor="fanfic-quality-label" className="text-[0.8125rem] font-semibold text-[var(--foreground)]">
            Label (optional)
          </label>
          <input
            id="fanfic-quality-label"
            className={fanficInputClass}
            value={label}
            maxLength={80}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Before clean-up"
            disabled={run.isPending}
          />
        </div>
        {run.isPending ? (
          <FanficButton onClick={stop} className="min-h-10">
            <Square size="0.8rem" aria-hidden="true" />
            Stop
          </FanficButton>
        ) : (
          <FanficButton
            tone="primary"
            className="min-h-10"
            disabled={busy || !activeJudge || chapterTexts.length === 0}
            onClick={() =>
              run.mutate(
                { connectionId: activeJudge, label },
                {
                  onSuccess: () => {
                    setLabel("");
                    setSelectedId(null);
                  },
                },
              )
            }
          >
            <Gauge size="0.9rem" aria-hidden="true" />
            {runs.length > 0 ? "Score again" : "Score this fic"}
          </FanficButton>
        )}
      </div>
      {run.isPending && (
        <p role="status" className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
          <Loader2 size="0.9rem" className="animate-spin text-[var(--primary)]" aria-hidden="true" />
          {phase ? PHASE_LABELS[phase] : "Starting…"}
        </p>
      )}
      {changedSinceLatest && !run.isPending && (
        <p className="text-xs text-[var(--muted-foreground)]">The fic has changed since the last run.</p>
      )}

      {shown ? (
        <RunDetails key={shown.id} run={shown} prior={previous} />
      ) : (
        !run.isPending && <p className="text-xs text-[var(--muted-foreground)]">No runs yet.</p>
      )}
      {runs.length > 1 && (
        <History
          runs={runs}
          selectedId={shown?.id ?? ""}
          onSelect={setSelectedId}
          onDelete={(id) => void deleteRun(id)}
          deleting={remove.isPending}
        />
      )}
    </section>
  );
}
