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
  test: () => runnerRequest<{ sent: number; failed: number }>("/runner/push/test", { method: "POST", body: "{}" }),
  /** Tells the server whether someone is at a screen (it sends texts-first and "reply ready" pushes otherwise). */
  presence: (status: "active" | "idle" | "dnd", visible: boolean) =>
    runnerRequest<{ ok: boolean }>("/runner/presence", { method: "POST", body: JSON.stringify({ status, visible }) }),
};
