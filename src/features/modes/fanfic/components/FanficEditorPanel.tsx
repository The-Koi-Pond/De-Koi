import { useMemo } from "react";
import { Loader2, PenTool, RefreshCw, Square, Wand2 } from "lucide-react";
import { useChat } from "../../../catalog/chats/index";
import {
  FANFIC_EDITOR_DIMENSIONS,
  FANFIC_EDITOR_LABELS,
  readFanficEditorStore,
  type FanficEditorReport,
} from "../../../../engine/modes/fanfic/editor";
import { fanficChapterTextKey } from "../../../../engine/modes/fanfic/ledger";
import { cn } from "../../../../shared/lib/utils";
import { fanficChapterViewRefs, type FanficChapterView, type FanficEditorController } from "../hooks/use-fanfic";
import { FanficButton } from "./fanfic-ui";

function scoreTone(value: number): string {
  if (value <= 4) return "border-red-400/40 bg-red-500/15 text-[var(--foreground)]";
  if (value <= 6) return "border-amber-400/40 bg-amber-500/15 text-[var(--foreground)]";
  return "border-[var(--border)] bg-[var(--secondary)]/40 text-[var(--muted-foreground)]";
}

function average(report: FanficEditorReport): number {
  return FANFIC_EDITOR_DIMENSIONS.reduce((sum, d) => sum + report.scores[d], 0) / FANFIC_EDITOR_DIMENSIONS.length;
}

function ReportRow({
  report,
  stale,
  busy,
  rewriting,
  controller,
  onRewritten,
}: {
  report: FanficEditorReport;
  stale: boolean;
  busy: boolean;
  rewriting: boolean;
  controller: FanficEditorController;
  onRewritten: (report: FanficEditorReport) => void;
}) {
  return (
    <li>
      <details className="group rounded-lg border border-[var(--border)] px-2.5 py-2">
        <summary className="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
          <span className="w-12 shrink-0 font-semibold text-[var(--foreground)]">Ch {report.chapter}</span>
          <span className="flex flex-wrap gap-1">
            {FANFIC_EDITOR_DIMENSIONS.map((dimension) => (
              <span
                key={dimension}
                title={`${FANFIC_EDITOR_LABELS[dimension]}: ${report.scores[dimension]}/10`}
                className={cn("rounded-md border px-1.5 py-0.5 tabular-nums", scoreTone(report.scores[dimension]))}
              >
                <span className="sr-only">{FANFIC_EDITOR_LABELS[dimension]} </span>
                {report.scores[dimension]}
              </span>
            ))}
          </span>
          <span className="text-[var(--muted-foreground)]">
            {report.flags.length > 0
              ? `${report.flags.length} ${report.flags.length === 1 ? "scene" : "scenes"} to rework`
              : "nothing flagged"}
            {stale ? " · changed since scored" : ""}
          </span>
        </summary>
        <div className="mt-2 flex flex-col gap-2 border-t border-[var(--border)] pt-2 text-xs leading-relaxed">
          <ul className="flex flex-col gap-0.5 text-[var(--muted-foreground)]">
            {FANFIC_EDITOR_DIMENSIONS.map((dimension) => (
              <li key={dimension}>
                <span className="font-semibold text-[var(--foreground)]">
                  {FANFIC_EDITOR_LABELS[dimension]} {report.scores[dimension]}:
                </span>{" "}
                {report.notes[dimension]}
              </li>
            ))}
          </ul>
          {report.flags.length > 0 && (
            <ol className="flex flex-col gap-1.5">
              {report.flags.map((flag) => (
                <li key={flag.startQuote} className="rounded-md border border-dashed border-[var(--border)] p-2">
                  <p className="font-semibold text-[var(--foreground)]">{FANFIC_EDITOR_LABELS[flag.dimension]}</p>
                  <p className="text-[var(--muted-foreground)]">
                    Scene from “{flag.startQuote}” to “{flag.endQuote}”
                  </p>
                  <p className="mt-0.5 text-[var(--foreground)]/85">{flag.problem}</p>
                  <p className="text-[var(--foreground)]/85">
                    <span className="font-semibold">Rewrite to:</span> {flag.direction}
                  </p>
                </li>
              ))}
            </ol>
          )}
          <div className="flex flex-wrap gap-2">
            {stale ? (
              <FanficButton disabled={busy} onClick={() => controller.run([report.messageId])}>
                <RefreshCw size="0.8rem" aria-hidden="true" />
                Score again
              </FanficButton>
            ) : (
              report.flags.length > 0 && (
                <FanficButton
                  tone="primary"
                  disabled={busy}
                  onClick={() => controller.rewrite(report, () => onRewritten(report))}
                >
                  {rewriting ? (
                    <Loader2 size="0.85rem" className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Wand2 size="0.85rem" aria-hidden="true" />
                  )}
                  Rewrite {report.flags.length === 1 ? "this scene" : `these ${report.flags.length} scenes`}
                </FanficButton>
              )
            )}
          </div>
          {!stale && report.flags.length > 0 && (
            <p className="text-[0.6875rem] text-[var(--muted-foreground)]">
              Only the flagged scenes change; the rest of the chapter stays word for word. It saves as a new version, so
              the current one is one tap back, and the chapter's continuity is checked right after, so a slip the
              rewrite made can be fixed in one tap.
            </p>
          )}
        </div>
      </details>
    </li>
  );
}

