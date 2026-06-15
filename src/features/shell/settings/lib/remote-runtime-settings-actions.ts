import { unconfiguredRemoteRuntimeHealth, type RemoteRuntimeHealthCheck } from "../../../../shared/api/remote-runtime";

export type RemoteRuntimeHealthView =
  | RemoteRuntimeHealthCheck
  | {
      status: "idle" | "checking";
      message: string;
    };

export function initialRemoteRuntimeHealth(url: string): RemoteRuntimeHealthView {
  return url.trim()
    ? { status: "idle", message: "Status checks when this section is visible." }
    : unconfiguredRemoteRuntimeHealth();
}

export function remoteRuntimeHealthErrorView(error: unknown): RemoteRuntimeHealthCheck {
  return {
    status: "unreachable",
    message: error instanceof Error ? error.message : "Remote runtime health check failed.",
  };
}

export function remoteRuntimeHealthDotTone(status: RemoteRuntimeHealthView["status"]) {
  if (status === "ok") return "ok";
  if (status === "checking") return "checking";
  if (status === "not-writable") return "warning";
  if (status === "invalid" || status === "unreachable") return "error";
  return "idle";
}
