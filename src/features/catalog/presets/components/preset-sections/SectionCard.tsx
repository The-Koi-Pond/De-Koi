import {
  ArrowDown,
  ArrowUp,
  Bot,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  GripVertical,
  Settings2,
  Trash2,
  User,
} from "lucide-react";
import type { ReactNode } from "react";
import type { PromptGroup } from "../../../../../engine/contracts/types/prompt";
import { cn } from "../../../../../shared/lib/utils";
import { SectionBody } from "./SectionBody";
import { readSection, type SectionRow } from "./section-row";
import type { SectionDrag } from "./use-section-drag";

const ARROW_BUTTON =
  "rounded p-0.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:pointer-events-none disabled:opacity-30";
const ACTION_BUTTON = "rounded-lg p-1";

function RoleIcon({ role }: { role: string }) {
  if (role === "user") return <User size="0.875rem" className="shrink-0 text-green-400" />;
  if (role === "assistant") return <Bot size="0.875rem" className="shrink-0 text-purple-400" />;
  return <Settings2 size="0.875rem" className={cn("shrink-0", role === "system" && "text-blue-400")} />;
}

function DropLine({ where }: { where: "before" | "after" }) {
  return (
    <div
      data-drop-line={where}
      className={cn("mx-2 h-0.5 rounded-full bg-purple-400", where === "before" ? "mb-1" : "mt-1")}
    />
  );
}

export interface SectionCardProps {
  section: SectionRow;
  index: number;
  count: number;
  groupMap: Map<string, PromptGroup>;
  expanded: boolean;
  onToggle: () => void;
  /** Move up / Move down are disabled on every card while a reorder is pending. */
  reorderPending: boolean;
  /** Duplicate is disabled while a create or a reorder is pending. */
  duplicatePending: boolean;
  /** -1 moves the card up one place, 1 down one place. */
  onMove: (delta: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  update: (data: Record<string, unknown>) => void;
  drag: SectionDrag;
}

/** A section's card (docs/provenance/preset-sections.md, "A section's card"). */
export function SectionCard({
  section,
  index,
  count,
  groupMap,
  expanded,
  onToggle,
  reorderPending,
  duplicatePending,
  onMove,
  onDuplicate,
  onDelete,
  update,
  drag,
}: SectionCardProps) {
  const view = readSection(section, groupMap);
  // Names follow the recorded Move / Duplicate names, which show the stored name as it is.
  const labelName = `${section.name as string}`;
  const dragging = drag.draggedIndex === index;

  return (
    <div>
      {drag.lineIndex === index && <DropLine where="before" />}
      <div
        data-section-index={index}
        draggable
        onDragStart={(event) => drag.dragStart(event, index)}
        onDragEnd={drag.dragEnd}
        className={cn(
          "rounded-xl border border-[var(--border)] transition-all",
          !view.on && "border-[var(--border)]/50 opacity-50",
          dragging && "opacity-40",
        )}
      >
        <div className="flex items-center gap-2 px-3 py-2.5">
          <div className="flex shrink-0 items-center gap-0.5">
            <div
              title="Drag to reorder"
              aria-hidden="true"
              onMouseDown={() => drag.gripDown(index)}
              className="rounded p-0.5 hover:bg-[var(--accent)]"
            >
              <GripVertical size="0.875rem" className="text-[var(--muted-foreground)]" />
            </div>
            <button
              type="button"
              title="Move up"
              aria-label={`Move ${labelName} up`}
              disabled={index === 0 || reorderPending}
              onClick={() => onMove(-1)}
              className={ARROW_BUTTON}
            >
              <ArrowUp size="0.75rem" />
            </button>
            <button
              type="button"
              title="Move down"
              aria-label={`Move ${labelName} down`}
              disabled={index === count - 1 || reorderPending}
              onClick={() => onMove(1)}
              className={ARROW_BUTTON}
            >
              <ArrowDown size="0.75rem" />
            </button>
          </div>
          <button
            type="button"
            aria-label={`${expanded ? "Collapse" : "Expand"} ${labelName}`}
            aria-expanded={expanded}
            onClick={onToggle}
            className="shrink-0 rounded p-0.5 hover:bg-[var(--accent)]"
          >
            {expanded ? (
              <ChevronDown size="0.875rem" className="text-[var(--muted-foreground)]" />
            ) : (
              <ChevronRight size="0.875rem" className="text-[var(--muted-foreground)]" />
            )}
          </button>
          <RoleIcon role={view.role} />
          <span onClick={onToggle} className="min-w-0 flex-1 truncate text-sm font-medium">
            {section.name as ReactNode}
          </span>
          {view.marker && (
            <span className="shrink-0 rounded bg-violet-400/15 px-1.5 py-0.5 text-[0.5625rem] font-medium text-violet-400">
              MARKER
            </span>
          )}
          {view.group && (
            <span className="shrink-0 rounded bg-sky-400/15 px-1.5 py-0.5 text-[0.5625rem] font-medium text-sky-400">
              {view.group.name}
            </span>
          )}
          <span className="hidden shrink-0 text-[0.625rem] text-[var(--muted-foreground)] sm:inline">{view.role}</span>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              title="Duplicate"
              aria-label={`Duplicate ${labelName}`}
              disabled={duplicatePending}
              onClick={onDuplicate}
              className={cn(
                ACTION_BUTTON,
                "text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:pointer-events-none disabled:opacity-30",
              )}
            >
              <Copy size="0.75rem" />
            </button>
            <button
              type="button"
              title={view.on ? "Disable" : "Enable"}
              aria-label={`${view.on ? "Disable" : "Enable"} ${labelName}`}
              aria-pressed={view.on}
              onClick={() => update({ enabled: !view.on })}
              className={cn(ACTION_BUTTON, "hover:bg-[var(--accent)]")}
            >
              {view.on ? (
                <Eye size="0.75rem" className="text-green-400" />
              ) : (
                <EyeOff size="0.75rem" className="text-[var(--muted-foreground)]" />
              )}
            </button>
            <button
              type="button"
              title="Delete"
              aria-label={`Delete ${labelName}`}
              onClick={onDelete}
              className={cn(ACTION_BUTTON, "hover:bg-[var(--destructive)]/15")}
            >
              <Trash2 size="0.75rem" className="text-[var(--destructive)]" />
            </button>
          </div>
        </div>
        {expanded && <SectionBody section={section} view={view} groupMap={groupMap} update={update} />}
      </div>
      {drag.lineIndex === count && index === count - 1 && <DropLine where="after" />}
    </div>
  );
}
