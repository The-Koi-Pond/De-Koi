import { useEffect } from "react";
import { toast } from "sonner";
import { checkRemoteRuntimeHealth } from "../../shared/api/remote-runtime";
import { useUIStore } from "../../shared/stores/ui.store";

export function useRemoteRuntimeStartupHealthCheck() {
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      const remoteRuntimeUrl = useUIStore.getState().remoteRuntimeUrl.trim();
      if (!remoteRuntimeUrl) return;

      void checkRemoteRuntimeHealth(remoteRuntimeUrl, { signal: controller.signal })
        .then((result) => {
          if (controller.signal.aborted || result.status === "ok" || result.status === "unconfigured") return;
          toast.warning(result.message);
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          toast.warning(error instanceof Error ? error.message : "Remote runtime health check failed.");
        });
    }, 0);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);
}
