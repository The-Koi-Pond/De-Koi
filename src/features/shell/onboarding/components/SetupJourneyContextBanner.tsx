import type { SetupJourneyMode } from "../../../../engine/onboarding";

export function SetupJourneyContextBanner({ owner, mode, onReturn }: { owner: "runtime" | "connection"; mode: SetupJourneyMode; onReturn: () => void }) {
  const runtime = owner === "runtime";
  const targetId = runtime ? "setup-step-runtime" : "setup-step-connection";
  return (
    <aside className="rounded-lg border border-[var(--primary)]/30 bg-[var(--primary)]/8 p-3" aria-label="Setup journey context">
      <p className="text-sm font-semibold text-[var(--foreground)]">{runtime ? "Connect your De-Koi server" : "Add a language model"} to continue setup</p>
      <p className="mt-1 text-xs text-[var(--muted-foreground)]">Use the existing {runtime ? "Remote Runtime controls below" : "connection editor"}. Your {mode} request is waiting.</p>
      <button type="button" className="mt-2 rounded-md border border-[var(--primary)]/30 px-2.5 py-1.5 text-xs font-semibold text-[var(--primary)]" onClick={() => {
        onReturn();
        requestAnimationFrame(() => document.getElementById(targetId)?.focus());
      }}>Return to setup</button>
    </aside>
  );
}
