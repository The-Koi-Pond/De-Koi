import { ExternalLink } from "lucide-react";

import { Modal } from "../../../../shared/components/ui/Modal";
import { HOME_CREDIT_LINKS, HOME_SPECIAL_THANKS } from "./homeCredits";

export function HomeCreditsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Credits" width="max-w-2xl">
      <div className="space-y-5">
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Core Credits
          </h3>
          <div className="grid gap-2 sm:grid-cols-3">
            {HOME_CREDIT_LINKS.map((item) => (
              <a
                key={item.label}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex min-w-0 items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--secondary)]/35 px-3 py-2 text-xs transition-colors hover:border-[var(--primary)]/40 hover:bg-[var(--accent)]"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-[var(--foreground)]">{item.label}</span>
                  <span className="block truncate text-[0.6875rem] text-[var(--muted-foreground)]">
                    {item.detail}
                  </span>
                </span>
                <ExternalLink
                  size="0.75rem"
                  className="shrink-0 text-[var(--muted-foreground)] group-hover:text-[var(--primary)]"
                />
              </a>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Special Thanks
          </h3>
          <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">
            {HOME_SPECIAL_THANKS.join(", ")}.
          </p>
        </section>
      </div>
    </Modal>
  );
}
