import { Component, lazy, Suspense, useEffect, type ReactNode } from "react";
import { useEnabledCoreModuleStyles, useIsCoreModuleEnabled } from "../hooks/use-core-modules";
import { ME_NOTES_MODULE_ID } from "../lib/core-module-registry";

const STYLE_PREFIX = "marinara-core-module-";
const MeNotepadModule = lazy(() =>
  import("../notepad/MeNotepadModule").then((module) => ({ default: module.MeNotepadModule })),
);

function CoreModuleFallback({ tone = "loading" }: { tone?: "loading" | "error" }) {
  const isError = tone === "error";
  return (
    <div
      role={isError ? "alert" : "status"}
      data-core-module="me-notes"
      className="fixed bottom-4 right-4 z-[90] max-w-64 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs font-medium text-[var(--foreground)] shadow-lg"
    >
      {isError ? "ME Notes could not load." : "Loading ME Notes..."}
    </div>
  );
}

class CoreModuleErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error("Core module failed to load", error);
  }

  render() {
    if (this.state.hasError) return <CoreModuleFallback tone="error" />;
    return this.props.children;
  }
}

export function CoreModuleRuntimeProvider() {
  const { data: styles = [] } = useEnabledCoreModuleStyles();
  const { data: meNotesEnabled } = useIsCoreModuleEnabled(ME_NOTES_MODULE_ID);

  useEffect(() => {
    document.querySelectorAll(`style[id^="${STYLE_PREFIX}"]`).forEach((element) => element.remove());

    for (const contribution of styles) {
      const style = document.createElement("style");
      style.id = `${STYLE_PREFIX}${contribution.moduleId}`;
      style.textContent = contribution.css;
      document.head.appendChild(style);
    }

    return () => {
      document.querySelectorAll(`style[id^="${STYLE_PREFIX}"]`).forEach((element) => element.remove());
    };
  }, [styles]);

  return (
    <CoreModuleErrorBoundary key={meNotesEnabled ? "me-notes-enabled" : "me-notes-disabled"}>
      <Suspense fallback={<CoreModuleFallback />}>
        {meNotesEnabled ? <MeNotepadModule /> : null}
      </Suspense>
    </CoreModuleErrorBoundary>
  );
}
