// ──────────────────────────────────────────────
// Panel: API Connections (polished, with folders)
// ──────────────────────────────────────────────
import { useCallback, useState, useEffect, useMemo, useRef, type ChangeEvent, type DragEvent } from "react";
import { toast } from "sonner";
import { Reorder, useDragControls } from "framer-motion";
import {
  isSyntheticConnection,
  useConnections,
  useDuplicateConnection,
  useDeleteConnection,
  useUploadConnectionImage,
  useUpdateConnection,
} from "../../../catalog/connections";
import {
  useConnectionFolders,
  useCreateConnectionFolder,
  useUpdateConnectionFolder,
  useDeleteConnectionFolder,
  useReorderConnectionFolders,
  useMoveConnection,
} from "../../../catalog/connections";
import { useChatStore } from "../../../../shared/stores/chat.store";
import { useUIStore } from "../../../../shared/stores/ui.store";
import type { ConnectionFolder } from "../../../../engine/contracts/types/connection";
import { showConfirmDialog } from "../../../../shared/lib/app-dialogs";
import { Modal } from "../../../../shared/components/ui/Modal";
import { LocalSidecarCard } from "./LocalSidecarCard";
import {
  Plus,
  Trash2,
  Link,
  Camera,
  Check,
  Shuffle,
  ExternalLink,
  X,
  Copy,
  ChevronRight,
  FolderPlus,
  FolderOpen,
  GripVertical,
  Pencil,
  Settings2,
  Sparkles,
  ImageIcon,
} from "lucide-react";
import { cn } from "../../../../shared/lib/utils";
import { resolveEntityImageUrl } from "../../../../shared/api/local-file-api";
import { boolish } from "../../../../engine/generation/runtime-records";
import { TTSConfigCard } from "../../../shell/settings/index";

/** Provider → gradient color pair for connection icons. */
const PROVIDER_COLORS: Record<string, { from: string; to: string; ring: string; badge: string }> = {
  openai: { from: "from-emerald-400", to: "to-teal-500", ring: "ring-emerald-400/40", badge: "bg-emerald-400" },
  anthropic: { from: "from-orange-400", to: "to-amber-500", ring: "ring-orange-400/40", badge: "bg-orange-400" },
  google: { from: "from-blue-400", to: "to-indigo-500", ring: "ring-blue-400/40", badge: "bg-blue-400" },
  mistral: { from: "from-violet-400", to: "to-purple-500", ring: "ring-violet-400/40", badge: "bg-violet-400" },
  cohere: { from: "from-rose-400", to: "to-pink-500", ring: "ring-rose-400/40", badge: "bg-rose-400" },
  openrouter: { from: "from-sky-400", to: "to-cyan-500", ring: "ring-sky-400/40", badge: "bg-sky-400" },
  xai: { from: "from-neutral-300", to: "to-zinc-600", ring: "ring-zinc-300/40", badge: "bg-zinc-300" },
  custom: { from: "from-gray-400", to: "to-slate-500", ring: "ring-gray-400/40", badge: "bg-gray-400" },
  image_generation: {
    from: "from-fuchsia-400",
    to: "to-pink-500",
    ring: "ring-fuchsia-400/40",
    badge: "bg-fuchsia-400",
  },
};
const DEFAULT_COLOR = { from: "from-sky-400", to: "to-blue-500", ring: "ring-sky-400/40", badge: "bg-sky-400" };

type ConnectionRowData = {
  id: string;
  name: string;
  provider: string;
  model: string;
  imagePath?: string | null;
  imageFilename?: string | null;
  useForRandom?: string | boolean | null;
  defaultForAgents?: string | boolean | null;
  folderId?: string | null;
};

type ConnectionDropTarget = { folderId: string | null } | null;

const CONNECTION_DRAG_MIME = "application/x-de-koi-connection-id";

