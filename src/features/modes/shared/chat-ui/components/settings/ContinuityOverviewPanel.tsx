import { Activity, ArrowRight, BookOpen, Brain, CalendarClock } from "lucide-react";

import { cn } from "../../../../../../shared/lib/utils";
import type {
  ContinuityOverviewAction,
  ContinuityOverviewSection,
  ContinuityOverviewViewModel,
} from "../../lib/continuity-overview";

interface ContinuityOverviewPanelProps {
  model: ContinuityOverviewViewModel;
  onOpenMemories: () => void;
  onOpenSummaries: () => void;
}

const SECTION_ICONS: Record<ContinuityOverviewSection["id"], typeof Brain> = {
  memory: Brain,
  summary: CalendarClock,
  lorebooks: BookOpen,
  trackers: Activity,
};

const ACTION_LABELS: Record<ContinuityOverviewAction, string> = {
  open_memories: "Open memories",
  open_summaries: "Open summaries",
  manage_lorebooks: "Lorebooks",
  manage_agents: "Agents",
  inspect_prompt: "Prompt Inspector",
};

function scrollToSettingsSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function ContinuityOverviewPanel({
  model,
  onOpenMemories,
  onOpenSummaries,
}: ContinuityOverviewPanelProps) {
  const handleAction = (action: ContinuityOverviewAction) => {
    if (action === "open_memories") {
      onOpenMemories();
      return;
    }
    if (action === "open_summaries") {
      onOpenSummaries();
      return;
    }
    if (action === "manage_lorebooks") {
      scrollToSettingsSection("chat-settings-lorebooks");
      return;
    }
    if (action === "manage_agents") {
      scrollToSettingsSection("chat-settings-agents");
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-[var(--secondary)]/65 px-3 py-2.5 ring-1 ring-[var(--border)]">
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0 truncate text-xs font-semibold text-[var(--foreground)]">{model.headline}</span>
          <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--primary)]" />
        </div>
      </div>

      <div className="grid gap-2">
        {model.sections.map((section) => {
          const Icon = SECTION_ICONS[section.id];
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => handleAction(section.action)}
              className="group grid min-h-20 grid-cols-[1.75rem_minmax(0,1fr)_auto] items-start gap-2 rounded-lg bg-[var(--secondary)] px-3 py-2.5 text-left ring-1 ring-transparent transition-all hover:bg-[var(--accent)] hover:ring-[var(--border)]"
            >
              <span
                className={cn(
                  "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md ring-1",
                  section.status === "active"
                    ? "bg-[var(--primary)]/15 text-[var(--primary)] ring-[var(--primary)]/30"
                    : "bg-[var(--background)] text-[var(--muted-foreground)] ring-[var(--border)]",
                )}
              >
                <Icon size="0.875rem" />
              </span>
              <span className="min-w-0">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-[0.6875rem] font-semibold text-[var(--foreground)]">
                    {section.label}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-1.5 py-0.5 text-[0.5625rem] font-medium",
                      section.status === "active"
                        ? "bg-[var(--primary)]/15 text-[var(--primary)]"
                        : "bg-[var(--background)] text-[var(--muted-foreground)] ring-1 ring-[var(--border)]",
                    )}
                  >
                    {section.value}
                  </span>
                </span>
                <span className="mt-1 block text-[0.625rem] leading-relaxed text-[var(--muted-foreground)]">
                  {section.detail}
                </span>
              </span>
              <span className="mt-0.5 flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[0.5625rem] font-medium text-[var(--muted-foreground)] transition-colors group-hover:bg-[var(--background)]/50 group-hover:text-[var(--foreground)]">
                <span className="max-w-20 truncate">{ACTION_LABELS[section.action]}</span>
                <ArrowRight size="0.625rem" />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
