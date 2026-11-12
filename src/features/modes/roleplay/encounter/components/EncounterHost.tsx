import { Component, type ErrorInfo, type ReactNode } from "react";
import { recordClientDiagnostic } from "../../../../../shared/lib/client-diagnostics";
import { useRoleplayEncounterStore } from "../../../../../shared/stores/roleplay-encounter.store";
import { EncounterOverlay } from "./EncounterOverlay";
import { EncounterSetupDialog } from "./EncounterSetupDialog";

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
    if (!this.state.failed) return this.props.children;
    return (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm">
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="encounter-crash-title"
          className="w-full max-w-sm space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-center text-[var(--card-foreground)]"
        >
          <h2 id="encounter-crash-title" className="text-sm font-semibold">
            Combat error
          </h2>
          <p className="text-xs text-[var(--muted-foreground)]">
            Something went wrong during combat. This is usually caused by the AI returning unexpected data.
          </p>
          <button
            type="button"
            autoFocus
            onClick={this.props.onClose}
            className="rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-semibold text-[var(--primary-foreground)]"
          >
            Close encounter
          </button>
        </div>
      </div>
    );
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
