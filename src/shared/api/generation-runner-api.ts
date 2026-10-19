import { ApiError } from "./api-errors";
import {
  readRemoteError,
  remoteFetchInit,
  remoteHeaders,
  remoteRuntimeTarget,
  streamRemoteJsonEvents,
} from "./remote-runtime";

/** A reply running on the hosted runner, as listed by GET /runner/jobs. */
export interface RunnerJobSummary {
  id: string;
  chatId: string;
  status: "running" | "done" | "error" | "cancelled";
  startedAt: number;
  finishedAt: number | null;
  input: Record<string, unknown>;
}

const HEALTH_CACHE_MS = 60_000;
/** 1 + 2 + 4 + 8 + 15 x 7 seconds of retries, about two minutes. */
const RESUME_ATTEMPTS = 11;
let health: { baseUrl: string; ok: boolean; checkedAt: number } | null = null;

/**
 * True when this app talks to a hosted runtime that has the generation runner next to it (the Pi images ship it
 * from this version on). Cached for a minute; desktop installs never use it.
 */
export async function generationRunnerAvailable(): Promise<boolean> {
  const target = remoteRuntimeTarget();
  if (!target) return false;
  const now = Date.now();
  if (health && health.baseUrl === target.baseUrl && now - health.checkedAt < HEALTH_CACHE_MS) return health.ok;
  let ok = false;
  try {
    const response = await fetch(
      `${target.baseUrl}/runner/health`,
      remoteFetchInit({ headers: remoteHeaders(target) }),
    );
    ok = response.ok && ((await response.json()) as { ok?: unknown }).ok === true;
  } catch {
    // No runner (older install, or the runner container is down): replies run in the tab as before.
    ok = false;
  }
  health = { baseUrl: target.baseUrl, ok, checkedAt: now };
  return ok;
}

/** Forget the cached health result, e.g. after the runner refused a request. */
export function resetGenerationRunnerHealth(): void {
  health = null;
}

async function runnerFetch(path: string, init: RequestInit): Promise<Response> {
  const target = remoteRuntimeTarget();
  if (!target) throw new ApiError("Remote runtime URL is not configured", 400);
  const response = await fetch(
    `${target.baseUrl}${path}`,
    remoteFetchInit({
      ...init,
      headers: remoteHeaders(target, { "content-type": "application/json", ...init.headers }),
    }),
  );
  if (!response.ok) throw await readRemoteError(response);
  return response;
}

export const generationRunnerApi = {
  /** Starts a reply on the runner; returns its job id. */
  async start(input: Record<string, unknown>): Promise<string> {
    const response = await runnerFetch("/runner/generate", { method: "POST", body: JSON.stringify({ input }) });
    const body = (await response.json()) as { jobId?: unknown };
    if (typeof body.jobId !== "string" || !body.jobId) throw new ApiError("The runner did not return a job id", 500);
    return body.jobId;
  },

  /**
   * Every event of the job so far, then live ones, until it ends. Throws the job's error if it failed. A dropped
   * connection (phone asleep, wifi blip) is resumed from the last event received, for up to about two minutes.
   */
  async *follow(jobId: string, signal?: AbortSignal): AsyncGenerator<{ type: string; data?: unknown }> {
    let received = 0;
    let failures = 0;
    for (;;) {
      try {
        for await (const event of streamRemoteJsonEvents(
          `/runner/jobs/${encodeURIComponent(jobId)}/stream`,
          { from: received },
          { signal },
        )) {
          if (event.type === "runner_end") return;
          received += 1;
          failures = 0;
          yield event;
        }
        // The stream closed without runner_end (a proxy or network cut): resume below.
      } catch (error) {
        // HTTP errors and the job's own error come back as ApiError: those are final. Network failures are not.
        if (signal?.aborted || error instanceof ApiError) throw error;
      }
      failures += 1;
      if (failures > RESUME_ATTEMPTS) throw new ApiError("Lost the connection to the reply on the server", 503);
      await new Promise((resolve) => setTimeout(resolve, Math.min(15_000, 1_000 * 2 ** (failures - 1))));
    }
  },

  async cancel(jobId: string): Promise<void> {
    await runnerFetch(`/runner/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST", body: "{}" });
  },

  async list(chatId: string): Promise<RunnerJobSummary[]> {
    const response = await runnerFetch(`/runner/jobs?chatId=${encodeURIComponent(chatId)}`, { method: "GET" });
    const body = (await response.json()) as { jobs?: unknown };
    return Array.isArray(body.jobs) ? (body.jobs as RunnerJobSummary[]) : [];
  },
};
