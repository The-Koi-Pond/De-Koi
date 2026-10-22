import type { SetupJourneyMode } from "../../../../engine/onboarding";

export function restoreSetupJourneyFocus(owner: "runtime" | "connection") {
  const targetId = owner === "runtime" ? "setup-step-runtime" : "setup-step-connection";
  requestAnimationFrame(() => document.getElementById(targetId)?.focus());
}

export function SetupJourneyContextBanner({
  owner,
  mode,
  ready = false,
  onReturn,
}: {
  owner: "runtime" | "connection";
  mode: SetupJourneyMode;
  /** The step this owner handles is already done, so the banner points onward instead of asking for it again. */
  ready?: boolean;
  onReturn: () => void;
}) {
  const runtime = owner === "runtime";
  const connectionReady = ready && !runtime;
  return (
    <aside
      data-setup-focus={owner}
      className="rounded-lg border border-[var(--primary)]/30 bg-[var(--primary)]/8 p-3"
      aria-label="Setup journey context"
    >
      {connectionReady ? (
        <>
          <p className="text-sm font-semibold text-[var(--foreground)]">Your model is connected</p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">Continue to start your new {mode}.</p>
        </>
      ) : (
        <>
          <p className="text-sm font-semibold text-[var(--foreground)]">
            {runtime ? "Connect your De-Koi server" : "Add a language model"} to continue setup
          </p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            {runtime ? "Use the server settings below." : "Add one below."} Your new {mode} starts as soon as it is set
            up.
          </p>
        </>
      )}
      <button
        type="button"
        className="mt-2 rounded-md border border-[var(--primary)]/30 px-2.5 py-1.5 text-xs font-semibold text-[var(--primary)]"
        onClick={() => {
          onReturn();
          restoreSetupJourneyFocus(owner);
        }}
      >
        {connectionReady ? "Continue setup" : "Return to setup"}
      </button>
    </aside>
  );
}
