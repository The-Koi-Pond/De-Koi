import { useEffect } from "react";
import { toast } from "sonner";
import { checkRemoteRuntimeHealth, hasEmbeddedTauriRuntime } from "../../shared/api/remote-runtime";
import { useUIStore } from "../../shared/stores/ui.store";

function sameOriginRuntimeCandidate(): string {
  if (typeof window === "undefined" || hasEmbeddedTauriRuntime()) return "";
  if (window.location.protocol !== "http:" && window.location.protocol !== "https:") return "";
  return window.location.origin;
}

export function useRemoteRuntimeStartupHealthCheck() {
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      const configuredRemoteRuntimeUrl = useUIStore.getState().remoteRuntimeUrl.trim();
      const sameOriginCandidate = configuredRemoteRuntimeUrl ? "" : sameOriginRuntimeCandidate();
      const remoteRuntimeUrl = configuredRemoteRuntimeUrl || sameOriginCandidate;
      if (!remoteRuntimeUrl) return;

      void checkRemoteRuntimeHealth(remoteRuntimeUrl, { signal: controller.signal })
        .then((result) => {
          if (controller.signal.aborted) return;
          if (result.status === "ok") {
            if (sameOriginCandidate) {
              useUIStore.getState().setRemoteRuntimeUrl(sameOriginCandidate);
            }
            return;
          }
          if (result.status === "unconfigured") return;
          if (sameOriginCandidate) return;
          toast.warning(result.message);
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          if (sameOriginCandidate) return;
          toast.warning(error instanceof Error ? error.message : "Remote runtime health check failed.");
        });
    }, 0);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);
}