/**
 * The editor pass: each chapter scored on five story-level dimensions, with the scenes that drag them down flagged and
 * rewritable on their own.
 */
export function FanficEditorPanel({
  chatId,
  chapters,
  controller,
  busy,
  onRewritten,
}: {
  chatId: string;
  chapters: FanficChapterView[];
  controller: FanficEditorController;
  busy: boolean;
  /** A chapter's flagged scenes were rewritten and saved. */
  onRewritten: (report: FanficEditorReport) => void;
}) {
  const { data: chat } = useChat(chatId);
  const refs = useMemo(() => fanficChapterViewRefs(chapters), [chapters]);
  const store = useMemo(() => readFanficEditorStore(chat?.metadata), [chat?.metadata]);
  const rows = refs.map((chapter) => {
    const report = store.reports.find((entry) => entry.messageId === chapter.messageId) ?? null;
    return { chapter, report, stale: !!report && report.textKey !== fanficChapterTextKey(chapter.content) };
  });
  const scored = rows.filter((row) => row.report);
  const unscored = rows.length - scored.length;
  const staleCount = rows.filter((row) => row.stale).length;
  const working = controller.running !== null;
  const progress = controller.progress;
  const means = FANFIC_EDITOR_DIMENSIONS.map((dimension) =>
    scored.length ? scored.reduce((sum, row) => sum + row.report!.scores[dimension], 0) / scored.length : null,
  );

  return (
    <section
      aria-label="Editor pass"
      className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-sm sm:p-4"
    >
      <div>
        <h3 className="flex items-center gap-1.5 text-sm font-bold text-[var(--foreground)]">
          <PenTool size="0.95rem" aria-hidden="true" />
          Editor pass
        </h3>
        <p className="mt-0.5 text-xs leading-snug text-[var(--muted-foreground)]">
          A developmental editor's read of each chapter: do the stakes build, is a second thread moving, do characters
          make hard choices, does it show its theme instead of saying it, and is the exposition lean. Scenes that drag a
          chapter down can be rewritten on their own.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {working ? (
          <>
            <p className="text-[0.8125rem] text-[var(--foreground)]" role="status">
              <Loader2 size="0.85rem" className="mr-1 inline animate-spin" aria-hidden="true" />
              {controller.running === "pass" ? "Reading chapters" : "Rewriting scenes"}
              {progress ? `… ${progress.done} of ${progress.total} done.` : "…"}
            </p>
            <FanficButton onClick={controller.stop}>
              <Square size="0.8rem" aria-hidden="true" />
              Stop
            </FanficButton>
          </>
        ) : (
          (unscored > 0 || staleCount > 0) && (
            <FanficButton tone="primary" disabled={busy} onClick={() => controller.run()}>
              {scored.length === 0
                ? "Run editor pass"
                : `Score ${unscored + staleCount} new or changed ${unscored + staleCount === 1 ? "chapter" : "chapters"}`}
            </FanficButton>
          )
        )}
      </div>
      {scored.length > 0 && (
        <>
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[0.6875rem] text-[var(--muted-foreground)]">
            {FANFIC_EDITOR_DIMENSIONS.map((dimension, index) => (
              <li key={dimension}>
                {FANFIC_EDITOR_LABELS[dimension]}{" "}
                <span className="font-semibold text-[var(--foreground)] tabular-nums">{means[index]!.toFixed(1)}</span>
              </li>
            ))}
          </ul>
          <ol className="flex flex-col gap-1.5" aria-label="Chapter by chapter">
            {rows.map(({ chapter, report, stale }) =>
              report ? (
                <ReportRow
                  key={chapter.messageId}
                  report={report}
                  stale={stale}
                  busy={busy || working}
                  rewriting={controller.running === report.messageId}
                  controller={controller}
                  onRewritten={onRewritten}
                />
              ) : (
                <li
                  key={chapter.messageId}
                  className="rounded-lg border border-dashed border-[var(--border)] px-2.5 py-2 text-xs text-[var(--muted-foreground)]"
                >
                  Ch {chapter.number}: not scored yet
                </li>
              ),
            )}
          </ol>
          <p className="text-[0.6875rem] text-[var(--muted-foreground)]">
            Scores are out of 10, in the order above. Open a chapter for the editor's notes. Average across chapters:{" "}
            {(scored.reduce((sum, row) => sum + average(row.report!), 0) / scored.length).toFixed(1)}.
          </p>
        </>
      )}
    </section>
  );
}
