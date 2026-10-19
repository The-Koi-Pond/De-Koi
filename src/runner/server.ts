// ──────────────────────────────────────────────
// Generation runner (hosted installs)
// ──────────────────────────────────────────────
// Runs replies on the server instead of in the browser tab, so a reply keeps going (and gets saved) when the tab
// closes or the phone locks. It runs the same engine code as the app (startGeneration) against the de-koi-server
// runtime API, with the same storage/LLM adapters the web app uses in remote mode.
//
//   GET  /runner/health
//   POST /runner/generate            { input }  -> { jobId }   (409 + jobId when the chat already has one running)
//   POST /runner/jobs/{id}/stream    { from? } server-sent events from event #from (default 0), live ones, then runner_end
//   POST /runner/jobs/{id}/cancel
//   GET  /runner/jobs?chatId=...     running and recently finished jobs
//
// Env: DE_KOI_RUNTIME_URL (default http://de-koi-server:8787), DE_KOI_RUNNER_ADDR (default 0.0.0.0:8790),
// BASIC_AUTH_USER / BASIC_AUTH_PASS (same as the server: required on incoming requests, sent on outgoing ones),
// CSRF_TRUSTED_ORIGINS (browser Origins allowed to start or cancel replies).
import http from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { JobRegistry, type RunnerEvent, type RunnerJob } from "./jobs";
import { runGenerationJob, configureRuntime } from "./engine";

const VERSION = 1;
const MAX_BODY_BYTES = 8 * 1024 * 1024;

interface RunnerConfig {
  runtimeUrl: string;
  addr: string;
  basicAuth: string | null;
  trustedOrigins: Set<string>;
}

function readConfig(env: NodeJS.ProcessEnv): RunnerConfig {
  const user = env.BASIC_AUTH_USER?.trim() ?? "";
  const pass = env.BASIC_AUTH_PASS ?? "";
  const runtime = new URL(env.DE_KOI_RUNTIME_URL?.trim() || "http://de-koi-server:8787");
  if (user) {
    runtime.username = encodeURIComponent(user);
    runtime.password = encodeURIComponent(pass);
  }
  return {
    runtimeUrl: runtime.toString(),
    addr: env.DE_KOI_RUNNER_ADDR?.trim() || "0.0.0.0:8790",
    basicAuth: user ? `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}` : null,
    trustedOrigins: new Set(
      (env.CSRF_TRUSTED_ORIGINS ?? env.CORS_ORIGINS ?? "")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  };
}

function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "Request body too large");
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return {};
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new HttpError(400, "Expected a JSON object");
  return parsed as Record<string, unknown>;
}

function jobSummary(job: RunnerJob) {
  return {
    id: job.id,
    chatId: job.chatId,
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    input: job.input,
  };
}

