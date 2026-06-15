import { useState, useMemo, useCallback, useEffect, type DragEvent } from "react";
import { toast } from "sonner";
import {
  useCharacterPanelSummaries,
  useDeleteCharacter,
  useCharacterGroups,
  useDeleteGroup,
  useDuplicateCharacter,
} from "../hooks/use-characters";
import { useCharactersPanelChatActions } from "../hooks/use-characters-panel-chat-actions";
import { useCharactersPanelData } from "../hooks/use-characters-panel-data";
import { useCharactersPanelFilters } from "../hooks/use-characters-panel-filters";
import { useCharactersPanelGroups } from "../hooks/use-characters-panel-groups";
import { useCharactersPanelSelection } from "../hooks/use-characters-panel-selection";
import { parseCharacterSearchQuery } from "../lib/character-search";
import { parseCharacterRows, type ParsedCharacterRow, type SortOption } from "../lib/characters-panel-model";
import { showConfirmDialog } from "../../../../shared/lib/app-dialogs";
import { Users } from "lucide-react";
import { useUIStore } from "../../../../shared/stores/ui.store";
import { ExportFormatDialog } from "../../../../shared/components/ui/ExportFormatDialog";
import { CharacterFirstMessageDialog } from "./CharacterFirstMessageDialog";
import { CharacterGroupsSection, type CharacterGroupDropTarget } from "./CharacterGroupsSection";
import {
  CharacterQuickStartContextMenu,
  type CharacterQuickStartContextMenuState,
} from "./CharacterQuickStartContextMenu";
import { CharactersFilterBar } from "./CharactersFilterBar";
import { CharactersListSection } from "./CharactersListSection";
import { CharactersPanelActionBar } from "./CharactersPanelActionBar";
import { CharactersSelectionToolbar } from "./CharactersSelectionToolbar";

function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (value === "") {
      setDebounced("");
      return;
    }
    const handle = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(handle);
  }, [delayMs, value]);
  return debounced;
}

const CHARACTER_GROUP_DRAG_MIME = "application/x-de-koi-character-id";

type CharacterDragSource = { kind: "list" } | { kind: "group"; groupId: string | null };

function sameCharacterGroupDropTarget(
  left: CharacterGroupDropTarget | null,
  right: CharacterGroupDropTarget,
): boolean {
  if (!left) return false;
  if (left.kind !== right.kind) return false;
  if (left.kind === "root") return true;
  return right.kind === "group" && left.groupId === right.groupId;
}

