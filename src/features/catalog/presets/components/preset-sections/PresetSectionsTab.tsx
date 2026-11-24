import { AlertTriangle, FolderOpen, Layers, Plus, X } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { HelpTooltip } from "../../../../../shared/components/ui/HelpTooltip";
import { toUserMessage } from "../../../../../shared/lib/error-message";
import { cn } from "../../../../../shared/lib/utils";
import { useAgentConfigs } from "../../../agents/index";
import { PresetVariablesEditor } from "../preset-variables";
import { AddSectionMenu, type AddChoice, type InjectableAgent } from "./AddSectionMenu";
import { GroupsPanel, type GroupRename } from "./GroupsPanel";
import { SectionCard } from "./SectionCard";
import { isOn, MARKER_TYPES, readMarkerConfig, type PresetSectionsTabProps, type SectionRow } from "./section-row";
import { useSectionDrag } from "./use-section-drag";

// The Sections tab of the preset editor (docs/provenance/preset-sections.md).

const HELP =
  "Everything we send to a model is just text. A prompt is a formatted, written instruction we send to the model. Each section below becomes part of the final prompt.";

const MENU_MARKERS = MARKER_TYPES.filter(([type]) => type !== "agent_data");

const loreWarningKey = (presetId: string) => `preset:loreWarning:dismissed:${presetId}`;

/** A storage error counts as not dismissed. */
function readLoreWarningDismissed(presetId: string): boolean {
  try {
    return localStorage.getItem(loreWarningKey(presetId)) === "true";
  } catch {
    return false;
  }
}

/**
 * The ids with the one at `from` moved to the insert index `insertAt` (counted before the move). A drag doesn't check
 * the moved id: when the list shrank during the drag, `from` can point past the end and `undefined` is sent in its
 * place, as recorded.
 */
function movedIds(sections: SectionRow[], from: number, insertAt: number): string[] {
  const ids = sections.map((section) => section.id);
  const [id] = ids.splice(from, 1);
  ids.splice(insertAt > from ? insertAt - 1 : insertAt, 0, id!);
  return ids;
}

/** The agents offered as Agent Sections: only `settings.injectAsSection === true` on an object counts. */
function injectableAgents(agents: unknown): InjectableAgent[] {
  if (!Array.isArray(agents)) return [];
  return (agents as Array<{ type: string; name: unknown; settings?: unknown }>).filter((agent) => {
    const settings = agent.settings;
    return (
      typeof settings === "object" &&
      settings !== null &&
      (settings as Record<string, unknown>).injectAsSection === true
    );
  });
}

