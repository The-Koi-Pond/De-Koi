// ──────────────────────────────────────────────
// Panel: Lorebooks (overhauled)
// Category tabs, search, click-to-edit, AI generate
// ──────────────────────────────────────────────
import { useRef, useState, useMemo, useCallback, type ChangeEvent, type DragEvent } from "react";
import { toast } from "sonner";
import {
  Plus,
  Download,
  Check,
  Sparkles,
  BookOpen,
  Search,
  ArrowUpDown,
  Tag,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FolderOpen,
  FolderPlus,
  Pencil,
  X,
  Trash2,
} from "lucide-react";
import { useUIStore } from "../../../../../shared/stores/ui.store";
import { useChatStore } from "../../../../../shared/stores/chat.store";
import { useLorebooks, useDeleteLorebook, useUpdateLorebook, useUploadLorebookImage } from "../../hooks/use-lorebooks";
import { useCharacterSummariesByIds } from "../../../characters/index";
import { usePersonaSummaries } from "../../../personas/index";
import type { Lorebook } from "../../../../../engine/contracts/types/lorebook";
import { resolveGameLorebookScopeExclusions } from "../../../../../engine/generation-core/lorebooks/game-lorebook-scope";
import { showConfirmDialog } from "../../../../../shared/lib/app-dialogs";
import { cn } from "../../../../../shared/lib/utils";
import { exportApi } from "../../../../../shared/api/export-api";
import { getChatCharacterIds } from "../../../../../shared/lib/chat-macros";
import { parseChatMetadata } from "../../../../../shared/lib/chat-display";
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
  type LorebookPanelSort,
} from "./lorebook-panel-model";
import { LOREBOOK_PANEL_CATEGORIES, type LorebookPanelCategory } from "./lorebook-panel-config";

const LOREBOOK_LIBRARY_DRAG_MIME = "application/x-de-koi-lorebook-id";