export function CharactersPanel() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 180);
  const searchQuery = useMemo(() => parseCharacterSearchQuery(debouncedSearch), [debouncedSearch]);
  const { data: characters, isLoading, isFetching, isError, refetch } = useCharacterPanelSummaries(
    true,
    searchQuery.text,
  );
  const { data: groups } = useCharacterGroups();
  const deleteCharacter = useDeleteCharacter();
  const duplicateCharacter = useDuplicateCharacter();
  const deleteGroup = useDeleteGroup();
  const openModal = useUIStore((s) => s.openModal);
  const openCharacterDetail = useUIStore((s) => s.openCharacterDetail);
  const openCharacterLibrary = useUIStore((s) => s.openCharacterLibrary);
  const [contextMenu, setContextMenu] = useState<CharacterQuickStartContextMenuState | null>(null);

  const [sort, setSort] = useState<SortOption>("name-asc");
  const [draggedCharacterId, setDraggedCharacterId] = useState<string | null>(null);
  const [draggedCharacterSource, setDraggedCharacterSource] = useState<CharacterDragSource | null>(null);
  const [characterDropTarget, setCharacterDropTarget] = useState<CharacterGroupDropTarget | null>(null);
  const {
    addGroupToChat,
    chatCharacterIds,
    closeFirstMessageConfirm,
    firstMesConfirm,
    handleAddFirstMessage,
    handleStartConversation,
    handleStartNewChat,
    handleStartRoleplay,
    hasActiveChat,
    isStartingChat,
    pendingStartCharacterId,
    toggleCharacter,
  } = useCharactersPanelChatActions();

  // Character data is stored as raw JSON objects.
  const parsedCharacters = useMemo(() => parseCharacterRows(characters), [characters]);
  const {
    allTags,
    clearTagFilters,
    excludedTags,
    favFilter,
    handleDeleteTag,
    includedTags,
    setFavFilter,
    setTagsExpanded,
    tagsExpanded,
    toggleExcludedTag,
    toggleIncludedTag,
  } = useCharactersPanelFilters(parsedCharacters);

  const {
    assigningToGroup,
    cancelCreateGroup,
    creatingGroup,
    editGroupName,
    editingGroupId,
    expandedGroupId,
    groupMembershipPending,
    groupsExpanded,
    handleCreateGroup,
    handleRenameGroup,
    moveCharacterToGroup,
    newGroupName,
    setAssigningToGroup,
    setEditGroupName,
    setEditingGroupId,
    setExpandedGroupId,
    setNewGroupName,
    startCreateGroup,
    toggleAssigningToGroup,
    toggleGroupMember,
    toggleGroupsExpanded,
  } = useCharactersPanelGroups();

  const { assigningGroup, charMap, filteredCharacters, parsedGroups, sortedCharacters } = useCharactersPanelData({
    assigningToGroup,
    excludedTags,
    favoriteFilter: favFilter,
    groups,
    includedTags,
    parsedCharacters,
    searchExcludedTags: searchQuery.excludedTags,
    scopedSearchTerms: searchQuery.scopedTerms,
    sort,
  });

  const {
    clearSelection,
    enterSelectionMode,
    exitSelectionMode,
    exportDialogOpen,
    exportingSelected,
    handleDeleteSelected,
    handleExportSelected,
    selectAllVisible,
    selectedCharacterIds,
    selectionMode,
    setExportDialogOpen,
    toggleSelection,
  } = useCharactersPanelSelection({ sortedCharacters, deleteCharacter });

  const canDragCharacters = useMemo(
    () =>
      parsedGroups.some((group) => group.isSynthetic !== true) &&
      !selectionMode &&
      assigningToGroup === null &&
      !groupMembershipPending,
    [assigningToGroup, groupMembershipPending, parsedGroups, selectionMode],
  );

  const clearCharacterDragState = useCallback(() => {
    setDraggedCharacterId(null);
    setDraggedCharacterSource(null);
    setCharacterDropTarget(null);
  }, []);

  const canDropCharacterOnTarget = useCallback(
    (target: CharacterGroupDropTarget) => {
      if (!draggedCharacterId) return false;
      if (target.kind !== "root") return true;
      return draggedCharacterSource?.kind === "group" && draggedCharacterSource.groupId !== null;
    },
    [draggedCharacterId, draggedCharacterSource],
  );

  const handleCharacterDragStart = useCallback(
    (event: DragEvent<HTMLDivElement>, characterId: string, source: CharacterDragSource) => {
      if (!canDragCharacters) {
        event.preventDefault();
        return;
      }
      setDraggedCharacterId(characterId);
      setDraggedCharacterSource(source);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(CHARACTER_GROUP_DRAG_MIME, characterId);
      event.dataTransfer.setData("text/plain", characterId);
    },
    [canDragCharacters],
  );

  const handleCharacterListDragStart = useCallback(
    (event: DragEvent<HTMLDivElement>, characterId: string) =>
      handleCharacterDragStart(event, characterId, { kind: "list" }),
    [handleCharacterDragStart],
  );

  const handleCharacterGroupMemberDragStart = useCallback(
    (event: DragEvent<HTMLDivElement>, characterId: string, sourceGroupId: string | null) =>
      handleCharacterDragStart(event, characterId, { kind: "group", groupId: sourceGroupId }),
    [handleCharacterDragStart],
  );

  const handleCharacterDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>, target: CharacterGroupDropTarget) => {
      if (!canDropCharacterOnTarget(target)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      setCharacterDropTarget((current) => (sameCharacterGroupDropTarget(current, target) ? current : target));
    },
    [canDropCharacterOnTarget],
  );

  const handleCharacterDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setCharacterDropTarget(null);
  }, []);

  const handleCharacterDrop = useCallback(
    (event: DragEvent<HTMLDivElement>, groupId: string | null) => {
      event.preventDefault();
      event.stopPropagation();
      const characterId = draggedCharacterId || event.dataTransfer.getData(CHARACTER_GROUP_DRAG_MIME);
      if (!characterId) {
        clearCharacterDragState();
        return;
      }
      if (groupId === null && !canDropCharacterOnTarget({ kind: "root" })) {
        clearCharacterDragState();
        return;
      }
      moveCharacterToGroup(
        groupId,
        characterId,
        draggedCharacterSource?.kind === "group" ? draggedCharacterSource.groupId : null,
        parsedGroups,
      );
      clearCharacterDragState();
    },
    [
      canDropCharacterOnTarget,
      clearCharacterDragState,
      draggedCharacterId,
      draggedCharacterSource,
      moveCharacterToGroup,
      parsedGroups,
    ],
  );

  const handleCharacterRootDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => handleCharacterDragOver(event, { kind: "root" }),
    [handleCharacterDragOver],
  );

  const handleCharacterRootDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => handleCharacterDrop(event, null),
    [handleCharacterDrop],
  );

  const handleDuplicateCharacter = useCallback(
    (character: ParsedCharacterRow) => {
      duplicateCharacter.mutate(character.id, {
        onSuccess: () => {
          toast.success(`Duplicated "${character.parsed?.name ?? "character"}"`);
        },
      });
    },
    [duplicateCharacter],
  );

  const handleDeleteCharacter = useCallback(
    async (character: ParsedCharacterRow) => {
      if (
        !(await showConfirmDialog({
          title: "Delete Character",
          message: `Delete "${character.parsed?.name ?? "this character"}"? This cannot be undone.`,
          confirmLabel: "Delete",
          tone: "destructive",
        }))
      ) {
        return;
      }
      deleteCharacter.mutate(character.id);
    },
    [deleteCharacter],
  );

  return (
    <div className="flex flex-col gap-2 p-3">
      <button
        onClick={openCharacterLibrary}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-xs font-medium text-[var(--foreground)] transition-all hover:border-[var(--primary)]/35 hover:bg-[var(--accent)]"
        title="Open full library"
      >
        <Users size="0.875rem" className="text-[var(--primary)]" />
        Open Full Library
      </button>

      <CharactersFilterBar
        search={search}
        onSearchChange={setSearch}
        sort={sort}
        onSortChange={setSort}
        favoriteFilter={favFilter}
        onFavoriteFilterChange={setFavFilter}
        allTags={allTags}
        tagsExpanded={tagsExpanded}
        onToggleTagsExpanded={() => setTagsExpanded((expanded) => !expanded)}
        includedTags={includedTags}
        excludedTags={excludedTags}
        onClearTagFilters={clearTagFilters}
        onToggleIncludedTag={toggleIncludedTag}
        onToggleExcludedTag={toggleExcludedTag}
        onDeleteTag={handleDeleteTag}
      />

      <CharactersPanelActionBar
        selectionMode={selectionMode}
        onCreate={() => openModal("create-character")}
        onImport={() => openModal("import-character")}
        onOpenMaker={() => openModal("character-maker")}
        onToggleSelectionMode={() => {
          if (selectionMode) {
            exitSelectionMode();
          } else {
            setAssigningToGroup(null);
            enterSelectionMode();
          }
        }}
      />

      {selectionMode && (
        <CharactersSelectionToolbar
          selectedCount={selectedCharacterIds.size}
          visibleCount={sortedCharacters.length}
          exportingSelected={exportingSelected}
          onSelectVisible={selectAllVisible}
          onClearSelection={clearSelection}
          onDeleteSelected={handleDeleteSelected}
          onExportSelected={() => setExportDialogOpen(true)}
          onDone={exitSelectionMode}
        />
      )}

      <ExportFormatDialog
        open={exportDialogOpen}
        title="Export Characters"
        description="Native keeps De-Koi metadata. Compatible exports direct Chara Card V2 JSON for other platforms."
        compatibleDescription="Exports direct Chara Card V2 JSON files without the native wrapper."
        onClose={() => setExportDialogOpen(false)}
        onSelect={handleExportSelected}
      />

      <CharacterGroupsSection
        groups={parsedGroups}
        groupsExpanded={groupsExpanded}
        creatingGroup={creatingGroup}
        newGroupName={newGroupName}
        expandedGroupId={expandedGroupId}
        editingGroupId={editingGroupId}
        editGroupName={editGroupName}
        assigningToGroup={assigningToGroup}
        draggedCharacterId={draggedCharacterId}
        characterDropTarget={characterDropTarget}
        canDragCharacters={canDragCharacters}
        hasActiveChat={hasActiveChat}
        selectionMode={selectionMode}
        charMap={charMap}
        isStartingChat={isStartingChat}
        pendingStartCharacterId={pendingStartCharacterId}
        onToggleGroupsExpanded={toggleGroupsExpanded}
        onCreateGroupStart={startCreateGroup}
        onCreateGroup={handleCreateGroup}
        onCancelCreateGroup={cancelCreateGroup}
        onNewGroupNameChange={setNewGroupName}
        onExpandedGroupChange={setExpandedGroupId}
        onEditingGroupChange={setEditingGroupId}
        onEditGroupNameChange={setEditGroupName}
        onRenameGroup={handleRenameGroup}
        onDeleteGroup={(groupId) => deleteGroup.mutate(groupId)}
        onAddGroupToChat={addGroupToChat}
        onToggleAssigningToGroup={(groupId) => toggleAssigningToGroup(groupId, exitSelectionMode)}
        onToggleGroupMember={toggleGroupMember}
        onCharacterDragStart={handleCharacterGroupMemberDragStart}
        onCharacterDragEnd={clearCharacterDragState}
        onCharacterDragOver={handleCharacterDragOver}
        onCharacterDragLeave={handleCharacterDragLeave}
        onCharacterDrop={handleCharacterDrop}
        onOpenCharacterDetail={openCharacterDetail}
        onOpenContextMenu={setContextMenu}
        onStartNewChat={(memberId, memberName) => void handleStartNewChat(memberId, memberName)}
      />

      <CharactersListSection
        characters={sortedCharacters}
        filteredCount={filteredCharacters.length}
        search={search}
        isLoading={isLoading}
        isFetching={isFetching}
        isError={isError}
        selectionMode={selectionMode}
        selectedCount={selectedCharacterIds.size}
        selectedCharacterIds={selectedCharacterIds}
        chatCharacterIds={chatCharacterIds}
        hasActiveChat={hasActiveChat}
        isAssigning={assigningToGroup !== null}
        assigningGroup={assigningGroup}
        canDragCharacters={canDragCharacters}
        draggedCharacterId={draggedCharacterId}
        isRootDropTarget={characterDropTarget?.kind === "root"}
        onRetry={() => void refetch()}
        onToggleSelection={toggleSelection}
        onToggleGroupMember={toggleGroupMember}
        onOpenCharacterDetail={openCharacterDetail}
        onOpenContextMenu={setContextMenu}
        onToggleChatCharacter={toggleCharacter}
        onDuplicateCharacter={handleDuplicateCharacter}
        onDeleteCharacter={(character) => void handleDeleteCharacter(character)}
        onToggleIncludedTag={toggleIncludedTag}
        onCharacterDragStart={handleCharacterListDragStart}
        onCharacterDragEnd={clearCharacterDragState}
        onCharacterRootDragOver={handleCharacterRootDragOver}
        onCharacterDragLeave={handleCharacterDragLeave}
        onCharacterRootDrop={handleCharacterRootDrop}
      />

      {contextMenu && (
        <CharacterQuickStartContextMenu
          menu={contextMenu}
          pendingStartCharacterId={pendingStartCharacterId}
          onClose={() => setContextMenu(null)}
          onStartRoleplay={(menu) => {
            void handleStartRoleplay(menu.charId, menu.charName, menu.firstMes, menu.altGreetings);
          }}
          onStartConversation={(menu) => handleStartConversation(menu.charId, menu.charName)}
        />
      )}

      {firstMesConfirm && (
        <CharacterFirstMessageDialog
          confirmation={firstMesConfirm}
          onClose={closeFirstMessageConfirm}
          onAddMessage={handleAddFirstMessage}
        />
      )}
    </div>
  );
}