export function PresetSectionsTab({
  presetId,
  sections,
  groupMap,
  choiceBlocks,
  onCreateSection,
  onUpdateSection,
  onDeleteSection,
  onReorderSections,
  onCreateGroup,
  onUpdateGroup,
  onDeleteGroup,
  onCreateVariable,
  onUpdateVariable,
  onDeleteVariable,
  onReorderVariables,
  hasLorebookMarker,
  parentChatHasLorebook,
}: PresetSectionsTabProps) {
  const { data: agentConfigs } = useAgentConfigs();
  const agents = injectableAgents(agentConfigs);
  // Kept by section id, so a card stays expanded across moves and refreshes.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  // The preset and section ids as last rendered, set before any card's unmount cleanup of the same commit runs.
  const listed = useRef<{ presetId: string; ids: ReadonlySet<string> }>({ presetId, ids: new Set() });
  useLayoutEffect(() => {
    listed.current = { presetId, ids: new Set(sections.map((section) => section.id)) };
  }, [presetId, sections]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [rename, setRename] = useState<GroupRename | null>(null);
  const [loreDismissed, setLoreDismissed] = useState(() => readLoreWarningDismissed(presetId));
  const [loreReadFor, setLoreReadFor] = useState(presetId);
  if (loreReadFor !== presetId) {
    setLoreReadFor(presetId);
    setLoreDismissed(readLoreWarningDismissed(presetId));
  }

  const reorder = (sectionIds: string[]) => onReorderSections.mutate({ presetId, sectionIds });
  const drag = useSectionDrag(sections.length, (from, insertAt) => reorder(movedIds(sections, from, insertAt)));

  const setCardExpanded = (id: string, open: boolean) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });

  const add = (choice: AddChoice) => {
    setMenuOpen(false);
    // An agent without a type adds a plain prompt block, as recorded.
    if (choice.kind === "prompt" || (choice.kind === "agent" && !choice.agent.type)) {
      onCreateSection.mutate({
        presetId,
        identifier: `section_${Date.now()}`,
        name: "New Section",
        content: "",
        role: "system",
        isMarker: false,
        markerConfig: null,
      });
    } else if (choice.kind === "marker") {
      onCreateSection.mutate({
        presetId,
        identifier: choice.type,
        name: choice.label,
        content: "",
        role: "system",
        isMarker: true,
        markerConfig: { type: choice.type },
      });
    } else {
      const { type, name } = choice.agent;
      onCreateSection.mutate({
        presetId,
        identifier: `agent_${type}`,
        name: `${(name as string | null | undefined) ?? type} (Agent)`,
        content: `{{agent::${type}}}`,
        role: "system",
        isMarker: true,
        markerConfig: { type: "agent_data", agentType: type },
      });
    }
  };

  const duplicate = async (section: SectionRow, index: number) => {
    const now = Date.now();
    try {
      const created = await onCreateSection.mutateAsync({
        presetId,
        identifier: `${(section.identifier as string | null | undefined) ?? "section"}_copy_${now}`,
        name: `${(section.name as string | null | undefined) ?? "Prompt Block"} Copy`,
        content: (section.content as string | null | undefined) ?? "",
        role: (section.role as string | null | undefined) ?? "system",
        enabled: isOn(section.enabled),
        isMarker: isOn(section.isMarker),
        groupId: (section.groupId as string | null | undefined) ?? null,
        markerConfig: readMarkerConfig(section.markerConfig),
        injectionPosition: (section.injectionPosition as string | null | undefined) ?? "ordered",
        injectionDepth: (section.injectionDepth as number | null | undefined) ?? 0,
        injectionOrder: (section.injectionOrder as number | null | undefined) ?? index * 100,
        forbidOverrides: isOn(section.forbidOverrides),
      });
      const createdId = (created as { id?: unknown } | undefined)?.id;
      if (createdId) {
        const sectionIds = sections.map((row) => row.id);
        sectionIds.splice(index + 1, 0, createdId as string);
        await onReorderSections.mutateAsync({ presetId, sectionIds });
        setCardExpanded(createdId as string, true);
      }
      toast.success(`Duplicated "${section.name as string}"`);
    } catch (error) {
      toast.error(toUserMessage(error, { fallback: "Couldn't duplicate prompt block. Try again." }));
    }
  };

  const dismissLoreWarning = () => {
    setLoreDismissed(true);
    try {
      localStorage.setItem(loreWarningKey(presetId), "true");
    } catch {
      // A storage error is ignored; the warning stays hidden until the tab opens again.
    }
  };

  const showLoreWarning = !hasLorebookMarker && parentChatHasLorebook && !loreDismissed;

  return (
    <>
      <div className="flex items-center gap-2">
        <HelpTooltip text={HELP} side="right" />
        <div className="relative">
          <button
            type="button"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-purple-400 to-violet-500 px-3 py-2 text-xs font-medium text-white shadow-md transition-all hover:shadow-lg active:scale-[0.98]"
          >
            <Plus size="0.8125rem" /> Add Section
          </button>
          {menuOpen && (
            <AddSectionMenu markers={MENU_MARKERS} agents={agents} onChoose={add} onClose={() => setMenuOpen(false)} />
          )}
        </div>
        <button
          type="button"
          aria-expanded={groupsOpen}
          onClick={() => setGroupsOpen((open) => !open)}
          className={cn(
            "flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium ring-1 ring-[var(--border)] transition-all active:scale-[0.98]",
            groupsOpen
              ? "bg-sky-400/10 text-sky-400 ring-sky-400/30"
              : "bg-[var(--secondary)] text-[var(--secondary-foreground)] hover:bg-[var(--accent)]",
          )}
        >
          <FolderOpen size="0.8125rem" /> Groups ({groupMap.size})
        </button>
        {showLoreWarning && (
          <div className="flex items-center gap-1.5 rounded-lg bg-amber-400/10 px-2.5 py-1.5 text-[0.6875rem] text-amber-200 ring-1 ring-amber-400/25">
            <AlertTriangle size="0.75rem" className="shrink-0" />
            <span>Add a lorebook marker when this preset should receive active lorebook entries.</span>
            <button
              type="button"
              title="Dismiss warning"
              aria-label="Dismiss warning"
              onClick={dismissLoreWarning}
              className="ml-0.5 rounded-md p-0.5 text-amber-200/75 transition-colors hover:bg-amber-400/15 hover:text-amber-100"
            >
              <X size="0.6875rem" />
            </button>
          </div>
        )}
      </div>

      {groupsOpen && (
        <GroupsPanel
          presetId={presetId}
          sections={sections}
          groupMap={groupMap}
          rename={rename}
          onRename={setRename}
          onCreateGroup={onCreateGroup}
          onUpdateGroup={onUpdateGroup}
          onDeleteGroup={onDeleteGroup}
        />
      )}

      <div data-section-list className="space-y-1" onDragOver={drag.dragOver} onDrop={drag.drop}>
        {sections.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Layers size="1.5rem" className="text-[var(--muted-foreground)]" />
            <p className="text-xs text-[var(--muted-foreground)]">No sections yet. Add one to get started.</p>
          </div>
        ) : (
          sections.map((section, index) => (
            <SectionCard
              key={section.id}
              section={section}
              index={index}
              count={sections.length}
              groupMap={groupMap}
              expanded={expanded.has(section.id)}
              onToggle={() => setCardExpanded(section.id, !expanded.has(section.id))}
              reorderPending={onReorderSections.isPending}
              duplicatePending={onCreateSection.isPending || onReorderSections.isPending}
              onMove={(delta) => {
                // Move up / down send nothing for a section without an id, as recorded.
                if (!section.id) return;
                reorder(movedIds(sections, index, delta < 0 ? index - 1 : index + 2));
              }}
              onDuplicate={() => void duplicate(section, index)}
              onDelete={() => onDeleteSection.mutate({ presetId, sectionId: section.id })}
              update={(data) => {
                // A deleted section's card goes away after its row leaves this preset's list; the save its editor
                // makes then (spec follow-up 10) is dropped. Collapsing, leaving the tab, closing the editor or opening
                // another preset keeps the save.
                const last = listed.current;
                if (last.presetId === presetId && !last.ids.has(section.id)) return;
                onUpdateSection.mutate({ presetId, sectionId: section.id, ...data });
              }}
              drag={drag}
            />
          ))
        )}
      </div>

      {sections.length > 0 && (
        <p className="text-center text-[0.625rem] text-[var(--muted-foreground)]">
          Click to expand · Sections are assembled top-to-bottom
        </p>
      )}

      <PresetVariablesEditor
        presetId={presetId}
        variables={choiceBlocks}
        onCreateVariable={onCreateVariable}
        onUpdateVariable={onUpdateVariable}
        onDeleteVariable={onDeleteVariable}
        onReorderVariables={onReorderVariables}
      />
    </>
  );
}
