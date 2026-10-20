// ──────────────────────────────────────────────
// Generation runner: job registry
// ──────────────────────────────────────────────
// A job is one startGeneration run on the server. Every event it yields is kept, so a tab that reconnects (or a
// second device) can replay the reply from the start and then follow it live. Finished jobs stay readable for a
// while so a tab that reopens right after the reply still sees how it ended.

export interface RunnerEvent {
  type: string;
  data?: unknown;
}

export type JobStatus = "running" | "done" | "error" | "cancelled";

type Listener = (event: RunnerEvent | null) => void;

export interface RunnerJob {
  id: string;
  chatId: string;
  /** The generation input the client sent (minus anything that can't cross the wire). */
  input: Record<string, unknown>;
  status: JobStatus;
  startedAt: number;
  finishedAt: number | null;
  events: RunnerEvent[];
  controller: AbortController;
  listeners: Set<Listener>;
}

export const FINISHED_JOB_TTL_MS = 10 * 60 * 1000;

export class JobRegistry {
  private readonly jobs = new Map<string, RunnerJob>();

  constructor(private readonly now: () => number = Date.now) {}

  /** The running job for a chat, if any (one reply per chat at a time, like the app). */
  runningForChat(chatId: string): RunnerJob | null {
    for (const job of this.jobs.values()) if (job.chatId === chatId && job.status === "running") return job;
    return null;
  }

  get(id: string): RunnerJob | null {
    this.prune();
    return this.jobs.get(id) ?? null;
  }

  /** Jobs still running plus recently finished ones, newest first. */
  list(chatId?: string): RunnerJob[] {
    this.prune();
    return [...this.jobs.values()]
      .filter((job) => !chatId || job.chatId === chatId)
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  create(id: string, chatId: string, input: Record<string, unknown>): RunnerJob {
    const job: RunnerJob = {
      id,
      chatId,
      input,
      status: "running",
      startedAt: this.now(),
      finishedAt: null,
      events: [],
      controller: new AbortController(),
      listeners: new Set(),
    };
    this.jobs.set(id, job);
    return job;
  }

  push(job: RunnerJob, event: RunnerEvent): void {
    job.events.push(event);
    for (const listener of job.listeners) listener(event);
  }

  finish(job: RunnerJob, status: Exclude<JobStatus, "running">): void {
    if (job.status !== "running") return;
    job.status = status;
    job.finishedAt = this.now();
    for (const listener of job.listeners) listener(null);
    job.listeners.clear();
  }

  /**
   * Replays events from `from` (default: the start), then follows new ones until the job ends (or `signal`
   * aborts). Yields events in order with no gaps or repeats, so a client that lost its connection can resume
   * by passing how many events it already has.
   */
  async *follow(job: RunnerJob, signal?: AbortSignal, from = 0): AsyncGenerator<RunnerEvent> {
    let index = Math.max(0, Math.min(Math.floor(from), job.events.length));
    let wake: (() => void) | null = null;
    const listener: Listener = () => wake?.();
    job.listeners.add(listener);
    const onAbort = () => wake?.();
    signal?.addEventListener("abort", onAbort);
    try {
      for (;;) {
        while (index < job.events.length) yield job.events[index++]!;
        if (job.status !== "running" || signal?.aborted) return;
        await new Promise<void>((resolve) => (wake = resolve));
        wake = null;
      }
    } finally {
      job.listeners.delete(listener);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  private prune(): void {
    const cutoff = this.now() - FINISHED_JOB_TTL_MS;
    for (const [id, job] of this.jobs) {
      if (job.status !== "running" && (job.finishedAt ?? 0) < cutoff) this.jobs.delete(id);
    }
  }
}
