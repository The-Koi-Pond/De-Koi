import { useEffect, useState } from "react";
import { ChevronDown, Wand2 } from "lucide-react";

import type { Chat } from "../../../../engine/contracts/types/chat";
import { cn } from "../../../../shared/lib/utils";
import { RoleplayWorkflowProfileChooser } from "./RoleplayWorkflowProfileChooser";

export function RoleplayWorkflowProfileDrawerControl({
  chat,
  revealFromDiscovery = false,
}: {
  chat: Chat;
  revealFromDiscovery?: boolean;
}) {
  const [open, setOpen] = useState(revealFromDiscovery);

  useEffect(() => {
    if (revealFromDiscovery) setOpen(true);
  }, [revealFromDiscovery]);

  return (
    <div id="chat-settings-workflow-profile" className="scroll-mt-3 border-b border-[var(--border)]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-11 w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-[var(--accent)]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--primary)]"
      >
        <Wand2 size="0.875rem" className="text-[var(--primary)]" />
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold text-[var(--foreground)]">Workflow profile</span>
          <span className="block truncate text-[0.625rem] text-[var(--muted-foreground)]">
            Preview and apply a Roleplay helper setup
          </span>
        </span>
        <ChevronDown
          size="0.75rem"
          className={cn("text-[var(--muted-foreground)] transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="max-h-[calc(100dvh-9rem)] overflow-y-auto overscroll-contain px-3 pb-3">
          <RoleplayWorkflowProfileChooser chat={chat} entryPoint="drawer" onNavigateAway={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
