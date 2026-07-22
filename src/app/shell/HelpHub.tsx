import type { ReactNode } from "react";
import { Bug, ClipboardList, Compass, FileQuestion, HeartHandshake, Info, Keyboard, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { APP_VERSION } from "../../engine/contracts/constants/defaults";
import { SUPPORT_LINKS } from "../../shared/config/support-links";
import { openExternalUrl } from "../../shared/api/external-link-api";
import { openBugReport } from "../../shared/lib/support-report";
import { buildSlashHelpText } from "../../shared/lib/slash-commands";
import { DISCOVERY_APP_EVENT } from "../../shared/lib/discovery-navigation";
import { useUIStore } from "../../shared/stores/ui.store";

function HelpAction({
  icon,
  title,
  description,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-16 w-full min-w-0 items-start gap-3 rounded-md border border-[var(--border)] bg-[var(--secondary)]/35 px-3 py-2.5 text-left transition-colors hover:border-[var(--primary)]/45 hover:bg-[var(--accent)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)]"
    >
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--primary)]/10 text-[var(--primary)]">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-[var(--foreground)]">{title}</span>
        <span className="mt-1 block text-[0.7rem] leading-relaxed text-[var(--muted-foreground)]">{description}</span>
      </span>
    </button>
  );
}

export function HelpHub() {
  const openHealth = () => {
    const ui = useUIStore.getState();
    ui.openRightPanel("settings");
    ui.setSettingsTab("health");
  };
  const replayOnboarding = () => {
    const ui = useUIStore.getState();
    ui.closeRightPanel();
    ui.setOnboardingTourOpen(true);
  };
  const openDiscover = () => {
    useUIStore.getState().closeRightPanel();
    window.dispatchEvent(new CustomEvent(DISCOVERY_APP_EVENT, { detail: { type: "open-discover" } }));
  };
  const reportBug = () => {
    void openBugReport({
      source: "help-hub",
      reportText: "Bug report started from the Help hub. Add what happened below.",
    }).catch(() => toast.error("Couldn't open the bug report. Allow pop-ups and try again."));
  };

  const openDocs = () => {
    if (SUPPORT_LINKS.docsUrl) {
      void openExternalUrl(SUPPORT_LINKS.docsUrl).catch(() =>
        toast.error("Couldn't open the documentation. Allow pop-ups and try again."),
      );
    }
  };

  const openSupportContact = () => {
    if (SUPPORT_LINKS.supportContact) {
      void openExternalUrl(SUPPORT_LINKS.supportContact).catch(() =>
        toast.error("Couldn't open the support contact. Allow pop-ups and try again."),
      );
    }
  };

  return (
    <div className="p-3">
      <div className="grid gap-3">
        <HelpAction
          icon={<Compass size="1rem" aria-hidden />}
          title="Find a feature"
          description="Search De-Koi by what you want to do and jump to the tool that owns it."
          onClick={openDiscover}
        />
        <HelpAction
          icon={<ClipboardList size="1rem" aria-hidden />}
          title="Health diagnostics"
          description="Open setup, runtime, provider, storage, recent diagnostics, and support packet details."
          onClick={openHealth}
        />
        <HelpAction
          icon={<Bug size="1rem" aria-hidden />}
          title="Report a bug"
          description="Copy a short report template and open the configured GitHub issue form."
          onClick={reportBug}
        />
        <HelpAction
          icon={<RotateCcw size="1rem" aria-hidden />}
          title="Show me around"
          description="Take the optional app tour. The readiness checklist handles setup and can be resumed anytime."
          onClick={replayOnboarding}
        />
        {SUPPORT_LINKS.docsUrl && (
          <HelpAction
            icon={<FileQuestion size="1rem" aria-hidden />}
            title="FAQ and docs"
            description="Open the configured end-user documentation in your browser."
            onClick={openDocs}
          />
        )}
        {SUPPORT_LINKS.supportContact && (
          <HelpAction
            icon={<HeartHandshake size="1rem" aria-hidden />}
            title="Contact support"
            description="Open the configured support contact."
            onClick={openSupportContact}
          />
        )}
      </div>

      <section className="mt-4 rounded-md border border-[var(--border)] bg-[var(--card)]/60 p-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--foreground)]">
          <Keyboard size="0.875rem" aria-hidden />
          Shortcut Reference
        </div>
        <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--background)]/75 p-2 text-[0.66rem] leading-relaxed text-[var(--muted-foreground)]">
          {buildSlashHelpText()}
        </pre>
      </section>

      <section className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--secondary)]/25 px-3 py-2 text-[0.7rem] text-[var(--muted-foreground)]">
        <Info size="0.8125rem" aria-hidden />
        <span>De-Koi {APP_VERSION}</span>
        <span aria-hidden>/</span>
        <span>Press ? to open Help.</span>
      </section>
    </div>
  );
}
