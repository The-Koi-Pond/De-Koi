import { FileText, Layers, Sparkles, type LucideIcon } from "lucide-react";
import { cn } from "../../../../../shared/lib/utils";
import type { EditorTab } from "./use-preset-editor";

// The tab rail (docs/provenance/preset-overview.md, "Tab rail and content"): a vertical rail from the `5xl` container
// width up, a horizontal scrolling row above the content below it.

const TABS: ReadonlyArray<{ id: EditorTab; label: string; icon: LucideIcon }> = [
  { id: "overview", label: "Overview", icon: FileText },
  { id: "sections", label: "Sections", icon: Layers },
  { id: "review", label: "AI Review", icon: Sparkles },
];

export function TabRail({ tab, onSelect }: { tab: EditorTab; onSelect: (tab: EditorTab) => void }) {
  return (
    <nav className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-[var(--border)] bg-[var(--card)] p-1.5 @5xl:w-44 @5xl:flex-col @5xl:overflow-y-auto @5xl:border-b-0 @5xl:border-r @5xl:p-2">
      {TABS.map(({ id, label, icon: Icon }) => {
        const active = id === tab;
        return (
          <button
            key={id}
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={() => onSelect(id)}
            className={cn(
              "flex items-center gap-2 whitespace-nowrap rounded-xl px-2.5 py-1.5 text-left text-xs font-medium transition-all @5xl:whitespace-normal @5xl:px-3 @5xl:py-2",
              active
                ? "bg-gradient-to-r from-purple-400/15 to-violet-500/15 text-[var(--primary)] ring-1 ring-[var(--primary)]/20"
                : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
            )}
          >
            <Icon size="0.875rem" aria-hidden="true" />
            {label}
          </button>
        );
      })}
    </nav>
  );
}
