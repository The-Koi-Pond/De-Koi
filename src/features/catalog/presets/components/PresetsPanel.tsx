// ──────────────────────────────────────────────
// Panel: Presets (overhauled — search, assign, edit, duplicate)
// ──────────────────────────────────────────────
import { useState, useMemo, useCallback, type DragEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { usePresets, useDeletePreset, useDuplicatePreset, useSetDefaultPreset } from "../hooks/use-presets";
import { useUpdateChat, useUpdateChatMetadata } from "../../chats/index";
import {
  useCustomToolCapabilities,
  useCustomTools,
  useDeleteCustomTool,
  useSetCustomToolEnabled,
  type CustomToolCapabilities,
  type CustomToolRow,
} from "../../agents/index";
import { RegexScriptsSection } from "../../regex-scripts/shell";
import { useChatStore } from "../../../../shared/stores/chat.store";
import { useUIStore } from "../../../../shared/stores/ui.store";
import { exportApi } from "../../../../shared/api/export-api";
import { storageApi } from "../../../../shared/api/storage-api";
import { showConfirmDialog } from "../../../../shared/lib/app-dialogs";
import { ChoiceSelectionModal } from "./ChoiceSelectionModal";
import {
  Plus,
  Download,
  Upload,
  FileText,
  Trash2,
  Check,
  Copy,
  Search,
  Code2,
  Hash,
  Star,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  FolderPlus,
  Pencil,
  ToggleLeft,
  ToggleRight,
  Wrench,
} from "lucide-react";
import { cn } from "../../../../shared/lib/utils";
import { boolish } from "../../../../engine/generation/runtime-records";
import { isRecord, normalizeChoiceSelections, type ChoiceSelections } from "../lib/choice-selections";
import {
  LibraryFolderSelect,
  getNextUnnamedLibraryFolderName,
  useCreateLibraryFolder,
  useDeleteLibraryFolder,
  useLibraryFolders,
  useMoveLibraryItem,
  useUpdateLibraryFolder,
} from "../../library-folders";

type PresetRow = {
  id: string;
  name: string;
  description: string;
  wrapFormat?: string;
  isDefault?: string | boolean;
  author?: string;
  sectionOrder?: string | string[];
  folderId?: string | null;
};

type PresetChoices = ChoiceSelections;

const PRESET_LIBRARY_DRAG_MIME = "application/x-de-koi-preset-id";

function getPresetChoices(metadata: unknown): PresetChoices {
  if (typeof metadata === "string") {
    try {
      return getPresetChoices(JSON.parse(metadata));
    } catch {
      return {};
    }
  }
  return normalizeChoiceSelections(isRecord(metadata) ? metadata.presetChoices : undefined);
}

export function PresetsPanel() {
  const { data: presets, isLoading } = usePresets();
  const { data: customTools } = useCustomTools();
  const { data: customToolCapabilities } = useCustomToolCapabilities();
  const deletePreset = useDeletePreset();
  const duplicatePreset = useDuplicatePreset();
  const setDefaultPreset = useSetDefaultPreset();
  const setCustomToolEnabled = useSetCustomToolEnabled();
  const deleteCustomTool = useDeleteCustomTool();
  const {
    data: presetFolders,
    isLoading: presetFoldersLoading,
    isError: presetFoldersError,
    refetch: refetchPresetFolders,
  } = useLibraryFolders("presets");
  const createPresetFolder = useCreateLibraryFolder("presets");
  const updatePresetFolder = useUpdateLibraryFolder("presets");
  const deletePresetFolder = useDeleteLibraryFolder("presets");
  const movePresetItem = useMoveLibraryItem("presets");
  const openModal = useUIStore((s) => s.openModal);
  const openPresetDetail = useUIStore((s) => s.openPresetDetail);
  const openToolDetail = useUIStore((s) => s.openToolDetail);
  const activeChat = useChatStore((s) => s.activeChat);
  const updateChat = useUpdateChat();
  const updateMetadata = useUpdateChatMetadata();
  const [search, setSearch] = useState("");
  const [choiceModalPresetId, setChoiceModalPresetId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPresetIds, setSelectedPresetIds] = useState<Set<string>>(new Set());
  const [exportingSelected, setExportingSelected] = useState(false);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editFolderName, setEditFolderName] = useState("");
  const [draggedPresetId, setDraggedPresetId] = useState<string | null>(null);
  const [presetDropTargetId, setPresetDropTargetId] = useState<string | null | undefined>(undefined);

  const canAssignToActiveChat = !!activeChat && activeChat.mode !== "conversation";
  const activePresetId = canAssignToActiveChat ? (activeChat?.promptPresetId ?? null) : null;

  const filteredPresets = useMemo(() => {
    if (!presets) return [];
    if (!search.trim()) return presets as unknown as PresetRow[];
    const q = search.toLowerCase();
    return (presets as unknown as PresetRow[]).filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q) ||
        (p.author ?? "").toLowerCase().includes(q),
    );
  }, [presets, search]);

  const presetFolderList = presetFolders ?? [];
  const customToolRows = useMemo(() => (customTools ?? []) as CustomToolRow[], [customTools]);
  const presetLibraryLoading = isLoading || presetFoldersLoading;
  const presetFolderDataReady = !presetFoldersLoading && !presetFoldersError;
  const presetFiltersActive = search.trim().length > 0;

  const presetFolderIds = useMemo(() => new Set(presetFolderList.map((folder) => folder.id)), [presetFolderList]);

  const rootPresets = useMemo(
    () => filteredPresets.filter((preset) => !preset.folderId || !presetFolderIds.has(preset.folderId)),
    [filteredPresets, presetFolderIds],
  );

  const presetsByFolder = useMemo(() => {
    const byFolder = new Map<string, PresetRow[]>();
    for (const folder of presetFolderList) byFolder.set(folder.id, []);
    for (const preset of filteredPresets) {
      if (preset.folderId && byFolder.has(preset.folderId)) {
        byFolder.get(preset.folderId)?.push(preset);
      }
    }
    return byFolder;
  }, [filteredPresets, presetFolderList]);

  const displayedPresetFolders = useMemo(() => {
    if (!presetFiltersActive) return presetFolderList;
    return presetFolderList.filter((folder) => (presetsByFolder.get(folder.id)?.length ?? 0) > 0);
  }, [presetFiltersActive, presetFolderList, presetsByFolder]);

  const selectPreset = async (presetId: string) => {
    if (!activeChat) return;
    if (activeChat.mode === "conversation") {
      toast.error("Prompt presets are not available in conversation mode.");
      return;
    }
    const newId = activePresetId === presetId ? null : presetId;
    const previousId = activePresetId;
    let presetUpdated = false;

    try {
      await updateChat.mutateAsync({ id: activeChat.id, promptPresetId: newId });
      presetUpdated = true;
      await updateMetadata.mutateAsync({ id: activeChat.id, presetChoices: {} });
    } catch (error) {
      if (presetUpdated) {
        try {
          await updateChat.mutateAsync({ id: activeChat.id, promptPresetId: previousId });
        } catch (rollbackError) {
          toast.error("Preset switch needs attention", {
            description:
              rollbackError instanceof Error
                ? `Choices were preserved, but the previous preset could not be restored: ${rollbackError.message}`
                : "Choices were preserved, but the previous preset could not be restored.",
          });
          return;
        }
      }
      toast.error("Failed to change prompt preset", {
        description: error instanceof Error ? error.message : "The current preset and choices were kept.",
      });
      return;
    }

    if (!newId) {
      setChoiceModalPresetId(null);
      return;
    }

    try {
      const choiceBlocks = await storageApi.list("prompt-variables", { filters: { presetId: newId } });
      setChoiceModalPresetId(choiceBlocks.length > 0 ? newId : null);
    } catch {
      setChoiceModalPresetId(null);
    }
  };

  const getSectionCount = (preset: PresetRow) => (Array.isArray(preset.sectionOrder) ? preset.sectionOrder.length : 0);

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedPresetIds(new Set());
  };

  const toggleSelection = (presetId: string) => {
    setSelectedPresetIds((prev) => {
      const next = new Set(prev);
      if (next.has(presetId)) next.delete(presetId);
      else next.add(presetId);
      return next;
    });
  };

  const handleExportSelected = async () => {
    if (selectedPresetIds.size === 0) return;
    setExportingSelected(true);
    try {
      exportApi.triggerDownload(await exportApi.promptsBulk([...selectedPresetIds]));
      toast.success(`Exported ${selectedPresetIds.size} preset${selectedPresetIds.size === 1 ? "" : "s"}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to export presets");
    } finally {
      setExportingSelected(false);
    }
  };

  const handleDeleteSelected = useCallback(async () => {
    const ids = [...selectedPresetIds];
    if (ids.length === 0) return;

    if (
      !(await showConfirmDialog({
        title: "Delete Presets",
        message: `Delete ${ids.length} preset${ids.length === 1 ? "" : "s"}?`,
        confirmLabel: "Delete",
        tone: "destructive",
      }))
    ) {
      return;
    }

    const results = await Promise.allSettled(ids.map((id) => deletePreset.mutateAsync(id)));
    const failedIds = ids.filter((_, index) => results[index]?.status === "rejected");
    const deletedCount = ids.length - failedIds.length;

    if (deletedCount > 0) {
      toast.success(`Deleted ${deletedCount} preset${deletedCount === 1 ? "" : "s"}`);
    }

    if (failedIds.length > 0) {
      setSelectedPresetIds(new Set(failedIds));
      toast.error(`Failed to delete ${failedIds.length} preset${failedIds.length === 1 ? "" : "s"}`);
      return;
    }

    exitSelectionMode();
  }, [selectedPresetIds, deletePreset]);

  const handleCreateFolder = useCallback(() => {
    createPresetFolder.mutate({ name: getNextUnnamedLibraryFolderName(presetFolderList) });
  }, [createPresetFolder, presetFolderList]);

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
      updatePresetFolder.mutate({ id: folderId, name });
      setEditingFolderId(null);
      setEditFolderName("");
    },
    [editFolderName, updatePresetFolder],
  );

  const handleDeleteFolder = useCallback(
    async (folderId: string, name: string) => {
      if (
        !(await showConfirmDialog({
          title: "Delete Folder",
          message: `Delete "${name}"? Presets inside it move back to the main list.`,
          confirmLabel: "Delete",
          tone: "destructive",
        }))
      ) {
        return;
      }
      deletePresetFolder.mutate(folderId);
    },
    [deletePresetFolder],
  );

  const handleToggleFolderCollapsed = useCallback(
    (folderId: string, collapsed: boolean) => {
      updatePresetFolder.mutate({ id: folderId, collapsed });
    },
    [updatePresetFolder],
  );

  const clearPresetDragState = useCallback(() => {
    setDraggedPresetId(null);
    setPresetDropTargetId(undefined);
  }, []);

  const canDragPresets = presetFolderDataReady && presetFolderList.length > 0 && !selectionMode;
  const presetFolderMoveOptions = presetFolderDataReady ? presetFolderList : [];

  const handlePresetDragStart = useCallback(
    (event: DragEvent<HTMLDivElement>, presetId: string) => {
      if (!canDragPresets) {
        event.preventDefault();
        return;
      }
      event.stopPropagation();
      setDraggedPresetId(presetId);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(PRESET_LIBRARY_DRAG_MIME, presetId);
      event.dataTransfer.setData("text/plain", presetId);
    },
    [canDragPresets],
  );

  const handlePresetDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>, folderId: string | null) => {
      if (!draggedPresetId) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      setPresetDropTargetId((current) => (current === folderId ? current : folderId));
    },
    [draggedPresetId],
  );

  const handlePresetDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    const relatedTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (relatedTarget && event.currentTarget.contains(relatedTarget)) return;
    setPresetDropTargetId(undefined);
  }, []);

  const handlePresetDrop = useCallback(
    (event: DragEvent<HTMLDivElement>, folderId: string | null) => {
      event.preventDefault();
      event.stopPropagation();
      const presetId =
        draggedPresetId ||
        event.dataTransfer.getData(PRESET_LIBRARY_DRAG_MIME) ||
        event.dataTransfer.getData("text/plain");
      if (!presetId) {
        clearPresetDragState();
        return;
      }

      const existingFolderId = filteredPresets.find((preset) => preset.id === presetId)?.folderId ?? null;
      const currentFolderId = existingFolderId && presetFolderIds.has(existingFolderId) ? existingFolderId : null;
      if (currentFolderId !== folderId) {
        movePresetItem.mutate({ itemId: presetId, folderId });
      }
      clearPresetDragState();
    },
    [clearPresetDragState, draggedPresetId, filteredPresets, movePresetItem, presetFolderIds],
  );

  const renderPresetRow = (preset: PresetRow) => {
    const isSelected = activePresetId === preset.id;
    const isBulkSelected = selectedPresetIds.has(preset.id);
    const sectionCount = getSectionCount(preset);
    const wrapFormat = (preset.wrapFormat ?? "xml") as string;
    const isDefault = boolish(preset.isDefault ?? (preset as PresetRow & { default?: unknown }).default, false);

    return (
      <div
        key={preset.id}
        draggable={canDragPresets}
        onDragStart={(event) => handlePresetDragStart(event, preset.id)}
        onDragEnd={clearPresetDragState}
        className={cn(
          "group relative flex cursor-pointer items-center gap-3 rounded-xl p-2.5 transition-all hover:bg-[var(--sidebar-accent)]",
          selectionMode && isBulkSelected && "ring-1 ring-purple-400/40 bg-purple-400/10",
          isSelected && "ring-1 ring-purple-400/40 bg-purple-400/5",
          draggedPresetId === preset.id && "opacity-55 ring-1 ring-[var(--primary)]/30",
        )}
      >
        {/* Click to open editor */}
        <div
          className="flex min-w-0 flex-1 items-center gap-3"
          onClick={() => {
            if (selectionMode) toggleSelection(preset.id);
            else openPresetDetail(preset.id);
          }}
        >
          {selectionMode && (
            <div
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors",
                isBulkSelected
                  ? "border-purple-400 bg-purple-400 text-white"
                  : "border-[var(--muted-foreground)]/40 bg-[var(--secondary)] text-transparent",
              )}
            >
              <Check size="0.75rem" />
            </div>
          )}
          <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-purple-400 to-violet-500 text-white shadow-sm">
            <FileText size="1rem" />
            {isSelected && (
              <div className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-purple-400 shadow-sm">
                <Check size="0.625rem" className="text-white" />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium">{preset.name}</span>
              {isDefault && (
                <span className="shrink-0 rounded bg-purple-400/15 px-1 py-0.5 text-[0.5625rem] font-medium text-purple-400">
                  DEFAULT
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-[0.6875rem] text-[var(--muted-foreground)]">
              <span className="flex items-center gap-0.5">
                {wrapFormat === "xml" ? <Code2 size="0.5625rem" /> : <Hash size="0.5625rem" />}
                {wrapFormat.toUpperCase()}
              </span>
              <span>{sectionCount} sections</span>
              {preset.author && <span className="truncate">by {preset.author}</span>}
            </div>
          </div>
        </div>

        {/* Action buttons */}
        {!selectionMode && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex shrink-0 items-center gap-0.5 rounded-lg bg-[var(--sidebar)] px-1 py-0.5 opacity-0 shadow-sm ring-1 ring-[var(--border)] transition-opacity group-hover:opacity-100 max-md:opacity-100">
            <LibraryFolderSelect
              value={preset.folderId}
              folders={presetFolderMoveOptions}
              itemLabel={preset.name}
              disabled={movePresetItem.isPending || !presetFolderDataReady}
              onChange={(folderId) => {
                const currentFolderId =
                  preset.folderId && presetFolderIds.has(preset.folderId) ? preset.folderId : null;
                if (currentFolderId !== folderId) {
                  movePresetItem.mutate({ itemId: preset.id, folderId });
                }
              }}
            />
            {canAssignToActiveChat && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void selectPreset(preset.id);
                }}
                className={cn(
                  "rounded-lg p-1.5 transition-all active:scale-90",
                  isSelected
                    ? "bg-purple-400/15 text-purple-400"
                    : "text-[var(--muted-foreground)] hover:bg-[var(--primary)]/10 hover:text-[var(--primary)]",
                )}
                title={isSelected ? "Unassign from chat" : "Assign to chat"}
              >
                <Check size="0.75rem" />
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setDefaultPreset.mutate(preset.id);
              }}
              className={cn(
                "rounded-lg p-1.5 transition-all active:scale-90",
                isDefault
                  ? "text-yellow-500"
                  : "text-[var(--muted-foreground)] hover:bg-yellow-500/10 hover:text-yellow-500",
              )}
              title={isDefault ? "Default preset" : "Set as default"}
            >
              <Star size="0.75rem" className={isDefault ? "fill-yellow-500" : ""} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                duplicatePreset.mutate(preset.id);
              }}
              className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-all hover:bg-sky-400/10 hover:text-sky-400 active:scale-90"
              title="Duplicate"
            >
              <Copy size="0.75rem" />
            </button>
            <button
              onClick={async (e) => {
                e.stopPropagation();
                if (
                  await showConfirmDialog({
                    title: "Delete Preset",
                    message: `Delete "${preset.name}"?`,
                    confirmLabel: "Delete",
                    tone: "destructive",
                  })
                ) {
                  deletePreset.mutate(preset.id);
                }
              }}
              className="rounded-lg p-1.5 transition-all hover:bg-[var(--destructive)]/15 active:scale-90"
              title="Delete"
            >
              <Trash2 size="0.75rem" className="text-[var(--destructive)]" />
            </button>
          </div>
        )}
      </div>
    );
  };

  const showPresetEmptyState =
    !presetLibraryLoading &&
    filteredPresets.length === 0 &&
    (presetFoldersError || presetFiltersActive || displayedPresetFolders.length === 0);
  const showPresetList =
    !presetLibraryLoading && !presetFoldersError && (filteredPresets.length > 0 || displayedPresetFolders.length > 0);
  const showPresetFlatFallback = !presetLibraryLoading && presetFoldersError && filteredPresets.length > 0;

  return (
    <div className="flex flex-col gap-2 p-3">
      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => openModal("create-preset")}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-purple-400 to-violet-500 px-3 py-2.5 text-xs font-medium text-white shadow-md shadow-purple-400/15 transition-all hover:shadow-lg hover:shadow-purple-400/25 active:scale-[0.98]"
          title="New"
        >
          <Plus size="0.8125rem" /> <span className="md:hidden">New</span>
        </button>
        <button
          onClick={() => openModal("import-preset")}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-xs font-medium text-[var(--secondary-foreground)] ring-1 ring-[var(--border)] transition-all hover:bg-[var(--accent)] active:scale-[0.98]"
          title="Import"
        >
          <Download size="0.8125rem" /> <span className="md:hidden">Import</span>
        </button>
        <button
          onClick={() => {
            if (selectionMode) exitSelectionMode();
            else setSelectionMode(true);
          }}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-medium transition-all",
            selectionMode
              ? "bg-purple-400/15 text-purple-400 ring-1 ring-purple-400/30"
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
            {selectedPresetIds.size} selected
          </span>
          <button
            onClick={() => setSelectedPresetIds(new Set(filteredPresets.map((preset) => preset.id)))}
            disabled={filteredPresets.length === 0}
            className="rounded-lg px-2.5 py-1 text-[0.625rem] font-medium text-purple-400 transition-colors hover:bg-[var(--accent)] disabled:opacity-40"
          >
            Select visible
          </button>
          <button
            onClick={() => setSelectedPresetIds(new Set())}
            disabled={selectedPresetIds.size === 0}
            className="rounded-lg px-2.5 py-1 text-[0.625rem] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-40"
          >
            Clear
          </button>
          <button
            onClick={handleDeleteSelected}
            disabled={selectedPresetIds.size === 0}
            className="inline-flex items-center gap-1 rounded-lg bg-[var(--destructive)]/12 px-2.5 py-1 text-[0.625rem] font-medium text-[var(--destructive)] transition-all hover:bg-[var(--destructive)]/20 disabled:opacity-40"
          >
            <Trash2 size="0.6875rem" />
            Delete
          </button>
          <button
            onClick={handleExportSelected}
            disabled={selectedPresetIds.size === 0 || exportingSelected}
            className="inline-flex items-center gap-1 rounded-lg bg-purple-500 px-2.5 py-1 text-[0.625rem] font-medium text-white transition-all hover:opacity-90 disabled:opacity-40"
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

      {/* Search */}
      <div className="relative">
        <Search
          size="0.8125rem"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
        />
        <input
          type="text"
          placeholder="Search presets…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl bg-[var(--secondary)] py-2 pl-8 pr-3 text-xs text-[var(--foreground)] ring-1 ring-[var(--border)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
        />
      </div>

      {!presetLibraryLoading && !presetFoldersError && (
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
      {presetLibraryLoading && (
        <div className="flex flex-col gap-2 py-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="shimmer h-16 rounded-xl" />
          ))}
        </div>
      )}

      {!presetLibraryLoading && presetFoldersError && (
        <div className="rounded-xl border border-[var(--destructive)]/25 bg-[var(--destructive)]/10 px-3 py-2 text-xs text-[var(--destructive)]">
          <p>Could not load preset folders.</p>
          <button
            type="button"
            onClick={() => void refetchPresetFolders()}
            className="mt-1 rounded-md px-2 py-1 text-[0.625rem] font-medium ring-1 ring-[var(--destructive)]/30 hover:bg-[var(--destructive)]/10"
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty state */}
      {showPresetEmptyState && (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <div className="animate-float flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-400/20 to-violet-500/20">
            <FileText size="1.25rem" className="text-purple-400" />
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">{search ? "No matching presets" : "No presets yet"}</p>
        </div>
      )}

      {/* Preset list */}
      {showPresetFlatFallback && (
        <div className="stagger-children flex flex-col gap-1">{filteredPresets.map(renderPresetRow)}</div>
      )}

      {showPresetList && (
        <div className="flex flex-col gap-1">
          {displayedPresetFolders.map((folder) => {
            const folderPresets = presetsByFolder.get(folder.id) ?? [];
            const isExpanded = !folder.collapsed;
            const isDropTarget = presetDropTargetId === folder.id;
            return (
              <div
                key={folder.id}
                data-preset-library-folder-id={folder.id}
                onDragOver={(event) => handlePresetDragOver(event, folder.id)}
                onDragLeave={handlePresetDragLeave}
                onDrop={(event) => handlePresetDrop(event, folder.id)}
                className={cn(
                  "rounded-xl border border-transparent bg-[var(--secondary)]/35 transition-colors",
                  isDropTarget && "border-purple-400/35 bg-purple-400/10",
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
                  <FolderOpen size="0.875rem" className="shrink-0 text-purple-400" />
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
                      className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-purple-400/50"
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
                    {folderPresets.length}
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
                    {folderPresets.length > 0 ? (
                      folderPresets.map(renderPresetRow)
                    ) : (
                      <div className="rounded-lg border border-dashed border-[var(--border)] px-2 py-2 text-center text-[0.625rem] text-[var(--muted-foreground)]">
                        Drop presets here
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <div
            data-preset-library-root
            onDragOver={(event) => handlePresetDragOver(event, null)}
            onDragLeave={handlePresetDragLeave}
            onDrop={(event) => handlePresetDrop(event, null)}
            className={cn(
              "stagger-children flex min-h-8 flex-col gap-1 rounded-xl transition-colors",
              draggedPresetId && "p-1",
              presetDropTargetId === null && "bg-purple-400/10 ring-1 ring-purple-400/35",
            )}
          >
            {rootPresets.map(renderPresetRow)}
            {rootPresets.length === 0 && draggedPresetId && (
              <div className="rounded-lg border border-dashed border-[var(--border)] px-2 py-2 text-center text-[0.625rem] text-[var(--muted-foreground)]">
                Drop here to remove folder
              </div>
            )}
          </div>
        </div>
      )}

      {activeChat && !selectionMode && (
        <p className="px-1 text-[0.625rem] text-[var(--muted-foreground)]/60">
          {canAssignToActiveChat
            ? 'Click a preset to edit · hover → "Use" to assign to chat'
            : "Click a preset to edit"}
        </p>
      )}

      <RegexScriptsSection title="Regexes" className="mt-1" />

      <FunctionsSection
        customToolRows={customToolRows}
        customToolCapabilities={customToolCapabilities}
        openToolDetail={openToolDetail}
        setCustomToolEnabled={setCustomToolEnabled}
        deleteCustomTool={deleteCustomTool}
      />

      {/* Choice selection modal */}
      {activeChat && (
        <ChoiceSelectionModal
          open={!!choiceModalPresetId}
          onClose={() => setChoiceModalPresetId(null)}
          presetId={choiceModalPresetId}
          chatId={activeChat.id}
          existingChoices={getPresetChoices(activeChat.metadata)}
        />
      )}
    </div>
  );
}

function FunctionsSection({
  customToolRows,
  customToolCapabilities,
  openToolDetail,
  setCustomToolEnabled,
  deleteCustomTool,
}: {
  customToolRows: CustomToolRow[];
  customToolCapabilities?: CustomToolCapabilities;
  openToolDetail: (id: string) => void;
  setCustomToolEnabled: ReturnType<typeof useSetCustomToolEnabled>;
  deleteCustomTool: ReturnType<typeof useDeleteCustomTool>;
}) {
  return (
    <PanelSection
      title="Functions"
      icon={<Wrench size="0.8125rem" />}
      action={
        <button
          type="button"
          onClick={() => openToolDetail("__new__")}
          className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--primary)]"
          title="Create function"
        >
          <Plus size="0.8125rem" />
        </button>
      }
    >
      <div className="mb-1.5 text-[0.625rem] text-[var(--muted-foreground)]">
        Custom function calls available from Chat Settings.
      </div>
      {customToolRows.length === 0 ? (
        <p className="px-1 py-2 text-[0.625rem] text-[var(--muted-foreground)]">No functions yet.</p>
      ) : (
        customToolRows.map((tool) => {
          const pendingEnabled = setCustomToolEnabled.pendingEnabledById.get(tool.id);
          const enabled = pendingEnabled ?? boolish(tool.enabled, false);
          const togglePending = setCustomToolEnabled.pendingEnabledById.has(tool.id);
          const scriptUnavailable =
            tool.executionType === "script" && customToolCapabilities?.scriptExecutionEnabled === false;
          const parameterCount = getFunctionParameterCount(tool.parametersSchema);

          return (
            <div
              key={tool.id}
              className={cn(
                "flex items-start gap-2.5 rounded-lg p-2 transition-colors hover:bg-[var(--sidebar-accent)]",
                !enabled && "opacity-50",
              )}
            >
              <Wrench size="0.875rem" className="mt-0.5 shrink-0 text-purple-400" />
              <button className="min-w-0 flex-1 text-left" onClick={() => openToolDetail(tool.id)}>
                <div className="truncate font-mono text-xs font-medium">{tool.name}</div>
                <div className="mt-0.5 flex min-w-0 items-center gap-1">
                  <span className="rounded bg-[var(--secondary)] px-1 py-0.5 text-[0.5rem] text-[var(--muted-foreground)]">
                    {formatFunctionExecutionType(tool.executionType)}
                  </span>
                  <span className="rounded bg-[var(--secondary)] px-1 py-0.5 text-[0.5rem] text-[var(--muted-foreground)]">
                    {parameterCount} param{parameterCount === 1 ? "" : "s"}
                  </span>
                  {scriptUnavailable && (
                    <span className="rounded bg-amber-500/10 px-1 py-0.5 text-[0.5rem] text-amber-400">
                      Script disabled
                    </span>
                  )}
                </div>
                <div className="mt-0.5 truncate text-[0.5625rem] text-[var(--muted-foreground)]">
                  {tool.description || "No description"}
                </div>
              </button>
              <button
                className="mt-0.5 shrink-0 text-[var(--muted-foreground)] transition-colors hover:text-[var(--primary)] disabled:cursor-wait disabled:opacity-60"
                title={togglePending ? "Saving function state…" : enabled ? "Disable function" : "Enable function"}
                disabled={togglePending}
                aria-busy={togglePending}
                onClick={(event) => {
                  event.stopPropagation();
                  setCustomToolEnabled.setEnabled({ id: tool.id, enabled: !enabled });
                }}
              >
                {enabled ? <ToggleRight size="0.875rem" className="text-purple-400" /> : <ToggleLeft size="0.875rem" />}
              </button>
              <button
                className="mt-0.5 shrink-0 text-[var(--muted-foreground)] transition-colors hover:text-[var(--primary)]"
                title="Edit function"
                onClick={() => openToolDetail(tool.id)}
              >
                <Pencil size="0.8125rem" />
              </button>
              <button
                className="mt-0.5 shrink-0 text-[var(--muted-foreground)] transition-colors hover:text-[var(--destructive)]"
                title="Delete function"
                onClick={async () => {
                  if (
                    await showConfirmDialog({
                      title: "Delete Function",
                      message: `Delete "${tool.name}"?`,
                      confirmLabel: "Delete",
                      tone: "destructive",
                    })
                  ) {
                    deleteCustomTool.mutate(tool.id);
                  }
                }}
              >
                <Trash2 size="0.8125rem" />
              </button>
            </div>
          );
        })
      )}
    </PanelSection>
  );
}

function formatFunctionExecutionType(executionType: string) {
  if (executionType === "webhook") return "Webhook";
  if (executionType === "script") return "Script";
  return "Static";
}

function getFunctionParameterCount(parametersSchema: Record<string, unknown> | string | null | undefined) {
  const schema = parseFunctionParametersSchema(parametersSchema);
  const properties = schema.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return 0;
  return Object.keys(properties).length;
}

function parseFunctionParametersSchema(
  parametersSchema: Record<string, unknown> | string | null | undefined,
): Record<string, unknown> {
  if (!parametersSchema) return {};
  if (typeof parametersSchema === "string") {
    try {
      const parsed = JSON.parse(parametersSchema);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return parametersSchema;
}

function PanelSection({
  title,
  icon,
  action,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon: ReactNode;
  action?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="mb-1 border-b border-[var(--border)] pb-1 last:border-b-0">
      <div className="flex items-center gap-1.5 px-1 py-1.5">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex flex-1 items-center gap-1.5 text-left">
          <span className="text-[var(--muted-foreground)]">{icon}</span>
          <span className="text-[0.6875rem] font-semibold">{title}</span>
          <ChevronDown
            size="0.6875rem"
            className={cn("text-[var(--muted-foreground)] transition-transform", open && "rotate-180")}
          />
        </button>
        {action}
      </div>
      {open && <div className="px-0.5">{children}</div>}
    </div>
  );
}
