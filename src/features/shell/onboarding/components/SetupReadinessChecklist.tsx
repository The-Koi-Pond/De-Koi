import { Check, ChevronRight, Circle, Server, Sparkles, X } from "lucide-react";
import type { SetupReadinessFacts } from "../../../../engine/onboarding";

export interface SetupReadinessChecklistProps {
  facts: SetupReadinessFacts;
  dismissed?: boolean;
  completed?: boolean;
  onDismiss?: () => void;
  onResume?: () => void;
  onConfigureRuntime?: () => void;
  onRepairRuntime?: () => void;
  onCreateConnection?: () => void;
  onTestConnection?: () => void;
  onContinueChat?: () => void;
}

export function SetupReadinessChecklist({
  facts, dismissed, completed, onDismiss, onResume, onConfigureRuntime, onRepairRuntime,
  onCreateConnection, onTestConnection, onContinueChat,
}: SetupReadinessChecklistProps) {
  if (completed) return null;
  if (dismissed) {
    return (
      <button type="button" onClick={onResume} className="inline-flex items-center gap-2 rounded-lg border border-[var(--primary)]/30 bg-[var(--card)] px-3 py-2 text-sm font-semibold text-[var(--foreground)]">
        <Sparkles size="0.9rem" aria-hidden="true" /> Finish setup <ChevronRight size="0.85rem" aria-hidden="true" />
      </button>
    );
  }

  const runtimeReady = facts.environment === "embedded" || facts.runtimeHealth === "healthy";
  const connectionReady = facts.usableConnectionCount > 0;
  const connectionTestReady = facts.selectedConnectionTest === "passed";
  const steps = [
    ...(facts.environment === "web" ? [{
      key: "runtime", label: "Connect to your De-Koi server", ready: runtimeReady,
      action: facts.runtimeUrl ? onRepairRuntime : onConfigureRuntime,
      actionLabel: facts.runtimeUrl ? "Repair server connection" : "Configure server",
      icon: Server,
    }] : []),
    {
      key: "connection", label: "Connect a language model", ready: connectionReady,
      action: onCreateConnection,
      actionLabel: "Add connection",
      icon: Circle,
    },
    {
      key: "test-connection", label: "Test your language model", ready: connectionTestReady,
      action: connectionReady ? onTestConnection : undefined,
      actionLabel: "Test connection",
      icon: Circle,
    },
    { key: "experience", label: "Choose your experience", ready: runtimeReady && connectionReady && connectionTestReady, action: onContinueChat, actionLabel: "Continue to chat", icon: Sparkles },
  ];

  return (
    <section aria-labelledby="setup-readiness-title" className="w-full max-w-[32rem] rounded-xl border border-[var(--primary)]/25 bg-[var(--card)]/85 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div><h2 id="setup-readiness-title" className="text-sm font-semibold text-[var(--foreground)]">Finish setting up De-Koi</h2><p className="mt-1 text-xs text-[var(--muted-foreground)]">We’ll keep your intended chat ready while you handle prerequisites.</p></div>
        <button type="button" onClick={onDismiss} aria-label="Dismiss setup checklist" className="rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--secondary)]"><X size="0.9rem" aria-hidden="true" /></button>
      </div>
      <ol className="mt-4 space-y-2">
        {steps.map(({ key, label, ready, action, actionLabel, icon: Icon }) => (
          <li key={key} id={`setup-step-${key}`} tabIndex={-1} className="flex items-center gap-3 rounded-lg border border-[var(--border)]/70 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]">
            {ready ? <Check size="1rem" className="text-emerald-400" aria-label="Complete" /> : <Icon size="1rem" className="text-[var(--primary)]" aria-hidden="true" />}
            <span className="min-w-0 flex-1 text-xs font-medium text-[var(--foreground)]">{label}</span>
            {((key === "experience" && ready) || (key !== "experience" && !ready)) && action && <button type="button" onClick={action} className="rounded-md bg-[var(--primary)]/12 px-2.5 py-1.5 text-xs font-semibold text-[var(--primary)] hover:bg-[var(--primary)]/20">{actionLabel}</button>}
          </li>
        ))}
      </ol>
    </section>
  );
}
