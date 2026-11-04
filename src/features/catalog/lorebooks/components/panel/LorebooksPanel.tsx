// ──────────────────────────────────────────────
// Panel: Lorebooks
// Action strip, search, All/Active + Type + Tags filters, folders, click-to-edit
// ──────────────────────────────────────────────
import { useRef, useState, useMemo, useCallback, type ChangeEvent, type DragEvent } from "react";
import { toast } from "sonner";
import {
  Upload,
  BookOpen,
  Layers,
  Star,
  Tag,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  FolderPlus,
  Pencil,
  Trash2,
} from "lucide-react";
import { useUIStore } from "../../../../../shared/stores/ui.store";
import { useChatStore } from "../../../../../shared/stores/chat.store";
import {
  useLorebooks,
  useDeleteLorebook,
  useDuplicateLorebook,
  useUpdateLorebook,
  useUploadLorebookImage,
} from "../../hooks/use-lorebooks";
import { useCharacterSummariesByIds } from "../../../characters/index";
import { usePersonaSummaries } from "../../../personas/index";
import type { Lorebook } from "../../../../../engine/contracts/types/lorebook";
import { showConfirmDialog } from "../../../../../shared/lib/app-dialogs";
import { cn } from "../../../../../shared/lib/utils";
import {
  CatalogActionBar,
  CatalogFilterPill,
  CatalogFilterRow,
  CatalogSearchStrip,
  TagFilterChip,
  TagFilterClear,
  tagFilterSummary,
} from "../../../components/CatalogPanelControls";
import {
  NO_TAG_FILTERS,
  cycleTagFilter,
  hasTagFilters,
  withoutTagFilter,
  type TagFilters,
} from "../../../lib/tag-filters";
import { exportApi } from "../../../../../shared/api/export-api";
import { getChatCharacterIds } from "../../../../../shared/lib/chat-macros";
import { ExportFormatDialog, type ExportFormatChoice } from "../../../../../shared/components/ui/ExportFormatDialog";
import {
  getNextUnnamedLibraryFolderName,
  useCreateLibraryFolder,
  useDeleteLibraryFolder,
  useLibraryFolders,
  useMoveLibraryItem,
  useUpdateLibraryFolder,
} from "../../../library-folders";
import { LorebookRow } from "./LorebookRow";
import {
  collectLorebookTags,
  filterLorebooksForPanel,
  groupLorebooksByCategory,
  parseLorebookTags,
  sortLorebooksForPanel,
  type LorebookPanelActiveFilter,
  type LorebookPanelSort,
} from "./lorebook-panel-model";
import { LOREBOOK_PANEL_CATEGORIES } from "./lorebook-panel-config";
import { toUserMessage } from "../../../../../shared/lib/error-message";

const LOREBOOK_LIBRARY_DRAG_MIME = "application/x-de-koi-lorebook-id";

const SORT_OPTIONS: ReadonlyArray<{ value: LorebookPanelSort; label: string; short?: string }> = [
  { value: "name-asc", label: "A-Z" },
  { value: "name-desc", label: "Z-A" },
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "tokens", label: "Token Budget", short: "Budget" },
];

/** The lorebook types the Type filter offers (World … Other), without the All/Active views. */
const LOREBOOK_TYPES = LOREBOOK_PANEL_CATEGORIES.filter(
  (category) => category.id !== "all" && category.id !== "active",
);

// The selection toolbar's folder picker: "" is its prompt, this value means "out of any folder".
const MOVE_TO_UNFILED = "__unfiled__";

