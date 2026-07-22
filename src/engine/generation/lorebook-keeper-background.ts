import type { StorageGateway } from "../capabilities/storage";

export interface ScheduleLorebookKeeperBackfillInput {
  storage: StorageGateway;
  chatId: string;
  run: () => Promise<void>;
  onDiagnostic?: (diagnostic: LorebookKeeperBackfillDiagnostic) => void;
  now?: () => number;
}

export interface LorebookKeeperBackfillDiagnostic {
  stage: "lorebook_keeper_backfill";
  status: "ok" | "error";
  durationMs: number;
  count: number;
}

interface LorebookKeeperBackfillJob {
  run: () => Promise<void>;
  onDiagnostic?: (diagnostic: LorebookKeeperBackfillDiagnostic) => void;
  now: () => number;
}

interface ScheduledLorebookKeeperBackfill {
  pendingJob: LorebookKeeperBackfillJob | null;
}

const scheduledByStorage = new WeakMap<StorageGateway, Map<string, ScheduledLorebookKeeperBackfill>>();

function deferToMacrotask(start: () => void): void {
  // The generator's yielded `done` resolves through microtasks before this worker can begin,
  // while the timer remains independent of whether the consumer requests another item.
  setTimeout(start, 0);
}

function jobFor(input: ScheduleLorebookKeeperBackfillInput): LorebookKeeperBackfillJob {
  return {
    run: input.run,
    onDiagnostic: input.onDiagnostic,
    now: input.now ?? Date.now,
  };
}

function reportDiagnostic(
  job: LorebookKeeperBackfillJob,
  status: LorebookKeeperBackfillDiagnostic["status"],
  startedAt: number,
): void {
  if (!job.onDiagnostic) return;
  try {
    const elapsed = job.now() - startedAt;
    job.onDiagnostic({
      stage: "lorebook_keeper_backfill",
      status,
      durationMs: Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0,
      count: 1,
    });
  } catch {
    // Optional diagnostics must never affect background work or queue progress.
  }
}

export function scheduleLorebookKeeperBackfill(input: ScheduleLorebookKeeperBackfillInput): boolean {
  const chatId = input.chatId.trim();
  if (!chatId) return false;

  const scheduled = scheduledByStorage.get(input.storage) ?? new Map<string, ScheduledLorebookKeeperBackfill>();
  scheduledByStorage.set(input.storage, scheduled);
  const active = scheduled.get(chatId);
  if (active) {
    active.pendingJob = jobFor(input);
    return true;
  }

  const state: ScheduledLorebookKeeperBackfill = { pendingJob: null };
  scheduled.set(chatId, state);
  const initialJob = jobFor(input);
  deferToMacrotask(() => {
    void runScheduledLorebookKeeperBackfills(input.storage, chatId, initialJob, state, scheduled);
  });
  return true;
}

async function runScheduledLorebookKeeperBackfills(
  storage: StorageGateway,
  chatId: string,
  initialJob: LorebookKeeperBackfillJob,
  state: ScheduledLorebookKeeperBackfill,
  scheduled: Map<string, ScheduledLorebookKeeperBackfill>,
): Promise<void> {
  let job: LorebookKeeperBackfillJob | null = initialJob;
  try {
    while (job) {
      const startedAt = job.now();
      try {
        await job.run();
        reportDiagnostic(job, "ok", startedAt);
      } catch {
        reportDiagnostic(job, "error", startedAt);
      }
      job = state.pendingJob;
      state.pendingJob = null;
    }
  } finally {
    scheduled.delete(chatId);
    if (scheduled.size === 0) scheduledByStorage.delete(storage);
  }
}
