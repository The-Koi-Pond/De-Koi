import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useEnabledCoreModuleStyles, useIsCoreModuleEnabled } from "../hooks/use-core-modules";
import { ME_NOTES_MODULE_ID } from "../lib/core-module-registry";

const STYLE_PREFIX = "marinara-core-module-";

function createMeNotepadModule() {
  return lazy(() => import("../notepad/MeNotepadModule").then((module) => ({ default: module.MeNotepadModule })));
}

function CoreModuleFallback({ tone = "loading", onRetry }: { tone?: "loading" | "error"; onRetry?: () => void }) {
  const isError = tone === "error";
  return (
    <div
      role={isError ? "alert" : "status"}
      data-core-module="me-notes"
      className="fixed bottom-4 right-4 z-[90] max-w-64 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs font-medium text-[var(--foreground)] shadow-lg"
    >
      <div>{isError ? "ME Notes could not load." : "Loading ME Notes..."}</div>
      {isError && onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 rounded-md bg-[var(--secondary)] px-2 py-1 text-[0.6875rem] font-semibold text-[var(--foreground)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--accent)]"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}

class CoreModuleErrorBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }


  render() {
    if (this.state.hasError) return <CoreModuleFallback tone="error" onRetry={this.props.onRetry} />;
    return this.props.children;
  }
}

export function CoreModuleRuntimeProvider() {
  const { data: styles = [] } = useEnabledCoreModuleStyles();
  const { data: meNotesEnabled } = useIsCoreModuleEnabled(ME_NOTES_MODULE_ID);
  const [notepadLoadAttempt, setNotepadLoadAttempt] = useState(0);
  const MeNotepadModule = useMemo(createMeNotepadModule, [notepadLoadAttempt]);
  const retryMeNotesLoad = useCallback(() => setNotepadLoadAttempt((attempt) => attempt + 1), []);

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
    <CoreModuleErrorBoundary key={notepadLoadAttempt} onRetry={retryMeNotesLoad}>
      <Suspense fallback={<CoreModuleFallback />}>
        {meNotesEnabled ? <MeNotepadModule /> : null}
      </Suspense>
    </CoreModuleErrorBoundary>
  );
}
