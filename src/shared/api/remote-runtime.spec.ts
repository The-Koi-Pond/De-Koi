import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "./api-errors";
import {
  checkRemoteRuntimeHealth,
  invokeRemote,
  readRemoteError,
  REMOTE_FINITE_REQUEST_TIMEOUT_MS,
  REMOTE_LLM_STREAM_IDLE_TIMEOUT_MS,
  remoteRuntimeTarget,
  streamRemoteLlm,
} from "./remote-runtime";
import { useUIStore } from "../stores/ui.store";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function textResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 502,
    headers: { "content-type": "text/plain" },
    ...init,
  });
}

function stubFetch(responses: Response[]) {
  const fetchMock = vi.fn<typeof fetch>();
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response);
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("checkRemoteRuntimeHealth", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("fails a hanging finite health request with a distinguishable default timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation((_input, init) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        });
      }),
    );

    const pending = checkRemoteRuntimeHealth("http://127.0.0.1:3080");
    const rejection = expect(pending).rejects.toMatchObject({
      name: "ApiError",
      status: 504,
      details: {
        code: "remote_runtime_timeout",
        timeoutMs: REMOTE_FINITE_REQUEST_TIMEOUT_MS,
      },
    });
    await vi.advanceTimersByTimeAsync(REMOTE_FINITE_REQUEST_TIMEOUT_MS);

    await rejection;
  });

  it("preserves explicit caller cancellation instead of relabeling it as a timeout", async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const abortError = new DOMException("Cancelled by the caller.", "AbortError");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation((_input, init) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        });
      }),
    );

    const pending = checkRemoteRuntimeHealth("http://127.0.0.1:3080", { signal: caller.signal });
    caller.abort(abortError);

    await expect(pending).rejects.toBe(abortError);
  });

  it("does not arm a request deadline before URL validation succeeds", async () => {
    vi.useFakeTimers();

    await expect(checkRemoteRuntimeHealth("not a runtime URL")).resolves.toEqual({
      status: "invalid",
      message: "Remote Runtime URL is invalid.",
    });

    expect(vi.getTimerCount()).toBe(0);
  });

  it("accepts the De-Koi server health marker", async () => {
    const fetchMock = stubFetch([
      jsonResponse({ ok: true, runtime: "de-koi-server", writable: true }),
      jsonResponse([]),
    ]);

    await expect(checkRemoteRuntimeHealth("http://127.0.0.1:3080")).resolves.toMatchObject({
      status: "ok",
      health: { runtime: "de-koi-server" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:3080/health?probe=1",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:3080/api/invoke",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("keeps accepting the legacy Marinara server health marker", async () => {
    stubFetch([jsonResponse({ ok: true, runtime: "marinara-server", writable: true }), jsonResponse([])]);

    await expect(checkRemoteRuntimeHealth("http://127.0.0.1:3080")).resolves.toMatchObject({
      status: "ok",
      health: { runtime: "marinara-server" },
    });
  });

  it("treats an API invoke rate limit as a reachable busy runtime", async () => {
    stubFetch([
      jsonResponse({ ok: true, runtime: "de-koi-server", writable: true }),
      jsonResponse({ code: "rate_limited", message: "Too many requests" }, { status: 429 }),
    ]);

    await expect(checkRemoteRuntimeHealth("http://127.0.0.1:3080")).resolves.toMatchObject({
      status: "ok",
      message: "Remote runtime is online and storage is writable, but API requests are temporarily rate limited.",
      health: { runtime: "de-koi-server", writable: true },
    });
  });

  it("rejects unrelated health payloads before invoking the API", async () => {
    const fetchMock = stubFetch([jsonResponse({ ok: true, runtime: "other-server", writable: true })]);

    await expect(checkRemoteRuntimeHealth("http://127.0.0.1:3080")).resolves.toEqual({
      status: "unreachable",
      message: "Remote runtime did not return a compatible health response.",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("readRemoteError", () => {
  it("uses a JSON error field when the remote runtime omits message", async () => {
    const error = await readRemoteError(jsonResponse({ error: "Provider gateway timed out" }, { status: 502 }));

    expect(error.message).toBe("Provider gateway timed out");
    expect(error.status).toBe(502);
    expect(error.details).toMatchObject({
      error: "Provider gateway timed out",
    });
  });

  it("keeps a short non-JSON error body in the remote runtime message", async () => {
    const error = await readRemoteError(textResponse("Provider gateway timed out"));

    expect(error.message).toBe("Remote runtime returned 502: Provider gateway timed out");
    expect(error.status).toBe(502);
    expect(error.details).toMatchObject({
      body: "Provider gateway timed out",
    });
  });

  it("explains how to recover when an older runtime rejects Deki session storage", async () => {
    const error = await readRemoteError(
      jsonResponse({ message: "Unsupported storage entity: deki-sessions" }, { status: 400 }),
    );

    expect(error.message).toBe(
      "This De-Koi server is older than the web app and cannot store Deki sessions. Update and restart the server, then refresh this page.",
    );
  });
});

describe("remoteRuntimeTarget", () => {
  afterEach(() => {
    useUIStore.setState({ remoteRuntimeUrl: "" });
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("uses the hosted page origin before startup health persistence completes", () => {
    useUIStore.setState({ remoteRuntimeUrl: "" });

    expect(remoteRuntimeTarget()).toEqual({ baseUrl: window.location.origin });
  });

  it("prefers an explicitly configured runtime URL", () => {
    useUIStore.setState({ remoteRuntimeUrl: " http://127.0.0.1:8787/ " });

    expect(remoteRuntimeTarget()).toEqual({ baseUrl: "http://127.0.0.1:8787" });
  });

  it("does not infer a hosted runtime inside Tauri", () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {},
      writable: true,
      configurable: true,
    });
    useUIStore.setState({ remoteRuntimeUrl: "" });

    expect(remoteRuntimeTarget()).toBeNull();
  });
});

describe("invokeRemote", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    useUIStore.setState({ remoteRuntimeUrl: "" });
  });

  it("normalizes browser network failures into an actionable API error", async () => {
    useUIStore.setState({ remoteRuntimeUrl: "http://127.0.0.1:8787" });
    const cause = new TypeError("Failed to fetch");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(cause));

    await expect(invokeRemote("connection_models", { id: "conn-1" })).rejects.toMatchObject({
      name: "ApiError",
      message: "Remote runtime is unreachable. Check Settings and make sure the runtime server is running.",
      status: 503,
      details: {
        code: "remote_runtime_unreachable",
        cause,
        causeMessage: "Failed to fetch",
      },
    });
  });

  it("propagates abort errors without wrapping", async () => {
    useUIStore.setState({ remoteRuntimeUrl: "http://127.0.0.1:8787" });
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(abortError));

    await expect(invokeRemote("connection_models", { id: "conn-1" })).rejects.toBe(abortError);
  });

  it("passes through existing API errors without wrapping", async () => {
    useUIStore.setState({ remoteRuntimeUrl: "http://127.0.0.1:8787" });
    const apiError = new ApiError("Remote runtime returned 429", 429, { code: "rate_limited" });
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(apiError));

    await expect(invokeRemote("connection_models", { id: "conn-1" })).rejects.toBe(apiError);
  });

  it("applies the finite request deadline to ordinary JSON invokes", async () => {
    vi.useFakeTimers();
    useUIStore.setState({ remoteRuntimeUrl: "http://127.0.0.1:8787" });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation((_input, init) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        });
      }),
    );

    const pending = invokeRemote("connection_models", { id: "conn-1" });
    const rejection = expect(pending).rejects.toMatchObject({
      status: 504,
      details: { code: "remote_runtime_timeout" },
    });
    await vi.advanceTimersByTimeAsync(REMOTE_FINITE_REQUEST_TIMEOUT_MS);

    await rejection;
  });
});

describe("streamRemoteLlm", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const request = { messages: [{ role: "user" as const, content: "Hello" }] };
  const target = { baseUrl: "http://127.0.0.1:3080" };

  async function collectStream() {
    const events = [];
    for await (const event of streamRemoteLlm("stream-1", request, target)) events.push(event);
    return events;
  }

  it("rejects EOF without a terminal event", async () => {
    const encoder = new TextEncoder();
    stubFetch([
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"type":"token","text":"partial"}\n\n'));
            controller.close();
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
    ]);

    await expect(collectStream()).rejects.toMatchObject({
      name: "ApiError",
      details: { code: "llm_stream_incomplete" },
    });
  });

  it("rejects a stream after two minutes without another event", async () => {
    vi.useFakeTimers();
    stubFetch([
      new Response(new ReadableStream({ start() {} }), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    ]);

    const pending = collectStream();
    const rejection = expect(pending).rejects.toMatchObject({
      name: "ApiError",
      status: 504,
      details: { code: "remote_runtime_stream_timeout" },
    });
    await vi.advanceTimersByTimeAsync(REMOTE_LLM_STREAM_IDLE_TIMEOUT_MS);

    await rejection;
  });
});
