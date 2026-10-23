import { describeHelperRun, findHelperRun, type HelperRun } from "../../../../engine/generation/helper-runs";
import type { ModelRouteTask } from "../../../../engine/generation/model-routing";
import { useHelperRuns } from "../hooks/use-helper-runs";

const WHEN = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** "Ran (outline) on Cheap • small-model: your Helper Models pick for Fanfic planning." with the time it ran. */
export function HelperRunText({ run, className }: { run: HelperRun; className?: string }) {
  return (
    <p
      data-helper-run={run.task}
      className={
        className ??
        (run.problem
          ? "text-[0.6875rem] leading-snug text-[var(--destructive)]"
          : "text-[0.6875rem] leading-snug text-[var(--muted-foreground)]")
      }
    >
      {describeHelperRun(run)}{" "}
      <time dateTime={run.at} className="whitespace-nowrap">
        {WHEN.format(new Date(run.at))}
      </time>
    </p>
  );
}

/** The last run of one helper job in one chat, or nothing when it hasn't run there. */
export function HelperRunNote({
  task,
  job,
  chatId,
  className,
}: {
  task: ModelRouteTask;
  job?: string;
  chatId?: string | null;
  className?: string;
}) {
  const { data } = useHelperRuns();
  const run = findHelperRun(data, task, { job, chatId });
  return run ? <HelperRunText run={run} className={className} /> : null;
}
