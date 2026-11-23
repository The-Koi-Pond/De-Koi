import { Plus, Trash2 } from "lucide-react";
import { useRef } from "react";
import type { PromptGroup } from "../../../../../engine/contracts/types/prompt";
import { showConfirmDialog } from "../../../../../shared/lib/app-dialogs";
import type { PresetSectionsTabProps, SectionRow } from "./section-row";

/** The group being renamed and its typed name; kept by the tab, so it survives closing the panel. */
export interface GroupRename {
  groupId: string;
  name: string;
}

/** The groups panel (docs/provenance/preset-sections.md, "Groups panel"). */
export function GroupsPanel({
  presetId,
  sections,
  groupMap,
  rename,
  onRename,
  onCreateGroup,
  onUpdateGroup,
  onDeleteGroup,
}: {
  presetId: string;
  sections: SectionRow[];
  groupMap: Map<string, PromptGroup>;
  rename: GroupRename | null;
  onRename: (rename: GroupRename | null) => void;
  onCreateGroup: PresetSectionsTabProps["onCreateGroup"];
  onUpdateGroup: PresetSectionsTabProps["onUpdateGroup"];
  onDeleteGroup: PresetSectionsTabProps["onDeleteGroup"];
}) {
  // Escape leaves the input without saving, even if the browser blurs it on the way out.
  const cancelled = useRef(false);
  const groups = [...groupMap.values()];

  const finishRename = () => {
    if (!rename || cancelled.current) return;
    const name = rename.name.trim();
    if (name) onUpdateGroup.mutate({ presetId, groupId: rename.groupId, name });
    onRename(null);
  };

  const confirmDelete = async (group: PromptGroup) => {
    const confirmed = await showConfirmDialog({
      title: "Delete Group",
      message: `Delete group "${group.name}"? Sections will be ungrouped.`,
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (confirmed) onDeleteGroup.mutate({ presetId, groupId: group.id });
  };

  return (
    <div className="rounded-xl border border-sky-400/20 bg-sky-400/5 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold text-sky-400">Groups</h4>
        <button
          type="button"
          onClick={() => onCreateGroup.mutate({ presetId, name: "New Group" })}
          className="flex items-center gap-1 rounded-lg bg-sky-400/15 px-2 py-1 text-[0.625rem] font-medium text-sky-400 hover:bg-sky-400/25 active:scale-95"
        >
          <Plus size="0.625rem" /> New Group
        </button>
      </div>
      <p className="mb-2 text-[0.625rem] text-[var(--muted-foreground)]">
        Groups wrap adjacent sections in a single XML/Markdown container. Assign sections to groups below.
      </p>
      {groups.length === 0 ? (
        <p className="py-2 text-center text-[0.625rem] text-[var(--muted-foreground)]">
          No groups yet. Create one to organize sections.
        </p>
      ) : (
        <div className="space-y-1">
          {groups.map((group) => (
            <div
              key={group.id}
              data-group-row
              className="flex items-center gap-2 rounded-lg bg-[var(--secondary)] px-2.5 py-1.5 ring-1 ring-[var(--border)]"
            >
              {rename?.groupId === group.id ? (
                <input
                  type="text"
                  autoFocus
                  value={rename.name}
                  onChange={(event) => onRename({ groupId: group.id, name: event.target.value })}
                  onBlur={finishRename}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape") {
                      cancelled.current = true;
                      onRename(null);
                    }
                  }}
                  className="flex-1 rounded bg-[var(--background)] px-1.5 py-0.5 text-xs outline-none ring-1 ring-[var(--primary)]"
                />
              ) : (
                <span
                  title="Click to rename"
                  onClick={() => {
                    cancelled.current = false;
                    onRename({ groupId: group.id, name: group.name });
                  }}
                  className="flex-1 truncate text-xs font-medium"
                >
                  {group.name}
                </span>
              )}
              <span className="text-[0.5625rem] text-[var(--muted-foreground)]">
                {sections.filter((section) => section.groupId === group.id).length} sections
              </span>
              <button
                type="button"
                aria-label={`Delete group ${group.name}`}
                onClick={() => void confirmDelete(group)}
                className="rounded p-0.5 hover:bg-[var(--destructive)]/15"
              >
                <Trash2 size="0.625rem" className="text-[var(--destructive)]" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
