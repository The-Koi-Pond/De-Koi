// ──────────────────────────────────────────────
// Panel: User Personas
// ──────────────────────────────────────────────
import { useCallback, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type MouseEvent } from "react";
import { User } from "lucide-react";
import { toast } from "sonner";

import { exportApi } from "../../../../../shared/api/export-api";
import { ExportFormatDialog, type ExportFormatChoice } from "../../../../../shared/components/ui/ExportFormatDialog";
import { showConfirmDialog } from "../../../../../shared/lib/app-dialogs";
import { cn } from "../../../../../shared/lib/utils";
import { useUIStore } from "../../../../../shared/stores/ui.store";
import {
  applyGroupMembershipChangesWithRollback,
  buildGroupMembershipMoveChanges,
  GroupMembershipRollbackError,
} from "../../../lib/group-membership-move";
import {
  buildPersonaMap,
  filterPersonas,
  getPersonaTags,
  isPersonaActive,
  parsePersonaGroups,
  parsePersonaTags,
  sortPersonas,
  type PersonaActiveFilter,
  type PersonaGroupRow,
  type PersonaPanelRow,
  type SortOption,
} from "../../lib/personas-panel-model";
import {
  useActivatePersona,
  useCreatePersonaGroup,
  useDeletePersona,
  useDeletePersonaGroup,
  useDuplicatePersona,
  usePersonaGroups,
  usePersonaSummaries,
  useUpdatePersona,
  useUpdatePersonaGroup,
  useUploadPersonaAvatar,
} from "../../hooks/use-personas";
import { PersonaGroupsSection, type PersonaGroupDropTarget } from "./PersonaGroupsSection";
import { PersonaListItem } from "./PersonaListItem";
import { PersonasFilterBar } from "./PersonasFilterBar";
import { CatalogActionBar } from "../../../components/CatalogPanelControls";
import { NO_TAG_FILTERS, cycleTagFilter, withoutTagFilter, type TagFilters } from "../../../lib/tag-filters";
import { PersonasSelectionToolbar } from "./PersonasSelectionToolbar";
import { toUserMessage } from "../../../../../shared/lib/error-message";

const PERSONA_GROUP_DRAG_MIME = "application/x-de-koi-persona-id";

type PersonaDragSource = { kind: "list" } | { kind: "group"; groupId: string | null };

function samePersonaGroupDropTarget(left: PersonaGroupDropTarget | null, right: PersonaGroupDropTarget): boolean {
  if (!left) return false;
  if (left.kind !== right.kind) return false;
  if (left.kind === "root") return true;
  return right.kind === "group" && left.groupId === right.groupId;
}

