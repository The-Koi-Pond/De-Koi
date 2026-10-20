import { ApiError } from "./api-errors";
import { generationRunnerHealth } from "./generation-runner-api";
import { readRemoteError, remoteFetchInit, remoteHeaders, remoteRuntimeTarget } from "./remote-runtime";

async function runnerRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const target = remoteRuntimeTarget();
  if (!target) throw new ApiError("Phone notifications need a hosted De-Koi server", 400);
  const response = await fetch(
    `${target.baseUrl}${path}`,
    remoteFetchInit({
      ...init,
      headers: remoteHeaders(target, { "content-type": "application/json", ...init.headers }),
    }),
  );
  if (!response.ok) throw await readRemoteError(response);
  return (await response.json()) as T;
}

/** What happened to a test notification for one device. "missing": the server doesn't know the device. */
export type PhoneTestResult = "sent" | "gone" | "failed" | "missing";

/** The hosted runner's Web Push endpoints (src/runner/server.ts). */
export const phoneNotificationsApi = {
  async available(): Promise<boolean> {
    return (await generationRunnerHealth()).push;
  },
  async publicKey(): Promise<string> {
    const body = await runnerRequest<{ publicKey?: unknown }>("/runner/push/public-key");
    if (typeof body.publicKey !== "string") throw new ApiError("The server sent no notification key", 500);
    return body.publicKey;
  },
  subscribe: (subscription: unknown, label: string) =>
    runnerRequest<{ ok: boolean }>("/runner/push/subscribe", {
      method: "POST",
      body: JSON.stringify({ subscription, label }),
    }),
  unsubscribe: (endpoint: string) =>
    runnerRequest<{ ok: boolean }>("/runner/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint }) }),
  /** Sends a test to the device with this endpoint and reports what happened to it. */
  async test(endpoint: string): Promise<PhoneTestResult> {
    const body = await runnerRequest<{ result?: unknown; sent?: number; gone?: number; failed?: number }>(
      "/runner/push/test",
      { method: "POST", body: JSON.stringify({ endpoint }) },
    );
    if (body.result === "sent" || body.result === "gone" || body.result === "failed" || body.result === "missing") {
      return body.result;
    }
    // A server from before per-device tests answers with counts for all devices.
    if (body.sent) return "sent";
    if (body.gone) return "gone";
    return body.failed ? "failed" : "missing";
  },
  /** Tells the server whether someone is at a screen (it sends texts-first and "reply ready" pushes otherwise). */
  presence: (status: "active" | "idle" | "dnd", visible: boolean) =>
    runnerRequest<{ ok: boolean }>("/runner/presence", { method: "POST", body: JSON.stringify({ status, visible }) }),
};