export function DefaultAgentConnectionCard({ connectionsList }: { connectionsList: ConnectionRowData[] }) {
  const openConnectionDetail = useUIStore((s) => s.openConnectionDetail);
  const defaultConnection =
    connectionsList.find((conn) => conn.provider !== "image_generation" && boolish(conn.defaultForAgents, false)) ??
    null;

  return (
    <div className="rounded-xl border border-sky-400/20 bg-gradient-to-br from-sky-400/5 to-blue-500/5 p-3">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-blue-500 text-white shadow-sm">
          <Sparkles size="1rem" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Default for Agents</div>
          <div className="truncate text-[0.6875rem] text-[var(--muted-foreground)]">
            {defaultConnection
              ? `${defaultConnection.name} • ${defaultConnection.model || "No model set"}`
              : "No default agent connection set"}
          </div>
        </div>
        {defaultConnection && (
          <button
            type="button"
            onClick={() => openConnectionDetail(defaultConnection.id)}
            className="rounded-lg p-1.5 text-sky-400 transition-all hover:bg-sky-400/15 active:scale-90"
            title="Open default agent connection"
          >
            <Settings2 size="0.8125rem" />
          </button>
        )}
      </div>
      <p className="mt-2 text-[0.625rem] leading-relaxed text-[var(--muted-foreground)]">
        Choose a text connection below, then enable <strong>Use as default agent connection</strong> in its editor.
      </p>
    </div>
  );
}

function DefaultIllustratorConnectionCard({ connectionsList }: { connectionsList: ConnectionRowData[] }) {
  const openConnectionDetail = useUIStore((s) => s.openConnectionDetail);
  const defaultConnection =
    connectionsList.find((conn) => conn.provider === "image_generation" && boolish(conn.defaultForAgents, false)) ??
    null;

  return (
    <div className="rounded-xl border border-fuchsia-400/20 bg-gradient-to-br from-fuchsia-400/5 to-pink-500/5 p-3">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-fuchsia-400 to-pink-500 text-white shadow-sm">
          <ImageIcon size="1rem" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Default for Illustrator</div>
          <div className="truncate text-[0.6875rem] text-[var(--muted-foreground)]">
            {defaultConnection
              ? `${defaultConnection.name} • ${defaultConnection.model || "Image generation"}`
              : "No default Illustrator connection set"}
          </div>
        </div>
        {defaultConnection && (
          <button
            type="button"
            onClick={() => openConnectionDetail(defaultConnection.id)}
            className="rounded-lg p-1.5 text-fuchsia-400 transition-all hover:bg-fuchsia-400/15 active:scale-90"
            title="Open default Illustrator connection"
          >
            <Settings2 size="0.8125rem" />
          </button>
        )}
      </div>
    </div>
  );
}

function getNextUnnamedConnectionFolderName(folders: ConnectionFolder[]): string {
  const names = new Set(folders.map((folder) => folder.name.trim().toLowerCase()).filter(Boolean));
  if (!names.has("new folder")) return "New Folder";
  let index = 2;
  while (names.has(`new folder ${index}`)) index += 1;
  return `New Folder ${index}`;
}