export function createRunnerServer(config: RunnerConfig, registry = new JobRegistry()): http.Server {
  configureRuntime(config.runtimeUrl);

  const authorize = (req: http.IncomingMessage) => {
    if (config.basicAuth && !sameSecret(String(req.headers.authorization ?? ""), config.basicAuth)) {
      throw new HttpError(401, "Unauthorized");
    }
    if (req.method === "POST") {
      // Same guard as the runtime API: a custom header a plain cross-site form can't send, plus the Origin check.
      if (req.headers["x-marinara-csrf"] !== "1") throw new HttpError(403, "Missing CSRF header");
      const origin = req.headers.origin;
      if (origin && config.trustedOrigins.size > 0 && !config.trustedOrigins.has(origin)) {
        throw new HttpError(403, `Origin ${origin} is not trusted`);
      }
    }
  };

  const startJob = (input: Record<string, unknown>): RunnerJob => {
    const chatId = typeof input.chatId === "string" ? input.chatId.trim() : "";
    if (!chatId) throw new HttpError(400, "input.chatId is required");
    const running = registry.runningForChat(chatId);
    if (running) throw new HttpError(409, "A reply is already running for this chat", { jobId: running.id });
    const job = registry.create(randomUUID(), chatId, input);
    void (async () => {
      try {
        for await (const event of runGenerationJob(input, job.controller.signal)) registry.push(job, event);
        registry.finish(job, job.controller.signal.aborted ? "cancelled" : "done");
      } catch (error) {
        const cancelled = job.controller.signal.aborted;
        if (!cancelled) {
          registry.push(job, {
            type: "error",
            data: { message: error instanceof Error ? error.message : String(error) },
          });
          console.error(`[runner] job ${job.id} for chat ${chatId} failed:`, error);
        }
        registry.finish(job, cancelled ? "cancelled" : "error");
      }
    })();
    return job;
  };

  const streamJob = async (req: http.IncomingMessage, res: http.ServerResponse, job: RunnerJob, from: number) => {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    const closed = new AbortController();
    req.on("close", () => closed.abort());
    const keepAlive = setInterval(() => res.write(": keep-alive\n\n"), 15_000);
    const write = (event: RunnerEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);
    try {
      for await (const event of registry.follow(job, closed.signal, from)) write(event);
      if (!closed.signal.aborted) write({ type: "runner_end", data: { status: job.status } });
    } finally {
      clearInterval(keepAlive);
      res.end();
    }
  };

  return http.createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", "http://runner");
        const path = url.pathname.replace(/\/+$/, "");
        if (req.method === "GET" && path === "/runner/health") {
          sendJson(res, 200, {
            ok: true,
            version: VERSION,
            running: registry.list().filter((j) => j.status === "running").length,
          });
          return;
        }
        authorize(req);
        if (req.method === "POST" && path === "/runner/generate") {
          const body = await readJson(req);
          const input = body.input && typeof body.input === "object" ? (body.input as Record<string, unknown>) : null;
          if (!input) throw new HttpError(400, "Expected { input }");
          sendJson(res, 202, { jobId: startJob(input).id });
          return;
        }
        if (req.method === "GET" && path === "/runner/jobs") {
          const chatId = url.searchParams.get("chatId")?.trim() || undefined;
          sendJson(res, 200, { jobs: registry.list(chatId).map(jobSummary) });
          return;
        }
        const match = path.match(/^\/runner\/jobs\/([A-Za-z0-9-]+)\/(stream|cancel)$/);
        if (req.method === "POST" && match) {
          const job = registry.get(match[1]!);
          if (!job) throw new HttpError(404, "No such reply (it may have finished a while ago)");
          if (match[2] === "cancel") {
            job.controller.abort();
            sendJson(res, 200, { status: job.status === "running" ? "cancelling" : job.status });
            return;
          }
          const body = await readJson(req);
          const from = typeof body.from === "number" && Number.isFinite(body.from) ? body.from : 0;
          await streamJob(req, res, job, from);
          return;
        }
        throw new HttpError(404, "Not found");
      } catch (error) {
        if (res.headersSent) {
          res.end();
          return;
        }
        if (error instanceof HttpError) {
          sendJson(res, error.status, { error: error.message, ...error.extra });
          return;
        }
        if (error instanceof SyntaxError) {
          sendJson(res, 400, { error: "Invalid JSON" });
          return;
        }
        console.error("[runner] request failed:", error);
        sendJson(res, 500, { error: error instanceof Error ? error.message : "Runner error" });
      }
    })();
  });
}

export function startRunner(env: NodeJS.ProcessEnv = process.env): http.Server {
  const config = readConfig(env);
  const server = createRunnerServer(config);
  const separator = config.addr.lastIndexOf(":");
  const host = config.addr.slice(0, separator) || "0.0.0.0";
  const port = Number(config.addr.slice(separator + 1));
  server.listen(port, host, () =>
    console.log(`[runner] listening on ${host}:${port}, runtime ${new URL(config.runtimeUrl).origin}`),
  );
  return server;
}