export function LorebooksPanel() {
  const [activeFilter, setActiveFilter] = useState<LorebookPanelActiveFilter>("all");
  const [typeFilters, setTypeFilters] = useState<TagFilters>(NO_TAG_FILTERS);
  const [typesExpanded, setTypesExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sort, setSort] = useState<LorebookPanelSort>("name-asc");
  const [tagFilters, setTagFilters] = useState<TagFilters>(NO_TAG_FILTERS);
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedLorebookIds, setSelectedLorebookIds] = useState<Set<string>>(new Set());
  const [exportingSelected, setExportingSelected] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editFolderName, setEditFolderName] = useState("");
  const [draggedLorebookId, setDraggedLorebookId] = useState<string | null>(null);
  const [lorebookDropTargetId, setLorebookDropTargetId] = useState<string | null | undefined>(undefined);
  const lorebookImageInputRef = useRef<HTMLInputElement>(null);
  const imageTargetLorebookIdRef = useRef<string | null>(null);

  // Active chat context for the "Active" filter
  const activeChat = useChatStore((s) => s.activeChat);
  const activeCharacterIds = useMemo(() => getChatCharacterIds(activeChat), [activeChat]);
  const activeLorebookScopeContext = useMemo(
    () => ({
      chat: activeChat,
      characters: activeCharacterIds.map((id) => ({ id })),
      persona: activeChat?.personaId ? { id: activeChat.personaId } : null,
    }),
    [activeChat, activeCharacterIds],
  );

  // All lorebooks; the Active, Type and Tags filters run client-side.
  const { data: lorebooks, isLoading } = useLorebooks(undefined);
  const lorebookCharacterIds = useMemo(() => {
    const ids = new Set<string>();
    for (const lorebook of (lorebooks ?? []) as Lorebook[]) {
      if (Array.isArray(lorebook.characterIds)) {
        for (const id of lorebook.characterIds) {
          if (typeof id === "string" && id.trim()) ids.add(id.trim());
        }
      }
      if (typeof lorebook.characterId === "string" && lorebook.characterId.trim()) {
        ids.add(lorebook.characterId.trim());
      }
    }
    return Array.from(ids);
  }, [lorebooks]);
  const { data: rawCharacters } = useCharacterSummariesByIds(lorebookCharacterIds, lorebookCharacterIds.length > 0);
  const { data: rawPersonas } = usePersonaSummaries();
  const deleteLorebook = useDeleteLorebook();
  const duplicateLorebook = useDuplicateLorebook();
  const updateLorebook = useUpdateLorebook();
  const uploadLorebookImage = useUploadLorebookImage();
  const {
    data: lorebookFolders,
    isLoading: lorebookFoldersLoading,
    isError: lorebookFoldersError,
    refetch: refetchLorebookFolders,
  } = useLibraryFolders("lorebooks");
  const createLorebookFolder = useCreateLibraryFolder("lorebooks");
  const updateLorebookFolder = useUpdateLibraryFolder("lorebooks");
  const deleteLorebookFolder = useDeleteLibraryFolder("lorebooks");
  const moveLorebookItem = useMoveLibraryItem("lorebooks");
  const openModal = useUIStore((s) => s.openModal);
  const openLorebookDetail = useUIStore((s) => s.openLorebookDetail);

  const characterNameById = useMemo(() => {
    const map = new Map<string, string>();
    if (!rawCharacters) return map;
    for (const c of rawCharacters) {
      const d = c.data ?? {};
      map.set(c.id, typeof d?.name === "string" ? d.name : "Unknown");
    }
    return map;
  }, [rawCharacters]);
  const personaNameById = useMemo(() => {
    const map = new Map<string, string>();
    if (!rawPersonas) return map;
    for (const p of rawPersonas) {
      map.set(p.id, p.comment ? `${p.name} - ${p.comment}` : p.name || "Unknown");
    }
    return map;
  }, [rawPersonas]);
  const getCharacterNames = useCallback(
    (lb: Lorebook) => {
      const ids =
        Array.isArray(lb.characterIds) && lb.characterIds.length > 0
          ? lb.characterIds
          : lb.characterId
            ? [lb.characterId]
            : [];
      return ids.map((id) => characterNameById.get(id) ?? id);
    },
    [characterNameById],
  );
  const getPersonaNames = useCallback(
    (lb: Lorebook) => {
      const ids =
        Array.isArray(lb.personaIds) && lb.personaIds.length > 0 ? lb.personaIds : lb.personaId ? [lb.personaId] : [];
      return ids.map((id) => personaNameById.get(id) ?? id);
    },
    [personaNameById],
  );

  const allTags = useMemo(() => {
    if (!lorebooks) return [] as string[];
    return collectLorebookTags(lorebooks as Lorebook[]);
  }, [lorebooks]);

  const handleDeleteTag = useCallback(
    async (tag: string) => {
      if (
        !(await showConfirmDialog({
          title: "Remove Tag",
          message: `Remove tag "${tag}" from all lorebooks?`,
          confirmLabel: "Remove",
          tone: "destructive",
        }))
      ) {
        return;
      }
      try {
        if (!lorebooks) return;
        const affected = (lorebooks as Lorebook[]).filter((lb) => parseLorebookTags(lb).includes(tag));
        for (const lb of affected) {
          const newTags = parseLorebookTags(lb).filter((t) => t !== tag);
          await updateLorebook.mutateAsync({ id: lb.id, tags: newTags });
        }
        setTagFilters((filters) => withoutTagFilter(filters, tag));
      } catch {
        toast.error("Couldn't remove the tag from some lorebooks. Try again.");
      }
    },
    [lorebooks, updateLorebook],
  );

  // Filter by search
  const filtered = useMemo(() => {
    if (!lorebooks) return [];
    return filterLorebooksForPanel({
      lorebooks: lorebooks as Lorebook[],
      activeFilter,
      activeScopeContext: activeLorebookScopeContext,
      typeFilters,
      tagFilters,
      searchQuery,
      getCharacterNames,
      getPersonaNames,
    });
  }, [
    lorebooks,
    activeFilter,
    typeFilters,
    activeLorebookScopeContext,
    searchQuery,
    tagFilters,
    getCharacterNames,
    getPersonaNames,
  ]);

  const sorted = useMemo(() => {
    return sortLorebooksForPanel(filtered, sort);
  }, [filtered, sort]);

  const lorebookFolderList = useMemo(() => lorebookFolders ?? [], [lorebookFolders]);
  const lorebookLibraryLoading = isLoading || lorebookFoldersLoading;
  const lorebookFolderDataReady = !lorebookFoldersLoading && !lorebookFoldersError;
  const lorebookFiltersActive =
    activeFilter === "active" ||
    hasTagFilters(typeFilters) ||
    hasTagFilters(tagFilters) ||
    searchQuery.trim().length > 0;
  // The "grouped by type" view shows only when nothing narrows the list by type or activity.
  const showGroupedByType = activeFilter === "all" && !hasTagFilters(typeFilters);

  const lorebookFolderIds = useMemo(() => new Set(lorebookFolderList.map((folder) => folder.id)), [lorebookFolderList]);

  const rootLorebooks = useMemo(
    () => sorted.filter((lorebook) => !lorebook.folderId || !lorebookFolderIds.has(lorebook.folderId)),
    [sorted, lorebookFolderIds],
  );

  const lorebooksByFolder = useMemo(() => {
    const byFolder = new Map<string, Lorebook[]>();
    for (const folder of lorebookFolderList) byFolder.set(folder.id, []);
    for (const lorebook of sorted) {
      if (lorebook.folderId && byFolder.has(lorebook.folderId)) {
        byFolder.get(lorebook.folderId)?.push(lorebook);
      }
    }
    return byFolder;
  }, [lorebookFolderList, sorted]);

  const displayedLorebookFolders = useMemo(() => {
    if (!lorebookFiltersActive) return lorebookFolderList;
    return lorebookFolderList.filter((folder) => (lorebooksByFolder.get(folder.id)?.length ?? 0) > 0);
  }, [lorebookFiltersActive, lorebookFolderList, lorebooksByFolder]);

  // Group root-level lorebooks by category for "all" view.
  const grouped = useMemo(() => {
    if (!showGroupedByType) return null;
    return groupLorebooksByCategory(rootLorebooks);
  }, [rootLorebooks, showGroupedByType]);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedLorebookIds(new Set());
  }, []);

  const toggleSelection = useCallback((lorebookId: string) => {
    setSelectedLorebookIds((prev) => {
      const next = new Set(prev);
      if (next.has(lorebookId)) next.delete(lorebookId);
      else next.add(lorebookId);
      return next;
    });
  }, []);

  const handleExportSelected = useCallback(
    async (format: ExportFormatChoice) => {
      if (selectedLorebookIds.size === 0) return;
      setExportingSelected(true);
      setExportDialogOpen(false);
      try {
        exportApi.triggerDownload(await exportApi.lorebooksBulk([...selectedLorebookIds], format));
        toast.success(`Exported ${selectedLorebookIds.size} lorebook${selectedLorebookIds.size === 1 ? "" : "s"}`);
      } catch (error) {
        toast.error(toUserMessage(error, { fallback: "Couldn't export lorebooks. Try again." }));
      } finally {
        setExportingSelected(false);
      }
    },
    [selectedLorebookIds],
  );

  const handleDeleteSelected = useCallback(async () => {
    const ids = [...selectedLorebookIds];
    if (ids.length === 0) return;

    if (
      !(await showConfirmDialog({
        title: "Delete Lorebooks",
        message: `Delete ${ids.length} lorebook${ids.length === 1 ? "" : "s"}? All entries inside them will be lost.`,
        confirmLabel: "Delete",
        tone: "destructive",
      }))
    ) {
      return;
    }

    const results = await Promise.allSettled(ids.map((id) => deleteLorebook.mutateAsync(id)));
    const failedIds = ids.filter((_, index) => results[index]?.status === "rejected");
    const deletedCount = ids.length - failedIds.length;

    if (deletedCount > 0) {
      toast.success(`Deleted ${deletedCount} lorebook${deletedCount === 1 ? "" : "s"}`);
    }

    if (failedIds.length > 0) {
      setSelectedLorebookIds(new Set(failedIds));
      toast.error(`Couldn't delete ${failedIds.length} lorebook${failedIds.length === 1 ? "" : "s"}. Try again.`);
      return;
    }

    exitSelectionMode();
  }, [selectedLorebookIds, deleteLorebook, exitSelectionMode]);

  const handleToggleEnabled = useCallback(
    async (lorebook: Lorebook) => {
      try {
        await updateLorebook.mutateAsync({ id: lorebook.id, enabled: !lorebook.enabled });
      } catch (error) {
        toast.error(
          toUserMessage(error, {
            fallback: `Couldn't switch "${lorebook.name}" ${lorebook.enabled ? "off" : "on"}. Try again.`,
          }),
        );
      }
    },
    [updateLorebook],
  );

  const handleDuplicate = useCallback(
    async (lorebook: Lorebook) => {
      try {
        await duplicateLorebook.mutateAsync(lorebook.id);
        toast.success(`Copied "${lorebook.name}"`);
      } catch (error) {
        toast.error(toUserMessage(error, { fallback: `Couldn't copy "${lorebook.name}". Try again.` }));
      }
    },
    [duplicateLorebook],
  );

  const handleCreateFolder = useCallback(() => {
    createLorebookFolder.mutate({ name: getNextUnnamedLibraryFolderName(lorebookFolderList) });
  }, [createLorebookFolder, lorebookFolderList]);

  const handleStartRenameFolder = useCallback((folderId: string, name: string) => {
    setEditingFolderId(folderId);
    setEditFolderName(name);
  }, []);

  const handleRenameFolder = useCallback(
    (folderId: string) => {
      const name = editFolderName.trim();
      if (!name) {
        setEditingFolderId(null);
        setEditFolderName("");
        return;
      }
      updateLorebookFolder.mutate({ id: folderId, name });
      setEditingFolderId(null);
      setEditFolderName("");
    },
    [editFolderName, updateLorebookFolder],
  );

  const handleDeleteFolder = useCallback(
    async (folderId: string, name: string) => {
      if (
        !(await showConfirmDialog({
          title: "Delete Folder",
          message: `Delete "${name}"? Lorebooks inside it move back to the main list.`,
          confirmLabel: "Delete",
          tone: "destructive",
        }))
      ) {
        return;
      }
      deleteLorebookFolder.mutate(folderId);
    },
    [deleteLorebookFolder],
  );

  const handleToggleFolderCollapsed = useCallback(
    (folderId: string, collapsed: boolean) => {
      updateLorebookFolder.mutate({ id: folderId, collapsed });
    },
    [updateLorebookFolder],
  );

  const clearLorebookDragState = useCallback(() => {
    setDraggedLorebookId(null);
    setLorebookDropTargetId(undefined);
  }, []);

  const canDragLorebooks = lorebookFolderDataReady && lorebookFolderList.length > 0 && !selectionMode;
  const lorebookFolderMoveOptions = useMemo(
    () => (lorebookFolderDataReady ? lorebookFolderList : []),
    [lorebookFolderDataReady, lorebookFolderList],
  );

  // Moving by folder picker (the keyboard- and touch-friendly way; dragging also works on desktop).
  const handleMoveSelectedToFolder = useCallback(
    async (folderId: string | null) => {
      const lorebookById = new Map(((lorebooks ?? []) as Lorebook[]).map((lorebook) => [lorebook.id, lorebook]));
      const ids = [...selectedLorebookIds].filter((id) => {
        const existingFolderId = lorebookById.get(id)?.folderId ?? null;
        const currentFolderId = existingFolderId && lorebookFolderIds.has(existingFolderId) ? existingFolderId : null;
        return currentFolderId !== folderId;
      });
      if (ids.length === 0) return;

      const results = await Promise.allSettled(ids.map((id) => moveLorebookItem.mutateAsync({ itemId: id, folderId })));
      const failedCount = results.filter((result) => result.status === "rejected").length;
      const movedCount = ids.length - failedCount;
      const folderName = folderId ? lorebookFolderList.find((folder) => folder.id === folderId)?.name : null;

      if (movedCount > 0) {
        const plural = movedCount === 1 ? "" : "s";
        toast.success(
          folderName
            ? `Moved ${movedCount} lorebook${plural} to "${folderName}"`
            : `Moved ${movedCount} lorebook${plural} out of folders`,
        );
      }
      if (failedCount > 0) {
        toast.error(`Couldn't move ${failedCount} lorebook${failedCount === 1 ? "" : "s"}. Try again.`);
      }
    },
    [lorebookFolderIds, lorebookFolderList, lorebooks, moveLorebookItem, selectedLorebookIds],
  );

  const handleLorebookDragStart = useCallback(
    (event: DragEvent<HTMLDivElement>, lorebookId: string) => {
      if (!canDragLorebooks) {
        event.preventDefault();
        return;
      }
      event.stopPropagation();
      setDraggedLorebookId(lorebookId);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(LOREBOOK_LIBRARY_DRAG_MIME, lorebookId);
      event.dataTransfer.setData("text/plain", lorebookId);
    },
    [canDragLorebooks],
  );

  const handleLorebookDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>, folderId: string | null) => {
      if (!draggedLorebookId) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      setLorebookDropTargetId((current) => (current === folderId ? current : folderId));
    },
    [draggedLorebookId],
  );

  const handleLorebookDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    const relatedTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (relatedTarget && event.currentTarget.contains(relatedTarget)) return;
    setLorebookDropTargetId(undefined);
  }, []);

  const handleLorebookDrop = useCallback(
    (event: DragEvent<HTMLDivElement>, folderId: string | null) => {
      event.preventDefault();
      event.stopPropagation();
      const lorebookId =
        draggedLorebookId ||
        event.dataTransfer.getData(LOREBOOK_LIBRARY_DRAG_MIME) ||
        event.dataTransfer.getData("text/plain");
      if (!lorebookId) {
        clearLorebookDragState();
        return;
      }

      const existingFolderId = sorted.find((lorebook) => lorebook.id === lorebookId)?.folderId ?? null;
      const currentFolderId = existingFolderId && lorebookFolderIds.has(existingFolderId) ? existingFolderId : null;
      if (currentFolderId !== folderId) {
        moveLorebookItem.mutate({ itemId: lorebookId, folderId });
      }
      clearLorebookDragState();
    },
    [clearLorebookDragState, draggedLorebookId, lorebookFolderIds, moveLorebookItem, sorted],
  );

  const handlePickLorebookImage = useCallback((lorebookId: string) => {
    imageTargetLorebookIdRef.current = lorebookId;
    if (lorebookImageInputRef.current) {
      lorebookImageInputRef.current.value = "";
      lorebookImageInputRef.current.click();
    }
  }, []);

  const handleLorebookImageSelected = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      const lorebookId = imageTargetLorebookIdRef.current;
      if (!file || !lorebookId) return;

      if (!file.type.startsWith("image/")) {
        imageTargetLorebookIdRef.current = null;
        toast.error("Choose an image file for the lorebook picture");
        return;
      }

      const reader = new FileReader();
      reader.onload = async () => {
        const image = typeof reader.result === "string" ? reader.result : "";
        if (!image) {
          toast.error("Couldn't read that image. Pick a PNG, JPG or WEBP file and try again.");
          return;
        }

        try {
          await uploadLorebookImage.mutateAsync({ id: lorebookId, image, filename: file.name });
          toast.success("Lorebook picture updated");
        } catch (error) {
          toast.error(toUserMessage(error, { fallback: "Couldn't upload lorebook picture. Try again." }));
        } finally {
          imageTargetLorebookIdRef.current = null;
        }
      };
      reader.onerror = () => {
        imageTargetLorebookIdRef.current = null;
        toast.error("Couldn't read that image. Pick a PNG, JPG or WEBP file and try again.");
      };
      reader.readAsDataURL(file);
    },
    [uploadLorebookImage],
  );

  const renderLorebookRow = useCallback(
    (lb: Lorebook) => {
      const combinedNames = [...getCharacterNames(lb), ...getPersonaNames(lb)].join(", ") || undefined;
      return (
        <LorebookRow
          key={lb.id}
          lorebook={lb}
          characterName={combinedNames}
          personaName={undefined}
          onClick={() => {
            if (selectionMode) toggleSelection(lb.id);
            else openLorebookDetail(lb.id);
          }}
          onToggleEnabled={() => void handleToggleEnabled(lb)}
          onDuplicate={() => void handleDuplicate(lb)}
          onDelete={async () => {
            if (
              await showConfirmDialog({
                title: "Delete Lorebook",
                message: `Delete "${lb.name}"? All entries will be lost.`,
                confirmLabel: "Delete",
                tone: "destructive",
              })
            ) {
              deleteLorebook.mutate(lb.id);
            }
          }}
          onImagePick={() => handlePickLorebookImage(lb.id)}
          selectionMode={selectionMode}
          isSelected={selectedLorebookIds.has(lb.id)}
          onToggleSelect={() => toggleSelection(lb.id)}
          draggable={canDragLorebooks}
          isDragging={draggedLorebookId === lb.id}
          onDragStart={(event) => handleLorebookDragStart(event, lb.id)}
          onDragEnd={clearLorebookDragState}
        />
      );
    },
    [
      canDragLorebooks,
      clearLorebookDragState,
      deleteLorebook,
      draggedLorebookId,
      getCharacterNames,
      getPersonaNames,
      handleDuplicate,
      handleLorebookDragStart,
      handlePickLorebookImage,
      handleToggleEnabled,
      openLorebookDetail,
      selectedLorebookIds,
      selectionMode,
      toggleSelection,
    ],
  );

  const showLorebookEmptyState =
    !lorebookLibraryLoading &&
    sorted.length === 0 &&
    (lorebookFoldersError || lorebookFiltersActive || displayedLorebookFolders.length === 0);
  const showLorebookList =
    !lorebookLibraryLoading && !lorebookFoldersError && (sorted.length > 0 || displayedLorebookFolders.length > 0);
  const showLorebookFlatFallback = !lorebookLibraryLoading && lorebookFoldersError && sorted.length > 0;

  const renderLorebookFolder = (folder: (typeof lorebookFolderList)[number]) => {
    const folderLorebooks = lorebooksByFolder.get(folder.id) ?? [];
    const isExpanded = !folder.collapsed;
    const isDropTarget = lorebookDropTargetId === folder.id;
    return (
      <div
        key={folder.id}
        data-lorebook-library-folder-id={folder.id}
        onDragOver={(event) => handleLorebookDragOver(event, folder.id)}
        onDragLeave={handleLorebookDragLeave}
        onDrop={(event) => handleLorebookDrop(event, folder.id)}
        className={cn(
          "rounded-xl border border-transparent bg-[var(--secondary)]/35 transition-colors",
          isDropTarget && "border-amber-400/35 bg-amber-400/10",
        )}
      >
        <div className="flex items-center gap-1.5 px-2 py-1.5">
          <button
            type="button"
            onClick={() => handleToggleFolderCollapsed(folder.id, !folder.collapsed)}
            className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            title={isExpanded ? "Collapse folder" : "Expand folder"}
          >
            <ChevronRight size="0.75rem" className={cn("transition-transform", isExpanded && "rotate-90")} />
          </button>
          <FolderOpen size="0.875rem" className="shrink-0 text-amber-400" />
          {editingFolderId === folder.id ? (
            <input
              autoFocus
              value={editFolderName}
              onChange={(event) => setEditFolderName(event.target.value)}
              onBlur={() => handleRenameFolder(folder.id)}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleRenameFolder(folder.id);
                if (event.key === "Escape") {
                  setEditingFolderId(null);
                  setEditFolderName("");
                }
              }}
              className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-amber-400/50"
            />
          ) : (
            <button
              type="button"
              onClick={() => handleToggleFolderCollapsed(folder.id, !folder.collapsed)}
              className="min-w-0 flex-1 truncate text-left text-xs font-medium text-[var(--foreground)]"
              title={folder.name}
            >
              {folder.name}
            </button>
          )}
          <span className="rounded-md bg-[var(--background)]/60 px-1.5 py-0.5 text-[0.625rem] text-[var(--muted-foreground)]">
            {folderLorebooks.length}
          </span>
          {!selectionMode && (
            <>
              <button
                type="button"
                onClick={() => handleStartRenameFolder(folder.id, folder.name)}
                className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                title="Rename folder"
              >
                <Pencil size="0.6875rem" />
              </button>
              <button
                type="button"
                onClick={() => handleDeleteFolder(folder.id, folder.name)}
                className="rounded-md p-1 text-[var(--destructive)] transition-colors hover:bg-[var(--destructive)]/15"
                title="Delete folder"
              >
                <Trash2 size="0.6875rem" />
              </button>
            </>
          )}
        </div>
        {isExpanded && (
          <div className="flex flex-col gap-1 px-1 pb-1">
            {folderLorebooks.length > 0 ? (
              folderLorebooks.map(renderLorebookRow)
            ) : (
              <div className="rounded-lg border border-dashed border-[var(--border)] px-2 py-2 text-center text-[0.625rem] text-[var(--muted-foreground)]">
                Drop lorebooks here
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const typeSummary = tagFilterSummary(typeFilters);
  const tagSummary = tagFilterSummary(tagFilters);

  return (
    // The tool strips touch the panel's edges; only the list below has padding.
    <div className="flex flex-col">
      <input
        ref={lorebookImageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleLorebookImageSelected}
      />

      <CatalogActionBar
        tone="amber"
        selectionMode={selectionMode}
        onCreate={() => openModal("create-lorebook")}
        onImport={() => openModal("import-lorebook")}
        onOpenMaker={() => openModal("lorebook-maker")}
        onToggleSelectionMode={() => {
          if (selectionMode) exitSelectionMode();
          else setSelectionMode(true);
        }}
      />

      <CatalogSearchStrip
        search={searchQuery}
        onSearchChange={setSearchQuery}
        placeholder="Search lorebooks"
        sort={sort}
        sortOptions={SORT_OPTIONS}
        onSortChange={setSort}
      />

      {/* The type and tag lists open underneath the pills. Clicking a type or tag cycles it
          off → include → exclude → off. */}
      <CatalogFilterRow label="Filter lorebooks">
        {(["all", "active"] as const).map((option) => (
          <CatalogFilterPill
            key={option}
            tone="amber"
            active={activeFilter === option}
            pressed={activeFilter === option}
            title={option === "all" ? "All lorebooks" : "Lorebooks the open chat uses"}
            onClick={() => setActiveFilter(option)}
          >
            {option === "active" && <Star size="0.5625rem" className="shrink-0" aria-hidden="true" />}
            {option === "all" ? "All" : "Active"}
          </CatalogFilterPill>
        ))}
        <CatalogFilterPill
          tone="amber"
          active={hasTagFilters(typeFilters) || typesExpanded}
          expanded={typesExpanded}
          title={typesExpanded ? "Hide types" : "Filter by type"}
          onClick={() => setTypesExpanded(!typesExpanded)}
        >
          <Layers size="0.625rem" aria-hidden="true" />
          Type{typeSummary && <span className="ml-0.5 opacity-70">· {typeSummary}</span>}
          <ChevronDown size="0.625rem" className={cn("transition-transform", typesExpanded && "rotate-180")} />
        </CatalogFilterPill>
        {allTags.length > 0 && (
          <CatalogFilterPill
            tone="amber"
            active={hasTagFilters(tagFilters) || tagsExpanded}
            expanded={tagsExpanded}
            title={tagsExpanded ? "Hide tags" : "Show tags"}
            onClick={() => setTagsExpanded(!tagsExpanded)}
          >
            <Tag size="0.625rem" aria-hidden="true" />
            Tags ({allTags.length}){tagSummary && <span className="ml-0.5 opacity-70">· {tagSummary}</span>}
            <ChevronDown size="0.625rem" className={cn("transition-transform", tagsExpanded && "rotate-180")} />
          </CatalogFilterPill>
        )}
      </CatalogFilterRow>

      {typesExpanded && (
        <div className="flex flex-wrap gap-1 border-b border-[var(--border)]/60 p-2">
          {hasTagFilters(typeFilters) && <TagFilterClear onClear={() => setTypeFilters(NO_TAG_FILTERS)} />}
          {LOREBOOK_TYPES.map((type) => (
            <TagFilterChip
              key={type.id}
              tag={type.label}
              noun="Type"
              tone="amber"
              mode={typeFilters[type.id]}
              onCycle={() => setTypeFilters((filters) => cycleTagFilter(filters, type.id))}
            />
          ))}
        </div>
      )}

      {allTags.length > 0 && tagsExpanded && (
        <div className="flex flex-wrap gap-1 border-b border-[var(--border)]/60 p-2">
          {hasTagFilters(tagFilters) && <TagFilterClear onClear={() => setTagFilters(NO_TAG_FILTERS)} />}
          {allTags.map((tag) => (
            <TagFilterChip
              key={tag}
              tag={tag}
              tone="amber"
              mode={tagFilters[tag]}
              onCycle={() => setTagFilters((filters) => cycleTagFilter(filters, tag))}
              onDelete={() => void handleDeleteTag(tag)}
            />
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 px-3 pb-3 pt-0.5">
        {selectionMode && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/60 px-3 py-2">
            <span className="text-[0.6875rem] font-medium text-[var(--muted-foreground)]">
              {selectedLorebookIds.size} selected
            </span>
            <button
              onClick={() => setSelectedLorebookIds(new Set(sorted.map((lb) => lb.id)))}
              disabled={sorted.length === 0}
              className="rounded-lg px-2.5 py-1 text-[0.625rem] font-medium text-amber-400 transition-colors hover:bg-[var(--accent)] disabled:opacity-40"
            >
              Select visible
            </button>
            <button
              onClick={() => setSelectedLorebookIds(new Set())}
              disabled={selectedLorebookIds.size === 0}
              className="rounded-lg px-2.5 py-1 text-[0.625rem] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-40"
            >
              Clear
            </button>
            {lorebookFolderMoveOptions.length > 0 && (
              <select
                value=""
                disabled={selectedLorebookIds.size === 0 || moveLorebookItem.isPending}
                aria-label="Move selected lorebooks to folder"
                title="Move to folder"
                onChange={(event) => {
                  const value = event.target.value;
                  if (!value) return;
                  void handleMoveSelectedToFolder(value === MOVE_TO_UNFILED ? null : value);
                }}
                className="h-6 max-w-[9rem] rounded-lg border border-[var(--border)] bg-[var(--background)] px-1.5 text-[0.625rem] font-medium text-[var(--foreground)] outline-none transition-colors focus:border-amber-400/50 disabled:opacity-40"
              >
                <option value="">Move to folder…</option>
                <option value={MOVE_TO_UNFILED}>Unfiled</option>
                {lorebookFolderMoveOptions.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
            )}
            <button
              onClick={handleDeleteSelected}
              disabled={selectedLorebookIds.size === 0}
              className="inline-flex items-center gap-1 rounded-lg bg-[var(--destructive)]/12 px-2.5 py-1 text-[0.625rem] font-medium text-[var(--destructive)] transition-all hover:bg-[var(--destructive)]/20 disabled:opacity-40"
            >
              <Trash2 size="0.6875rem" />
              Delete
            </button>
            <button
              onClick={() => setExportDialogOpen(true)}
              disabled={selectedLorebookIds.size === 0 || exportingSelected}
              className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-2.5 py-1 text-[0.625rem] font-medium text-white transition-all hover:opacity-90 disabled:opacity-40"
            >
              <Upload size="0.6875rem" />
              {exportingSelected ? "Exporting..." : "Export ZIP"}
            </button>
            <button
              onClick={exitSelectionMode}
              className="rounded-lg px-2.5 py-1 text-[0.625rem] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            >
              Done
            </button>
          </div>
        )}

        <ExportFormatDialog
          open={exportDialogOpen}
          title="Export Lorebooks"
          description="Native keeps De-Koi folders and entry fields. Compatible exports a folderless World Info JSON for other roleplay tools."
          onClose={() => setExportDialogOpen(false)}
          onSelect={handleExportSelected}
        />

        {/* Library folders: the heading's button makes one; lorebooks move in by dragging or the
          selection toolbar's folder picker. */}
        {!lorebookLibraryLoading && !lorebookFoldersError && (
          <div className="mt-1">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 px-1 py-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                <FolderOpen size="0.6875rem" aria-hidden="true" />
                Folders ({lorebookFolderList.length})
              </span>
              <button
                type="button"
                onClick={handleCreateFolder}
                className="rounded-lg p-1 text-[var(--muted-foreground)] transition-all hover:bg-[var(--accent)] hover:text-amber-400"
                title="Create folder"
                aria-label="Create folder"
              >
                <FolderPlus size="0.8125rem" aria-hidden="true" />
              </button>
            </div>

            <div className="mt-1 flex flex-col gap-1">
              {displayedLorebookFolders.map(renderLorebookFolder)}
              {lorebookFolderList.length === 0 && (
                <div className="rounded-lg border border-dashed border-[var(--border)] px-3 py-2.5 text-center text-[0.625rem] text-[var(--muted-foreground)]">
                  No folders yet - click <FolderPlus size="0.625rem" className="inline" aria-hidden="true" /> to create
                  one
                </div>
              )}
            </div>
          </div>
        )}

        {/* Loading */}
        {lorebookLibraryLoading && (
          <div className="flex flex-col gap-2 py-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="shimmer h-14 rounded-xl" />
            ))}
          </div>
        )}

        {!lorebookLibraryLoading && lorebookFoldersError && (
          <div className="rounded-xl border border-[var(--destructive)]/25 bg-[var(--destructive)]/10 px-3 py-2 text-xs text-[var(--destructive)]">
            <p>Could not load lorebook folders.</p>
            <button
              type="button"
              onClick={() => void refetchLorebookFolders()}
              className="mt-1 rounded-md px-2 py-1 text-[0.625rem] font-medium ring-1 ring-[var(--destructive)]/30 hover:bg-[var(--destructive)]/10"
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty state */}
        {showLorebookEmptyState && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <div className="animate-float flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400/20 to-orange-500/20">
              <BookOpen size="1.25rem" className="text-amber-400" />
            </div>
            <p className="text-xs text-[var(--muted-foreground)]">
              {searchQuery ? "No lorebooks match your search" : "No lorebooks yet"}
            </p>
          </div>
        )}

        {/* Lorebook list */}
        {showLorebookFlatFallback && (
          <div className="stagger-children flex flex-col gap-1">{sorted.map(renderLorebookRow)}</div>
        )}

        {showLorebookList && (
          <div
            data-lorebook-library-root
            onDragOver={(event) => handleLorebookDragOver(event, null)}
            onDragLeave={handleLorebookDragLeave}
            onDrop={(event) => handleLorebookDrop(event, null)}
            className={cn(
              "stagger-children flex min-h-8 flex-col gap-1 rounded-xl transition-colors",
              draggedLorebookId && "p-1",
              lorebookDropTargetId === null && "bg-amber-400/10 ring-1 ring-amber-400/35",
            )}
          >
            {grouped
              ? Array.from(grouped.entries()).map(([category, books]) => {
                  const catMeta =
                    LOREBOOK_PANEL_CATEGORIES.find((c) => c.id === category) ??
                    LOREBOOK_PANEL_CATEGORIES.find((c) => c.id === "uncategorized") ??
                    LOREBOOK_PANEL_CATEGORIES[0];
                  const CatIcon = catMeta.icon;
                  return (
                    <div key={category} className="mb-2">
                      <div className="mb-1 flex items-center gap-1.5 px-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                        <CatIcon size="0.6875rem" />
                        {catMeta.label}
                        <span className="ml-auto text-[0.625rem] font-normal">{books.length}</span>
                      </div>
                      {books.map(renderLorebookRow)}
                    </div>
                  );
                })
              : rootLorebooks.map(renderLorebookRow)}
            {rootLorebooks.length === 0 && draggedLorebookId && (
              <div className="rounded-lg border border-dashed border-[var(--border)] px-2 py-2 text-center text-[0.625rem] text-[var(--muted-foreground)]">
                Drop here to remove folder
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
