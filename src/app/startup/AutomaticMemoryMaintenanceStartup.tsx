import { lazy, Suspense, useEffect, useState } from "react";

const AutomaticMemoryMaintenanceHost = lazy(() =>
  import("./automatic-memory-maintenance").then((module) => ({
    default: module.AutomaticMemoryMaintenanceHost,
  })),
);

function requestIdleMount(callback: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(callback, { timeout: 2_500 });
    return () => window.cancelIdleCallback(id);
  }

  const id = window.setTimeout(callback, 1_200);
  return () => window.clearTimeout(id);
}

export function AutomaticMemoryMaintenanceStartup() {
  const [ready, setReady] = useState(false);

  useEffect(() => requestIdleMount(() => setReady(true)), []);

  if (!ready) return null;
  return (
    <Suspense fallback={null}>
      <AutomaticMemoryMaintenanceHost />
    </Suspense>
  );
}