function ConnectionRow({
  conn,
  isSelected,
  isDragging,
  onClickRow,
  onMove,
  onImagePick,
  onConnectionDragStart,
  onConnectionDragEnd,
  showMoveButton,
}: {
  conn: ConnectionRowData;
  isSelected: boolean;
  isDragging: boolean;
  onClickRow: () => void;
  onMove: () => void;
  onImagePick: () => void;
  onConnectionDragStart: (event: DragEvent<HTMLDivElement>, connectionId: string) => void;
  onConnectionDragEnd: () => void;
  showMoveButton: boolean;
}) {
  const duplicateConnection = useDuplicateConnection();
  const deleteConnection = useDeleteConnection();
  const updateConnection = useUpdateConnection();
  const openConnectionDetail = useUIStore((s) => s.openConnectionDetail);

  const inRandomPool = boolish(conn.useForRandom, false);
  const colors = PROVIDER_COLORS[conn.provider] ?? DEFAULT_COLOR;
  const [resolvedImagePath, setResolvedImagePath] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResolvedImagePath(null);
    if (!conn.imagePath && !conn.imageFilename) return;
    resolveEntityImageUrl("connections", conn.imagePath, conn.imageFilename)
      .then((url) => {
        if (!cancelled) setResolvedImagePath(url);
      })
      .catch(() => {
        if (!cancelled) setResolvedImagePath(null);
      });
    return () => {
      cancelled = true;
    };
  }, [conn.imageFilename, conn.imagePath]);

  return (
    <div
      draggable={showMoveButton}
      onDragStart={(event) => onConnectionDragStart(event, conn.id)}
      onDragEnd={onConnectionDragEnd}
      onClick={onClickRow}
      className={cn(
        "group relative flex cursor-pointer items-center gap-3 rounded-xl p-2.5 transition-colors hover:bg-[var(--sidebar-accent)]",
        isSelected && `ring-1 ${colors.ring} bg-[var(--sidebar-accent)]/50`,
        isDragging && "opacity-55 ring-1 ring-[var(--primary)]/30",
      )}
    >
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onImagePick();
        }}
        className={cn(
          "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-sm transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-sky-400/50",
          resolvedImagePath ? "bg-[var(--muted)]" : "bg-gradient-to-br",
          !resolvedImagePath && colors.from,
          !resolvedImagePath && colors.to,
        )}
        title={conn.imagePath ? "Replace connection picture" : "Upload connection picture"}
        aria-label={conn.imagePath ? "Replace connection picture" : "Upload connection picture"}
      >
        <span className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-xl">
          {resolvedImagePath ? (
            <img src={resolvedImagePath} alt="" className="h-full w-full object-cover" draggable={false} />
          ) : (
            <Link size="1rem" />
          )}
          <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
            <Camera size="0.875rem" />
          </span>
        </span>
        {isSelected && (
          <div
            className={cn(
              "absolute -right-1 -top-1 z-10 flex h-4 w-4 items-center justify-center rounded-full shadow-sm ring-1 ring-[var(--background)]",
              colors.badge,
            )}
          >
            <Check size="0.625rem" className="text-white" />
          </div>
        )}
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium" title={conn.name}>
          {conn.name}
        </div>
        <div className="truncate text-[0.6875rem] text-[var(--muted-foreground)]">
          {conn.provider} • {conn.model || "No model set"}
        </div>
      </div>
      <div
        data-de-koi-action-group="connection"
        className="absolute right-2 top-1/2 -translate-y-1/2 flex shrink-0 items-center gap-0.5 rounded-lg bg-[var(--sidebar)] px-1 py-0.5 opacity-0 shadow-sm ring-1 ring-[var(--border)] transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100"
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            updateConnection.mutate({ id: conn.id, useForRandom: !inRandomPool });
          }}
          className={cn(
            "rounded-lg p-1.5 transition-all active:scale-90",
            inRandomPool
              ? "bg-amber-400/15 text-amber-400"
              : "text-[var(--muted-foreground)] hover:bg-amber-400/10 hover:text-amber-400",
          )}
          title={inRandomPool ? "In random pool (click to remove)" : "Add to random pool"}
        >
          <Shuffle size="0.75rem" />
        </button>
        {showMoveButton && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMove();
            }}
            className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-all hover:bg-[var(--accent)] hover:text-[var(--foreground)] active:scale-90"
            title="Move to folder"
          >
            <FolderOpen size="0.75rem" />
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            duplicateConnection.mutate(conn.id, {
              onSuccess: (data) => {
                if (data?.id) openConnectionDetail(data.id);
              },
            });
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
              !(await showConfirmDialog({
                title: "Delete Connection",
                message: `Delete "${conn.name}"? This cannot be undone.`,
                confirmLabel: "Delete",
                tone: "destructive",
              }))
            ) {
              return;
            }
            deleteConnection.mutate(conn.id);
          }}
          className="rounded-lg p-1.5 transition-all hover:bg-[var(--destructive)]/15 active:scale-90"
          title="Delete"
        >
          <Trash2 size="0.75rem" className="text-[var(--destructive)]" />
        </button>
      </div>
    </div>
  );
}