export function PersonasPanel() {
  const { data: personas, isLoading } = usePersonaSummaries();
  const deletePersona = useDeletePersona();
  const duplicatePersona = useDuplicatePersona();
  const updatePersona = useUpdatePersona();
  const activatePersona = useActivatePersona();
  const uploadAvatar = useUploadPersonaAvatar();
  const { data: personaGroupsRaw } = usePersonaGroups();
  const createPGroup = useCreatePersonaGroup();
  const updatePGroup = useUpdatePersonaGroup();
  const deletePGroup = useDeletePersonaGroup();
  const openPersonaDetail = useUIStore((state) => state.openPersonaDetail);
  const openModal = useUIStore((state) => state.openModal);

  const fileRef = useRef<HTMLInputElement>(null);
  const personaGroupMoveInFlightRef = useRef(false);
  const [avatarTargetId, setAvatarTargetId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortOption>("name-asc");
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<PersonaActiveFilter>("all");
  const [tagFilters, setTagFilters] = useState<TagFilters>(NO_TAG_FILTERS);
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPersonaIds, setSelectedPersonaIds] = useState<Set<string>>(new Set());
  const [exportingSelected, setExportingSelected] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);

  const [groupsExpanded, setGroupsExpanded] = useState(true);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editGroupName, setEditGroupName] = useState("");
  const [assigningToGroup, setAssigningToGroup] = useState<string | null>(null);
  const [draggedPersonaId, setDraggedPersonaId] = useState<string | null>(null);
  const [draggedPersonaSource, setDraggedPersonaSource] = useState<PersonaDragSource | null>(null);
  const [personaDropTarget, setPersonaDropTarget] = useState<PersonaGroupDropTarget | null>(null);
  const [personaGroupMovePending, setPersonaGroupMovePending] = useState(false);

  const handleCreate = () => {
    openModal("create-persona");
  };

  const handleAvatarClick = (event: MouseEvent, id: string) => {
    event.stopPropagation();
    setAvatarTargetId(id);
    fileRef.current?.click();
  };

  const handleAvatarUpload = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file || !avatarTargetId) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        uploadAvatar.mutate({
          id: avatarTargetId,
          avatar: dataUrl,
          filename: `persona-${avatarTargetId}-${Date.now()}.${file.name.split(".").pop()}`,
        });
      };
      reader.readAsDataURL(file);
      event.target.value = "";
    },
    [avatarTargetId, uploadAvatar],
  );

  const rawList = useMemo(() => (personas as PersonaPanelRow[] | undefined) ?? [], [personas]);

  const allTags = useMemo(() => getPersonaTags(rawList), [rawList]);

  const handleDeleteTag = useCallback(
    async (tag: string) => {
      if (
        !(await showConfirmDialog({
          title: "Remove Tag",
          message: `Remove tag "${tag}" from all personas?`,
          confirmLabel: "Remove",
          tone: "destructive",
        }))
      ) {
        return;
      }
      try {
        const affected = rawList.filter((persona) => parsePersonaTags(persona).includes(tag));
        for (const persona of affected) {
          const newTags = parsePersonaTags(persona).filter((candidate) => candidate !== tag);
          await updatePersona.mutateAsync({ id: persona.id, tags: newTags });
        }
        setTagFilters((filters) => withoutTagFilter(filters, tag));
      } catch {
        toast.error("Couldn't remove the tag from some personas. Try again.");
      }
    },
    [rawList, updatePersona],
  );

  const personaMap = useMemo(() => buildPersonaMap(rawList), [rawList]);

  const parsedGroups = useMemo(
    () => parsePersonaGroups(personaGroupsRaw as PersonaGroupRow[] | undefined, rawList),
    [personaGroupsRaw, rawList],
  );

  const personaGroupMembershipPending = updatePGroup.isPending || personaGroupMovePending;

  const canDragPersonas = useMemo(
    () =>
      parsedGroups.some((group) => group.isSynthetic !== true) &&
      !selectionMode &&
      assigningToGroup === null &&
      !personaGroupMembershipPending,
    [assigningToGroup, parsedGroups, personaGroupMembershipPending, selectionMode],
  );

  const handleCreateGroup = useCallback(() => {
    const name = newGroupName.trim();
    if (!name) return;
    createPGroup.mutate({ name, personaIds: [] });
    setNewGroupName("");
    setCreatingGroup(false);
  }, [createPGroup, newGroupName]);

  const handleRenameGroup = useCallback(
    (groupId: string) => {
      const name = editGroupName.trim();
      if (!name) return;
      updatePGroup.mutate({ id: groupId, name });
      setEditingGroupId(null);
      setEditGroupName("");
    },
    [editGroupName, updatePGroup],
  );

  const handleDeleteGroup = useCallback(
    (groupId: string) => {
      deletePGroup.mutate(groupId);
    },
    [deletePGroup],
  );

  const toggleGroupMember = useCallback(
    (groupId: string, personaId: string, currentMembers: string[]) => {
      if (updatePGroup.isPending || personaGroupMoveInFlightRef.current) return;
      const targetGroupId = currentMembers.includes(personaId) ? null : groupId;
      const changes = buildGroupMembershipMoveChanges({
        groups: parsedGroups,
        itemId: personaId,
        targetGroupId,
      });

      if (changes.length === 0) return;
      personaGroupMoveInFlightRef.current = true;
      setPersonaGroupMovePending(true);
      void applyGroupMembershipChangesWithRollback(changes, (change) =>
        updatePGroup.mutateAsync({ id: change.id, personaIds: change.memberIds }),
      )
        .catch((error) => {
          toast.error(
            error instanceof GroupMembershipRollbackError
              ? "Failed to update persona folder assignment. Rollback also failed; refresh before retrying."
              : error instanceof Error
                ? error.message
                : "Failed to update persona folder assignment.",
          );
        })
        .finally(() => {
          personaGroupMoveInFlightRef.current = false;
          setPersonaGroupMovePending(false);
        });
    },
    [parsedGroups, updatePGroup],
  );

  const movePersonaToGroup = useCallback(
    (targetGroupId: string | null, personaId: string) => {
      if (updatePGroup.isPending || personaGroupMoveInFlightRef.current) return;
      const changes = buildGroupMembershipMoveChanges({
        groups: parsedGroups,
        itemId: personaId,
        targetGroupId,
      });

      if (changes.length === 0) return;
      personaGroupMoveInFlightRef.current = true;
      setPersonaGroupMovePending(true);
      void applyGroupMembershipChangesWithRollback(changes, (change) =>
        updatePGroup.mutateAsync({ id: change.id, personaIds: change.memberIds }),
      )
        .catch((error) => {
          toast.error(
            error instanceof GroupMembershipRollbackError
              ? "Failed to update persona folder assignment. Rollback also failed; refresh before retrying."
              : error instanceof Error
                ? error.message
                : "Failed to update persona folder assignment.",
          );
        })
        .finally(() => {
          personaGroupMoveInFlightRef.current = false;
          setPersonaGroupMovePending(false);
        });
    },
    [parsedGroups, updatePGroup],
  );

  const clearPersonaDragState = useCallback(() => {
    setDraggedPersonaId(null);
    setDraggedPersonaSource(null);
    setPersonaDropTarget(null);
  }, []);

  const canDropPersonaOnTarget = useCallback(
    (target: PersonaGroupDropTarget) => {
      if (!draggedPersonaId) return false;
      if (target.kind !== "root") return true;
      return draggedPersonaSource?.kind === "group" && draggedPersonaSource.groupId !== null;
    },
    [draggedPersonaId, draggedPersonaSource],
  );

  const handlePersonaDragStart = useCallback(
    (event: DragEvent<HTMLDivElement>, personaId: string, source: PersonaDragSource) => {
      if (!canDragPersonas) {
        event.preventDefault();
        return;
      }
      setDraggedPersonaId(personaId);
      setDraggedPersonaSource(source);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(PERSONA_GROUP_DRAG_MIME, personaId);
      event.dataTransfer.setData("text/plain", personaId);
    },
    [canDragPersonas],
  );

  const handlePersonaListDragStart = useCallback(
    (event: DragEvent<HTMLDivElement>, personaId: string) => handlePersonaDragStart(event, personaId, { kind: "list" }),
    [handlePersonaDragStart],
  );

  const handlePersonaGroupMemberDragStart = useCallback(
    (event: DragEvent<HTMLDivElement>, personaId: string, sourceGroupId: string | null) =>
      handlePersonaDragStart(event, personaId, { kind: "group", groupId: sourceGroupId }),
    [handlePersonaDragStart],
  );

  const handlePersonaDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>, target: PersonaGroupDropTarget) => {
      if (!canDropPersonaOnTarget(target)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      setPersonaDropTarget((current) => (samePersonaGroupDropTarget(current, target) ? current : target));
    },
    [canDropPersonaOnTarget],
  );

  const handlePersonaDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setPersonaDropTarget(null);
  }, []);

  const handlePersonaDrop = useCallback(
    (event: DragEvent<HTMLDivElement>, groupId: string | null) => {
      event.preventDefault();
      event.stopPropagation();
      const personaId = draggedPersonaId || event.dataTransfer.getData(PERSONA_GROUP_DRAG_MIME);
      if (!personaId) {
        clearPersonaDragState();
        return;
      }
      if (groupId === null && !canDropPersonaOnTarget({ kind: "root" })) {
        clearPersonaDragState();
        return;
      }
      movePersonaToGroup(groupId, personaId);
      clearPersonaDragState();
    },
    [canDropPersonaOnTarget, clearPersonaDragState, draggedPersonaId, movePersonaToGroup],
  );

  const handlePersonaRootDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => handlePersonaDragOver(event, { kind: "root" }),
    [handlePersonaDragOver],
  );

  const handlePersonaRootDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => handlePersonaDrop(event, null),
    [handlePersonaDrop],
  );

  const filteredList = useMemo(
    () => filterPersonas({ personas: rawList, activeFilter, search, tagFilters }),
    [activeFilter, tagFilters, rawList, search],
  );

  const list = useMemo(() => sortPersonas(filteredList, sort), [filteredList, sort]);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedPersonaIds(new Set());
  }, []);

  const toggleSelection = useCallback((personaId: string) => {
    setSelectedPersonaIds((prev) => {
      const next = new Set(prev);
      if (next.has(personaId)) next.delete(personaId);
      else next.add(personaId);
      return next;
    });
  }, []);

  const selectVisible = useCallback(() => {
    setSelectedPersonaIds(new Set(list.map((persona) => persona.id)));
  }, [list]);

  const clearSelection = useCallback(() => {
    setSelectedPersonaIds(new Set());
  }, []);

  const handleExportSelected = useCallback(
    async (format: ExportFormatChoice) => {
      if (selectedPersonaIds.size === 0) return;
      setExportingSelected(true);
      setExportDialogOpen(false);
      try {
        exportApi.triggerDownload(await exportApi.personasBulk([...selectedPersonaIds], format));
        toast.success(`Exported ${selectedPersonaIds.size} persona${selectedPersonaIds.size === 1 ? "" : "s"}`);
      } catch (error) {
        toast.error(toUserMessage(error, { fallback: "Couldn't export personas. Try again." }));
      } finally {
        setExportingSelected(false);
      }
    },
    [selectedPersonaIds],
  );

  const handleActivate = useCallback(
    (personaId: string) => {
      activatePersona.mutate(personaId);
    },
    [activatePersona],
  );

  const handleDuplicate = useCallback(
    (persona: PersonaPanelRow) => {
      duplicatePersona.mutate(persona.id, {
        onSuccess: () => {
          toast.success(`Duplicated "${persona.name}"`);
        },
      });
    },
    [duplicatePersona],
  );

  const handleDeletePersona = useCallback(
    async (persona: PersonaPanelRow) => {
      if (
        !(await showConfirmDialog({
          title: "Delete Persona",
          message: `Delete "${persona.name}"? This cannot be undone.`,
          confirmLabel: "Delete",
          tone: "destructive",
        }))
      ) {
        return;
      }
      deletePersona.mutate(persona.id);
    },
    [deletePersona],
  );

  return (
    // The tool strips touch the panel's edges; only the list below has padding.
    <div className="flex flex-col">
      <CatalogActionBar
        tone="jade"
        selectionMode={selectionMode}
        onCreate={handleCreate}
        onImport={() => openModal("import-persona")}
        onOpenMaker={() => openModal("persona-maker")}
        onToggleSelectionMode={() => {
          if (selectionMode) exitSelectionMode();
          else {
            setAssigningToGroup(null);
            setSelectionMode(true);
          }
        }}
      />

      <PersonasFilterBar
        search={search}
        sort={sort}
        activeFilter={activeFilter}
        allTags={allTags}
        tagFilters={tagFilters}
        tagsExpanded={tagsExpanded}
        onSearchChange={setSearch}
        onSortChange={setSort}
        onActiveFilterChange={setActiveFilter}
        onCycleTag={(tag) => setTagFilters((filters) => cycleTagFilter(filters, tag))}
        onClearTagFilters={() => setTagFilters(NO_TAG_FILTERS)}
        onTagsExpandedChange={setTagsExpanded}
        onDeleteTag={handleDeleteTag}
      />

      <div className="flex flex-col gap-2 px-3 pb-3 pt-0.5">
        {selectionMode && (
          <PersonasSelectionToolbar
            selectedCount={selectedPersonaIds.size}
            visibleCount={list.length}
            exportingSelected={exportingSelected}
            onSelectVisible={selectVisible}
            onClearSelection={clearSelection}
            onOpenExportDialog={() => setExportDialogOpen(true)}
            onDone={exitSelectionMode}
          />
        )}

        <ExportFormatDialog
          open={exportDialogOpen}
          title="Export Personas"
          description="Native keeps De-Koi persona metadata. Compatible exports simple persona JSON for other tools."
          compatibleDescription="Exports persona fields directly without the native wrapper."
          onClose={() => setExportDialogOpen(false)}
          onSelect={handleExportSelected}
        />

        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />

        <PersonaGroupsSection
          groups={parsedGroups}
          personaMap={personaMap}
          groupsExpanded={groupsExpanded}
          expandedGroupId={expandedGroupId}
          creatingGroup={creatingGroup}
          newGroupName={newGroupName}
          editingGroupId={editingGroupId}
          editGroupName={editGroupName}
          assigningToGroup={assigningToGroup}
          draggedPersonaId={draggedPersonaId}
          personaDropTarget={personaDropTarget}
          canDragPersonas={canDragPersonas}
          onGroupsExpandedChange={setGroupsExpanded}
          onExpandedGroupIdChange={setExpandedGroupId}
          onCreatingGroupChange={setCreatingGroup}
          onNewGroupNameChange={setNewGroupName}
          onEditingGroupIdChange={setEditingGroupId}
          onEditGroupNameChange={setEditGroupName}
          onAssigningToGroupChange={setAssigningToGroup}
          onCreateGroup={handleCreateGroup}
          onRenameGroup={handleRenameGroup}
          onDeleteGroup={handleDeleteGroup}
          onToggleGroupMember={toggleGroupMember}
          onPersonaDragStart={handlePersonaGroupMemberDragStart}
          onPersonaDragEnd={clearPersonaDragState}
          onPersonaDragOver={handlePersonaDragOver}
          onPersonaDragLeave={handlePersonaDragLeave}
          onPersonaDrop={handlePersonaDrop}
          onExitSelectionMode={exitSelectionMode}
        />

        {isLoading && (
          <div className="flex flex-col gap-2 py-2">
            {[1, 2].map((item) => (
              <div key={item} className="shimmer h-16 rounded-xl" />
            ))}
          </div>
        )}

        {!isLoading && list.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <div className="animate-float flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400/20 to-teal-500/20">
              <User size="1.25rem" className="text-emerald-400" />
            </div>
            <p className="text-xs text-[var(--muted-foreground)]">
              {rawList.length === 0 ? "No personas yet — create one!" : "No personas match the current filters."}
            </p>
          </div>
        )}

        <div
          data-persona-group-root
          onDragOver={handlePersonaRootDragOver}
          onDragLeave={handlePersonaDragLeave}
          onDrop={handlePersonaRootDrop}
          className={cn(
            "stagger-children flex flex-col gap-1 rounded-xl transition-colors",
            draggedPersonaId && "min-h-8",
            personaDropTarget?.kind === "root" && "bg-[var(--sidebar-accent)]/45 ring-1 ring-[var(--primary)]/25",
          )}
        >
          {list.map((persona) => {
            const active = isPersonaActive(persona);
            const targetGroup = assigningToGroup
              ? (parsedGroups.find((group) => group.id === assigningToGroup) ?? null)
              : null;

            return (
              <PersonaListItem
                key={persona.id}
                persona={persona}
                active={active}
                selectionMode={selectionMode}
                isSelected={selectedPersonaIds.has(persona.id)}
                assigningToGroup={Boolean(assigningToGroup)}
                targetGroup={targetGroup}
                draggable={canDragPersonas}
                isDragging={draggedPersonaId === persona.id}
                onOpen={openPersonaDetail}
                onAvatarClick={handleAvatarClick}
                onToggleSelection={toggleSelection}
                onToggleGroupMember={toggleGroupMember}
                onActivate={handleActivate}
                onDuplicate={handleDuplicate}
                onDelete={handleDeletePersona}
                onPersonaDragStart={handlePersonaListDragStart}
                onPersonaDragEnd={clearPersonaDragState}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
