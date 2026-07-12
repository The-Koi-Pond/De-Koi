import type { SetupJourneyMode } from "../../../../engine/onboarding";

export function restoreSetupJourneyFocus(owner: "runtime" | "connection") {
  const targetId = owner === "runtime" ? "setup-step-runtime" : "setup-step-connection";
  requestAnimationFrame(() => document.getElementById(targetId)?.focus());
}

export function SetupJourneyContextBanner({ owner, mode, onReturn }: { owner: "runtime" | "connection"; mode: SetupJourneyMode; onReturn: () => void }) {
  const runtime = owner === "runtime";
  return (
    <aside data-setup-focus={owner} className="rounded-lg border border-[var(--primary)]/30 bg-[var(--primary)]/8 p-3" aria-label="Setup journey context">
      <p className="text-sm font-semibold text-[var(--foreground)]">{runtime ? "Connect your De-Koi server" : "Add a language model"} to continue setup</p>
      <p className="mt-1 text-xs text-[var(--muted-foreground)]">Use the existing {runtime ? "Remote Runtime controls below" : "connection editor"}. Your {mode} request is waiting.</p>
      <button type="button" className="mt-2 rounded-md border border-[var(--primary)]/30 px-2.5 py-1.5 text-xs font-semibold text-[var(--primary)]" onClick={() => {
        onReturn();
        restoreSetupJourneyFocus(owner);
      }}>Return to setup</button>
    </aside>
  );
}