export function LorebooksPanel() {
  const [activeCategory, setActiveCategory] = useState<LorebookPanelCategory>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sort, setSort] = useState<LorebookPanelSort>("name-asc");
  const [activeTag, setActiveTag] = useState<string | null>(null);
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
      scopeExclusions: resolveGameLorebookScopeExclusions(activeChat?.mode, parseChatMetadata(activeChat?.metadata)),
    }),
    [activeChat, activeCharacterIds],
  );

  // When "active" category is selected, fetch all lorebooks (no category filter) — we filter client-side
  const { data: lorebooks, isLoading } = useLorebooks(
    activeCategory === "active" || activeCategory === "all" ? undefined : activeCategory,
  );
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
        if (activeTag === tag) setActiveTag(null);
      } catch {
        toast.error("Failed to remove tag from some lorebooks");
      }
    },
    [lorebooks, updateLorebook, activeTag],
  );

  // Filter by search
  const filtered = useMemo(() => {
    if (!lorebooks) return [];
    return filterLorebooksForPanel({
      lorebooks: lorebooks as Lorebook[],
      activeCategory,
      activeScopeContext: activeLorebookScopeContext,
      activeTag,
      searchQuery,
      getCharacterNames,
      getPersonaNames,
    });
  }, [
    lorebooks,
    activeCategory,
    activeLorebookScopeContext,
    searchQuery,
    activeTag,
    getCharacterNames,
    getPersonaNames,
  ]);

  const sorted = useMemo(() => {
    return sortLorebooksForPanel(filtered, sort);
  }, [filtered, sort]);

  const lorebookFolderList = lorebookFolders ?? [];
  const lorebookLibraryLoading = isLoading || lorebookFoldersLoading;
  const lorebookFolderDataReady = !lorebookFoldersLoading && !lorebookFoldersError;
  const lorebookFiltersActive = activeCategory !== "all" || activeTag !== null || searchQuery.trim().length > 0;

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
    if (activeCategory !== "all") return null;
    return groupLorebooksByCategory(rootLorebooks);
  }, [rootLorebooks, activeCategory]);

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
        toast.error(error instanceof Error ? error.message : "Failed to export lorebooks");
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
      toast.error(`Failed to delete ${failedIds.length} lorebook${failedIds.length === 1 ? "" : "s"}`);
      return;
    }

    exitSelectionMode();
  }, [selectedLorebookIds, deleteLorebook, exitSelectionMode]);

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
          toast.error("Could not read that image");
          return;
        }

        try {
          await uploadLorebookImage.mutateAsync({ id: lorebookId, image, filename: file.name });
          toast.success("Lorebook picture updated");
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Failed to upload lorebook picture");
        } finally {
          imageTargetLorebookIdRef.current = null;
        }
      };
      reader.onerror = () => {
        imageTargetLorebookIdRef.current = null;
        toast.error("Could not read that image");
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
          folderOptions={lorebookFolderMoveOptions}
          folderMoveDisabled={moveLorebookItem.isPending || !lorebookFolderDataReady}
          onMoveToFolder={(folderId) => {
            const currentFolderId = lb.folderId && lorebookFolderIds.has(lb.folderId) ? lb.folderId : null;
            if (currentFolderId !== folderId) {
              moveLorebookItem.mutate({ itemId: lb.id, folderId });
            }
          }}
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
      handleLorebookDragStart,
      handlePickLorebookImage,
      lorebookFolderIds,
      lorebookFolderDataReady,
      moveLorebookItem,
      lorebookFolderMoveOptions,
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
    !lorebookLibraryLoading &&
    !lorebookFoldersError &&
    (sorted.length > 0 || displayedLorebookFolders.length > 0);
  const showLorebookFlatFallback = !lorebookLibraryLoading && lorebookFoldersError && sorted.length > 0;

  return (
    <div className="flex flex-col gap-2 p-3">
      <input
        ref={lorebookImageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleLorebookImageSelected}
      />

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => openModal("create-lorebook")}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 px-3 py-2.5 text-xs font-medium text-white shadow-md shadow-amber-400/15 transition-all hover:shadow-lg hover:shadow-amber-400/25 active:scale-[0.98]"
          title="New"
        >
          <Plus size="0.8125rem" /> <span className="md:hidden">New</span>
        </button>
        <button
          onClick={() => openModal("import-lorebook")}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-xs font-medium text-[var(--secondary-foreground)] ring-1 ring-[var(--border)] transition-all hover:bg-[var(--accent)] active:scale-[0.98]"
          title="Import"
        >
          <Download size="0.8125rem" /> <span className="md:hidden">Import</span>
        </button>
        <button
          onClick={() => openModal("lorebook-maker")}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-xs font-medium text-[var(--secondary-foreground)] ring-1 ring-[var(--border)] transition-all hover:bg-[var(--accent)] active:scale-[0.98]"
          title="AI Maker"
        >
          <Sparkles size="0.8125rem" /> <span className="md:hidden">Maker</span>
        </button>
        <button
          onClick={() => {
            if (selectionMode) exitSelectionMode();
            else setSelectionMode(true);
          }}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-medium transition-all",
            selectionMode
              ? "bg-amber-400/15 text-amber-400 ring-1 ring-amber-400/30"
              : "bg-[var(--secondary)] text-[var(--secondary-foreground)] ring-1 ring-[var(--border)] hover:bg-[var(--accent)]",
          )}
          title="Select"
        >
          <Check size="0.8125rem" /> <span className="md:hidden">Select</span>
        </button>
      </div>

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
            <Download size="0.6875rem" />
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

      {/* Search + Sort */}
      <div className="flex gap-1.5">
        <div className="relative flex-1">
          <Search
            size="0.8125rem"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
          />
          <input
            type="text"
            placeholder="Search lorebooks"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl bg-[var(--secondary)] py-2 pl-8 pr-3 text-xs text-[var(--foreground)] ring-1 ring-[var(--border)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
          />
        </div>
        <div className="relative">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="h-full appearance-none rounded-xl border border-[var(--border)] bg-[var(--secondary)] py-2 pl-2.5 pr-7 text-[0.6875rem] outline-none transition-colors focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
            title="Sort order"
          >
            <option value="name-asc">A-Z</option>
            <option value="name-desc">Z-A</option>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="tokens">Token Budget</option>
          </select>
          <ArrowUpDown
            size="0.625rem"
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
          />
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex flex-wrap gap-1">
        {LOREBOOK_PANEL_CATEGORIES.map((cat) => {
          const Icon = cat.icon;
          const isActive = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={cn(
                "flex items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[0.6875rem] font-medium transition-all",
                isActive
                  ? "bg-[var(--accent)] text-[var(--accent-foreground)] shadow-sm"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)]",
              )}
            >
              <Icon size="0.75rem" />
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* Tag filter */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <button
            onClick={() => setTagsExpanded(!tagsExpanded)}
            className="flex items-center gap-1 rounded-lg px-1.5 py-1 text-[0.625rem] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
            title={tagsExpanded ? "Collapse tags" : "Expand tags"}
          >
            <Tag size="0.6875rem" />
            {tagsExpanded ? <ChevronUp size="0.625rem" /> : <ChevronDown size="0.625rem" />}
          </button>
          {(tagsExpanded ? allTags : allTags.slice(0, 5)).map((tag) => (
            <div
              key={tag}
              role="button"
              tabIndex={0}
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setActiveTag(activeTag === tag ? null : tag);
                }
              }}
              className={cn(
                "group/tag flex items-center gap-1 rounded-lg px-2 py-1 text-[0.625rem] font-medium transition-all cursor-pointer",
                activeTag === tag
                  ? "bg-amber-400/15 text-amber-400 ring-1 ring-amber-400/30"
                  : "bg-[var(--secondary)] text-[var(--muted-foreground)] ring-1 ring-[var(--border)] hover:text-[var(--foreground)]",
              )}
            >
              {tag}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteTag(tag);
                }}
                className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-[var(--destructive)]/20 hover:text-[var(--destructive)]"
                title={`Delete tag "${tag}"`}
              >
                <X size="0.5rem" />
              </button>
            </div>
          ))}
          {!tagsExpanded && allTags.length > 5 && (
            <button
              onClick={() => setTagsExpanded(true)}
              className="rounded-lg px-2 py-1 text-[0.625rem] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
            >
              +{allTags.length - 5} more
            </button>
          )}
        </div>
      )}

      {!lorebookLibraryLoading && !lorebookFoldersError && (
        <button
          type="button"
          onClick={handleCreateFolder}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--secondary)]/70 px-2.5 py-1.5 text-[0.6875rem] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
          title="New folder"
        >
          <FolderPlus size="0.75rem" />
          New folder
        </button>
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
      {showLorebookFlatFallback && <div className="stagger-children flex flex-col gap-1">{sorted.map(renderLorebookRow)}</div>}

      {showLorebookList && (
        <div className="flex flex-col gap-1">
          {displayedLorebookFolders.map((folder) => {
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
          })}

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
            {activeCategory === "all" && grouped
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
        </div>
      )}
    </div>
  );
}
