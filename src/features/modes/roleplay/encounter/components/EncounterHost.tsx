import { Component, useId, useRef, type ErrorInfo, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useEscapeOverlay } from "../../../../../shared/hooks/use-escape-overlay";
import { recordClientDiagnostic } from "../../../../../shared/lib/client-diagnostics";
import { useRoleplayEncounterStore } from "../../../../../shared/stores/roleplay-encounter.store";
import { useFocusInAndBack } from "../hooks/use-focus-in-and-back";
import { EncounterOverlay } from "./EncounterOverlay";
import { EncounterSetupDialog } from "./EncounterSetupDialog";

/** Shown over the page like the combat window it replaces; Escape closes it the same as its button. */
function CombatCrashScreen({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useFocusInAndBack(closeRef);
  useEscapeOverlay(() => {
    onClose();
    return true;
  });
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-sm space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-center text-[var(--card-foreground)]"
      >
        <h2 id={titleId} className="text-sm font-semibold">
          Combat error
        </h2>
        <p className="text-xs text-[var(--muted-foreground)]">
          Something went wrong during combat. This is usually caused by the AI returning unexpected data.
        </p>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-semibold text-[var(--primary-foreground)]"
        >
          Close encounter
        </button>
      </div>
    </div>,
    document.body,
  );
}

interface CombatErrorBoundaryProps {
  onClose: () => void;
  children: ReactNode;
}

/** Odd model data that slips past the checks breaks only the combat window, never the chat around it. */
class CombatErrorBoundary extends Component<CombatErrorBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    recordClientDiagnostic({
      level: "error",
      source: "roleplay-encounter",
      message: "The combat window crashed",
      details: {
        message: error instanceof Error ? error.message : String(error),
        componentStack: errorInfo.componentStack ?? "",
      },
    });
  }

  render() {
    return this.state.failed ? <CombatCrashScreen onClose={this.props.onClose} /> : this.props.children;
  }
}

/** Shows this chat's encounter: the setup dialog first, then the combat window. */
export function EncounterHost({ chatId }: { chatId: string }) {
  const encounter = useRoleplayEncounterStore((state) => (state.encounter?.chatId === chatId ? state.encounter : null));
  const close = useRoleplayEncounterStore((state) => state.close);
  if (!encounter) return null;
  if (encounter.stage === "setup") return <EncounterSetupDialog />;
  return (
    <CombatErrorBoundary onClose={close}>
      <EncounterOverlay encounter={encounter} />
    </CombatErrorBoundary>
  );
}