export function ConnectionFolderRow({
  folder,
  entries,
  renderConnectionRow,
  isDropTarget,
  draggedConnectionId,
  onToggleCollapse,
  onRename,
  onDelete,
  onConnectionDragOver,
  onConnectionDragLeave,
  onConnectionDrop,
}: {
  folder: ConnectionFolder;
  entries: ConnectionRowData[];
  renderConnectionRow: (conn: ConnectionRowData) => React.ReactNode;
  isDropTarget: boolean;
  draggedConnectionId: string | null;
  onToggleCollapse: (folder: ConnectionFolder) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (folder: ConnectionFolder) => void;
  onConnectionDragOver: (event: DragEvent<HTMLDivElement>, folderId: string | null) => void;
  onConnectionDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  onConnectionDrop: (event: DragEvent<HTMLDivElement>, folderId: string | null) => void;
}) {
  const dragControls = useDragControls();
  const isResizing = useUIStore((s) => s.rightPanelResizing);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(folder.name);

  // While the right panel is being drag-resized, suppress framer-motion's
  // per-item layout projection (which measures+animates on every width frame
  // and causes the squish). `layout` is omitted from ReorderItemProps's public
  // type even though the runtime forwards it, so it must go through a
  // loosely-typed spread. Empty when not resizing -> default layout=true and
  // drag-to-reorder are fully preserved.
  const reorderLayoutProps = isResizing ? ({ layout: false } as Record<string, unknown>) : {};

  return (
    <Reorder.Item
      value={folder.id}
      dragListener={false}
      dragControls={dragControls}
      as="div"
      onDragOver={(event) => onConnectionDragOver(event, folder.id)}
      onDragLeave={onConnectionDragLeave}
      onDrop={(event) => onConnectionDrop(event, folder.id)}
      className={cn(
        "flex flex-col rounded-lg transition-colors",
        draggedConnectionId && "ring-inset",
        isDropTarget && "bg-[var(--sidebar-accent)]/45 ring-1 ring-[var(--primary)]/25",
      )}
      {...reorderLayoutProps}
    >
      {/* Folder header */}
      <div
        onClick={() => onToggleCollapse(folder)}
        className="group relative flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1.5 hover:bg-[var(--sidebar-accent)]/40"
      >
        <div
          onPointerDown={(e) => dragControls.start(e)}
          className="flex shrink-0 cursor-grab touch-none items-center justify-center opacity-0 transition-opacity active:cursor-grabbing group-hover:opacity-100"
        >
          <GripVertical size="0.625rem" className="text-[var(--muted-foreground)]" />
        </div>
        <ChevronRight
          size="0.75rem"
          className={cn("shrink-0 text-[var(--muted-foreground)] transition-transform", !folder.collapsed && "rotate-90")}
        />
        <div
          className="h-2 w-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: folder.color || "#6b7280" }}
          title={folder.name}
        />
        {renaming ? (
          <input
            autoFocus
            value={renameValue}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onRename(folder.id, renameValue);
                setRenaming(false);
              }
              if (e.key === "Escape") {
                setRenaming(false);
                setRenameValue(folder.name);
              }
            }}
            onBlur={() => {
              onRename(folder.id, renameValue);
              setRenaming(false);
            }}
            className="min-w-0 flex-1 bg-transparent text-xs font-medium text-[var(--foreground)] outline-none"
          />
        ) : (
          <span className="min-w-0 flex-1 cursor-pointer truncate text-xs font-medium text-[var(--muted-foreground)]">
            {folder.name}
          </span>
        )}
        {entries.length > 0 && (
          <span className="shrink-0 text-[0.5625rem] text-[var(--muted-foreground)]">{entries.length}</span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setRenameValue(folder.name);
            setRenaming(true);
          }}
          data-de-koi-action-group="connection-folder"
          className="shrink-0 rounded-md p-1 opacity-0 transition-all hover:bg-[var(--accent)] group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 max-md:opacity-100"
          title="Rename folder"
        >
          <Pencil size="0.75rem" className="text-[var(--muted-foreground)]" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(folder);
          }}
          data-de-koi-action-group="connection-folder"
          className="shrink-0 rounded-md p-1 opacity-0 transition-all hover:bg-[var(--destructive)]/20 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 max-md:opacity-100"
          title="Delete folder"
        >
          <Trash2 size="0.75rem" className="text-[var(--destructive)]" />
        </button>
      </div>
      {/* Folder contents */}
      {!folder.collapsed && entries.length > 0 && (
        <div className="ml-4 flex flex-col gap-0.5 border-l border-[var(--border)]/20 pl-1">
          {entries.map((c) => (
            <div key={c.id}>{renderConnectionRow(c)}</div>
          ))}
        </div>
      )}
    </Reorder.Item>
  );
}

