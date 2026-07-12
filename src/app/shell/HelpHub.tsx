import type { ReactNode } from "react";
import { Bug, ClipboardList, FileQuestion, HeartHandshake, Info, Keyboard, RotateCcw } from "lucide-react";
import { APP_VERSION } from "../../engine/contracts/constants/defaults";
import { Modal } from "../../shared/components/ui/Modal";
import { SUPPORT_LINKS } from "../../shared/config/support-links";
import { openExternalUrl } from "../../shared/api/external-link-api";
import { openBugReport } from "../../shared/lib/support-report";
import { buildSlashHelpText } from "../../shared/lib/slash-commands";

type HelpHubProps = {
  open: boolean;
  onClose: () => void;
  onOpenHealth: () => void;
  onReplayOnboarding: () => void;
};

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

export function HelpHub({ open, onClose, onOpenHealth, onReplayOnboarding }: HelpHubProps) {
  const reportBug = () => {
    void openBugReport({
      source: "help-hub",
      reportText: "Bug report started from the Help hub. Add what happened below.",
    }).catch(() => undefined);
  };

  const openDocs = () => {
    if (SUPPORT_LINKS.docsUrl) void openExternalUrl(SUPPORT_LINKS.docsUrl).catch(() => undefined);
  };

  const openSupportContact = () => {
    if (SUPPORT_LINKS.supportContact) void openExternalUrl(SUPPORT_LINKS.supportContact).catch(() => undefined);
  };

  return (
    <Modal open={open} onClose={onClose} title="Help" width="max-w-2xl">
      <div className="grid gap-3 md:grid-cols-2">
        <HelpAction
          icon={<ClipboardList size="1rem" aria-hidden />}
          title="Health diagnostics"
          description="Open setup, runtime, provider, storage, recent diagnostics, and support packet details."
          onClick={onOpenHealth}
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
          onClick={onReplayOnboarding}
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
    </Modal>
  );
}