export function ConnectionsPanel() {
  const { data: connections, isLoading } = useConnections();
  const activeChat = useChatStore((s) => s.activeChat);

  const activeConnectionId = activeChat?.connectionId ?? null;
  const openConnectionDetail = useUIStore((s) => s.openConnectionDetail);
  const openModal = useUIStore((s) => s.openModal);
  const linkApiBannerDismissed = useUIStore((s) => s.linkApiBannerDismissed);
  const dismissLinkApiBanner = useUIStore((s) => s.dismissLinkApiBanner);

  // Folder hooks
  const { data: folders } = useConnectionFolders();
  const createFolderMut = useCreateConnectionFolder();
  const updateFolderMut = useUpdateConnectionFolder();
  const deleteFolderMut = useDeleteConnectionFolder();
  const reorderFoldersMut = useReorderConnectionFolders();
  const moveConnectionMut = useMoveConnection();
  const uploadConnectionImage = useUploadConnectionImage();
  const connectionImageInputRef = useRef<HTMLInputElement>(null);
  const connectionImageTargetIdRef = useRef<string | null>(null);

  // Folder UI state
  const [movingConnectionId, setMovingConnectionId] = useState<string | null>(null);
  const [draggedConnectionId, setDraggedConnectionId] = useState<string | null>(null);
  const [connectionDropTarget, setConnectionDropTarget] = useState<ConnectionDropTarget>(null);

  const connectionsList = useMemo(
    () => ((connections as ConnectionRowData[] | undefined) ?? []).filter((c) => !isSyntheticConnection(c)),
    [connections],
  );

  // Sorted folder list + local order for optimistic drag-to-reorder
  const sortedFolders = useMemo(() => {
    if (!folders) return [] as ConnectionFolder[];
    return [...folders].sort((a, b) => a.sortOrder - b.sortOrder);
  }, [folders]);

  const [localFolderOrder, setLocalFolderOrder] = useState<string[]>([]);
  useEffect(() => {
    setLocalFolderOrder(sortedFolders.map((f) => f.id));
  }, [sortedFolders]);

  // Split connections into per-folder + unfiled buckets
  const { unfiledConnections, folderConnectionsMap } = useMemo(() => {
    const unfiled: ConnectionRowData[] = [];
    const map = new Map<string, ConnectionRowData[]>();
    for (const c of connectionsList) {
      const fid = c.folderId ?? null;
      if (fid && sortedFolders.some((f) => f.id === fid)) {
        const arr = map.get(fid) ?? [];
        arr.push(c);
        map.set(fid, arr);
      } else {
        unfiled.push(c);
      }
    }
    return { unfiledConnections: unfiled, folderConnectionsMap: map };
  }, [connectionsList, sortedFolders]);

  const handleCreateFolder = () => {
    createFolderMut.mutate({ name: getNextUnnamedConnectionFolderName(sortedFolders) });
  };

  const handleFolderReorder = (newOrder: string[]) => {
    setLocalFolderOrder(newOrder);
    reorderFoldersMut.mutate(newOrder);
  };

  const handleToggleCollapse = (folder: ConnectionFolder) => {
    updateFolderMut.mutate({ id: folder.id, collapsed: !folder.collapsed });
  };

  const handleRenameFolder = (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    updateFolderMut.mutate({ id, name: trimmed });
  };

  const handleDeleteFolder = async (folder: ConnectionFolder) => {
    const ok = await showConfirmDialog({
      title: "Delete Folder",
      message: `Delete folder "${folder.name}"? Connections inside will move back to Unfiled.`,
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (!ok) return;
    deleteFolderMut.mutate(folder.id);
  };

  const handleMoveConnection = (connectionId: string, folderId: string | null) => {
    moveConnectionMut.mutate({ connectionId, folderId });
    setMovingConnectionId(null);
  };

  const clearConnectionDragState = useCallback(() => {
    setDraggedConnectionId(null);
    setConnectionDropTarget(null);
  }, []);

  const handleConnectionDragStart = useCallback(
    (event: DragEvent<HTMLDivElement>, connectionId: string) => {
      if (sortedFolders.length === 0) {
        event.preventDefault();
        return;
      }
      setDraggedConnectionId(connectionId);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(CONNECTION_DRAG_MIME, connectionId);
      event.dataTransfer.setData("text/plain", connectionId);
    },
    [sortedFolders.length],
  );

  const handleConnectionDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>, folderId: string | null) => {
      if (!draggedConnectionId) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      setConnectionDropTarget((current) => (current?.folderId === folderId ? current : { folderId }));
    },
    [draggedConnectionId],
  );

  const handleConnectionDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setConnectionDropTarget(null);
  }, []);

  const handleConnectionDrop = useCallback(
    (event: DragEvent<HTMLDivElement>, folderId: string | null) => {
      event.preventDefault();
      event.stopPropagation();
      const connectionId = draggedConnectionId || event.dataTransfer.getData(CONNECTION_DRAG_MIME);
      if (!connectionId) {
        clearConnectionDragState();
        return;
      }
      const currentFolderId = connectionsList.find((connection) => connection.id === connectionId)?.folderId ?? null;
      if (currentFolderId !== folderId) {
        moveConnectionMut.mutate({ connectionId, folderId });
      }
      clearConnectionDragState();
    },
    [clearConnectionDragState, connectionsList, draggedConnectionId, moveConnectionMut],
  );

  const handlePickConnectionImage = useCallback((connectionId: string) => {
    connectionImageTargetIdRef.current = connectionId;
    if (connectionImageInputRef.current) {
      connectionImageInputRef.current.value = "";
      connectionImageInputRef.current.click();
    }
  }, []);

  const handleConnectionImageSelected = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      const connectionId = connectionImageTargetIdRef.current;
      if (!file || !connectionId) return;
      if (!file.type.startsWith("image/")) {
        connectionImageTargetIdRef.current = null;
        toast.error("Choose an image file for the connection picture");
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
          await uploadConnectionImage.mutateAsync({ id: connectionId, image, filename: file.name });
          toast.success("Connection picture updated");
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Failed to upload connection picture");
        } finally {
          connectionImageTargetIdRef.current = null;
        }
      };
      reader.onerror = () => {
        connectionImageTargetIdRef.current = null;
        toast.error("Could not read that image");
      };
      reader.readAsDataURL(file);
    },
    [uploadConnectionImage],
  );

  const renderConnectionRow = (conn: ConnectionRowData) => {
    const isSelected = activeConnectionId === conn.id;
    return (
      <ConnectionRow
        key={conn.id}
        conn={conn}
        isSelected={isSelected}
        isDragging={draggedConnectionId === conn.id}
        onClickRow={() => openConnectionDetail(conn.id)}
        onMove={() => setMovingConnectionId(conn.id)}
        onImagePick={() => handlePickConnectionImage(conn.id)}
        onConnectionDragStart={handleConnectionDragStart}
        onConnectionDragEnd={clearConnectionDragState}
        showMoveButton={sortedFolders.length > 0}
      />
    );
  };

  const movingConnection = movingConnectionId
    ? (connectionsList.find((c) => c.id === movingConnectionId) ?? null)
    : null;

  return (
    <div className="flex flex-col gap-2 p-3">
      <input
        ref={connectionImageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleConnectionImageSelected}
      />

      <button
        onClick={() => openModal("create-connection")}
        className="flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-medium transition-all active:scale-[0.98] bg-gradient-to-r from-sky-400 to-blue-500 text-white shadow-md shadow-sky-400/15 hover:shadow-lg hover:shadow-sky-400/25"
      >
        <Plus size="0.8125rem" />
        Add Connection
      </button>

      {/* ── Local Model sidecar ── */}
      <LocalSidecarCard />

      {/* ── Text to Speech ── */}
      <TTSConfigCard />

      <DefaultAgentConnectionCard connectionsList={connectionsList} />
      <DefaultIllustratorConnectionCard connectionsList={connectionsList} />

      {/* ── New folder button ── */}
      <button
        onClick={handleCreateFolder}
        disabled={createFolderMut.isPending}
        className="flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[0.6875rem] text-[var(--muted-foreground)] transition-all hover:bg-[var(--sidebar-accent)]/40 hover:text-[var(--foreground)] disabled:cursor-wait disabled:opacity-60"
      >
        <FolderPlus size="0.75rem" />
        New Folder
      </button>

      {isLoading && (
        <div className="flex flex-col gap-2 py-2">
          {[1, 2].map((i) => (
            <div key={i} className="shimmer h-14 rounded-xl" />
          ))}
        </div>
      )}

      {!isLoading && (!connections || (connections as unknown[]).length === 0) && (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <div className="animate-float flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-400/20 to-blue-500/20">
            <Link size="1.25rem" className="text-sky-400" />
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">No connections yet</p>
        </div>
      )}

      {/* LinkAPI recommendation banner */}
      {!isLoading && (!connections || (connections as unknown[]).length === 0) && !linkApiBannerDismissed && (
        <div className="rounded-xl border border-sky-400/20 bg-gradient-to-br from-sky-400/5 to-blue-500/5 p-3 flex flex-col gap-2">
          <p className="text-xs text-[var(--muted-foreground)]">
            Looking to try new models from a trusted provider? Consider checking out{" "}
            <a
              href="https://linkapi.ai/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-sky-400 underline decoration-sky-400/30 hover:text-sky-300 transition-colors"
            >
              LinkAPI
            </a>
            !
          </p>
          <div className="flex gap-2">
            <a
              href="https://linkapi.ai/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-lg bg-sky-400/15 px-3 py-1.5 text-xs font-medium text-sky-400 transition-all hover:bg-sky-400/25"
            >
              <ExternalLink size="0.75rem" />
              Visit LinkAPI
            </a>
            <button
              onClick={dismissLinkApiBanner}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-[var(--muted-foreground)] transition-all hover:bg-[var(--secondary)]"
            >
              <X size="0.75rem" />
              Dismiss permanently
            </button>
          </div>
        </div>
      )}

      {/* Folders (drag-to-reorder) */}
      {localFolderOrder.length > 0 && (
        <Reorder.Group
          axis="y"
          values={localFolderOrder}
          onReorder={handleFolderReorder}
          as="div"
          className="flex flex-col gap-0.5 mt-1"
        >
          {localFolderOrder.map((folderId) => {
            const folder = sortedFolders.find((f) => f.id === folderId);
            if (!folder) return null;
            const folderEntries = folderConnectionsMap.get(folderId) ?? [];
            return (
              <ConnectionFolderRow
                key={folderId}
                folder={folder}
                entries={folderEntries}
                renderConnectionRow={renderConnectionRow}
                isDropTarget={connectionDropTarget?.folderId === folder.id}
                draggedConnectionId={draggedConnectionId}
                onToggleCollapse={handleToggleCollapse}
                onRename={handleRenameFolder}
                onDelete={handleDeleteFolder}
                onConnectionDragOver={handleConnectionDragOver}
                onConnectionDragLeave={handleConnectionDragLeave}
                onConnectionDrop={handleConnectionDrop}
              />
            );
          })}
        </Reorder.Group>
      )}

      {/* Unfiled connections */}
      <div
        data-connection-folder-root
        onDragOver={(event) => handleConnectionDragOver(event, null)}
        onDragLeave={handleConnectionDragLeave}
        onDrop={(event) => handleConnectionDrop(event, null)}
        className={cn(
          "stagger-children flex flex-col gap-1 rounded-xl transition-colors",
          draggedConnectionId && "min-h-8",
          connectionDropTarget &&
            connectionDropTarget.folderId === null &&
            "bg-[var(--sidebar-accent)]/45 ring-1 ring-[var(--primary)]/25",
        )}
      >
        {unfiledConnections.map(renderConnectionRow)}
      </div>

      {activeChat && (
        <p className="px-1 text-[0.625rem] text-[var(--muted-foreground)]/60">
          Click to edit · Set active connection in Chat Settings
        </p>
      )}

      {/* ── Move to Folder Modal ── */}
      <Modal
        open={movingConnectionId !== null}
        onClose={() => setMovingConnectionId(null)}
        title="Move to Folder"
        width="max-w-xs"
      >
        {movingConnection && (
          <div className="flex flex-col gap-1">
            <button
              onClick={() => handleMoveConnection(movingConnection.id, null)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs transition-all hover:bg-[var(--accent)]",
                !movingConnection.folderId && "bg-[var(--accent)] font-medium",
              )}
            >
              <Link size="0.75rem" className="text-[var(--muted-foreground)]" />
              Unfiled
            </button>
            {sortedFolders.map((f) => (
              <button
                key={f.id}
                onClick={() => handleMoveConnection(movingConnection.id, f.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs transition-all hover:bg-[var(--accent)]",
                  movingConnection.folderId === f.id && "bg-[var(--accent)] font-medium",
                )}
              >
                <div className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: f.color || "#6b7280" }} />
                {f.name}
              </button>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
