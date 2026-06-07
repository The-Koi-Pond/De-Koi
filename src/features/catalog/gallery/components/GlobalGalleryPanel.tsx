// ──────────────────────────────────────────────
// Global Gallery Panel
// A profile-wide image library shown as a dedicated right-panel catalog surface
// (alongside Characters, Personas, Lorebooks). Images can be organized into flat
// folders and sorted. Management only — emoji/sticker tagging arrives later.
// ──────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import { toast } from "sonner";
import { Camera, Download, Folder, FolderPlus, Pencil, Trash2, Upload, X } from "lucide-react";

import { ImageUploadDropzone } from "../../../../shared/components/ui/ImageUploadDropzone";
import { CustomEmojiTagButton } from "../../../../shared/components/ui/CustomEmojiTagButton";
import { HelpTooltip } from "../../../../shared/components/ui/HelpTooltip";
import { galleryThumbnailPath, resolveManagedAssetThumbnailFileUrl } from "../../../../shared/api/local-file-api";
import { showConfirmDialog, showPromptDialog } from "../../../../shared/lib/app-dialogs";
import { cn } from "../../../../shared/lib/utils";
import { describeGalleryUploadFailures } from "../../../../shared/lib/gallery-upload";
import {
  type GalleryFolder,
  type GlobalGalleryImage,
  useCreateGalleryFolder,
  useDeleteGalleryFolder,
  useDeleteGlobalGalleryImage,
  useGalleryFolders,
  useGlobalGalleryImages,
  useMoveGlobalGalleryImage,
  useRenameGalleryFolder,
  useTagGlobalGalleryImage,
  useUploadGlobalGalleryImages,
} from "../hooks/use-global-gallery";

type SortMode = "newest" | "oldest" | "name-asc" | "name-desc";

const SORT_OPTIONS: Array<{ value: SortMode; label: string }> = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "name-asc", label: "Name A → Z" },
  { value: "name-desc", label: "Name Z → A" },
];

/** "all" = every image, "root" = unfiled (no folder), otherwise a folder id. */
type ActiveFolder = "all" | "root" | string;

function imageName(image: GlobalGalleryImage): string {
  return (image.filename || image.prompt || "").toLowerCase();
}

function imageTime(image: GlobalGalleryImage): number {
  const ms = Date.parse(image.createdAt);
  return Number.isFinite(ms) ? ms : 0;
}

function sortImages(images: GlobalGalleryImage[], mode: SortMode): GlobalGalleryImage[] {
  const next = images.slice();
  switch (mode) {
    case "oldest":
      return next.sort((a, b) => imageTime(a) - imageTime(b));
    case "name-asc":
      return next.sort((a, b) => imageName(a).localeCompare(imageName(b)));
    case "name-desc":
      return next.sort((a, b) => imageName(b).localeCompare(imageName(a)));
    case "newest":
    default:
      return next.sort((a, b) => imageTime(b) - imageTime(a));
  }
}

export function GlobalGalleryPanel() {
  const { data: images, isLoading } = useGlobalGalleryImages();
  const { data: folders } = useGalleryFolders();
  const upload = useUploadGlobalGalleryImages();
  const remove = useDeleteGlobalGalleryImage();
  const move = useMoveGlobalGalleryImage();
  const tag = useTagGlobalGalleryImage();
  const createFolder = useCreateGalleryFolder();
  const renameFolder = useRenameGalleryFolder();
  const deleteFolder = useDeleteGalleryFolder();

  const [activeFolder, setActiveFolder] = useState<ActiveFolder>("all");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [lightbox, setLightbox] = useState<GlobalGalleryImage | null>(null);
  // Drag-an-image-onto-a-folder-chip to re-file it. `draggingImageId` marks the
  // card being dragged (dimmed); `dropTargetFolder` highlights the hovered chip.
  const [draggingImageId, setDraggingImageId] = useState<string | null>(null);
  const [dropTargetFolder, setDropTargetFolder] = useState<ActiveFolder | null>(null);

  const folderList = useMemo<GalleryFolder[]>(() => folders ?? [], [folders]);
  const allImages = useMemo<GlobalGalleryImage[]>(() => images ?? [], [images]);

  // If the active folder gets deleted out from under us, fall back to "All".
  useEffect(() => {
    if (activeFolder === "all" || activeFolder === "root") return;
    if (!folderList.some((folder) => folder.id === activeFolder)) setActiveFolder("all");
  }, [activeFolder, folderList]);

  const rootCount = useMemo(() => allImages.filter((image) => !image.folderId).length, [allImages]);
  const countByFolder = useMemo(() => {
    const counts = new Map<string, number>();
    for (const image of allImages) {
      if (image.folderId) counts.set(image.folderId, (counts.get(image.folderId) ?? 0) + 1);
    }
    return counts;
  }, [allImages]);

  const visibleImages = useMemo(() => {
    const filtered =
      activeFolder === "all"
        ? allImages
        : activeFolder === "root"
          ? allImages.filter((image) => !image.folderId)
          : allImages.filter((image) => image.folderId === activeFolder);
    return sortImages(filtered, sortMode);
  }, [activeFolder, allImages, sortMode]);

  // Uploads land in the active folder; "All"/"Unfiled" views upload to root.
  const uploadFolderId = activeFolder === "all" || activeFolder === "root" ? null : activeFolder;
  const activeFolderName =
    activeFolder !== "all" && activeFolder !== "root"
      ? (folderList.find((folder) => folder.id === activeFolder)?.name ?? "")
      : "";

  const handleUpload = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      upload.mutate(
        { files, folderId: uploadFolderId },
        {
          onSuccess: ({ failures }) => {
            if (failures.length > 0) {
              toast.warning(`Some images didn't upload — ${describeGalleryUploadFailures(failures)}`);
            }
          },
          onError: (error) => {
            toast.error(error instanceof Error ? error.message : "Failed to upload gallery images.");
          },
        },
      );
    },
    [upload, uploadFolderId],
  );

  const handleDelete = useCallback(
    async (image: GlobalGalleryImage) => {
      if (
        !(await showConfirmDialog({
          title: "Delete Image",
          message: "Delete this gallery image?",
          confirmLabel: "Delete",
          tone: "destructive",
        }))
      ) {
        return;
      }
      remove.mutate(image.id);
      if (lightbox?.id === image.id) setLightbox(null);
    },
    [lightbox?.id, remove],
  );

  const handleCreateFolder = useCallback(async () => {
    const name = await showPromptDialog({
      title: "New Folder",
      message: "Name this gallery folder.",
      placeholder: "e.g. Reactions",
      confirmLabel: "Create",
    });
    const trimmed = name?.trim();
    if (!trimmed) return;
    createFolder.mutate(trimmed, {
      onSuccess: (folder) => setActiveFolder(folder.id),
      onError: () => toast.error("Failed to create folder."),
    });
  }, [createFolder]);

  const handleRenameFolder = useCallback(async () => {
    if (activeFolder === "all" || activeFolder === "root") return;
    const current = folderList.find((folder) => folder.id === activeFolder);
    if (!current) return;
    const name = await showPromptDialog({
      title: "Rename Folder",
      message: "Enter a new name for this folder.",
      defaultValue: current.name,
      confirmLabel: "Rename",
    });
    const trimmed = name?.trim();
    if (!trimmed || trimmed === current.name) return;
    renameFolder.mutate(
      { folderId: current.id, name: trimmed },
      { onError: () => toast.error("Failed to rename folder.") },
    );
  }, [activeFolder, folderList, renameFolder]);

  const handleDeleteFolder = useCallback(async () => {
    if (activeFolder === "all" || activeFolder === "root") return;
    const current = folderList.find((folder) => folder.id === activeFolder);
    if (!current) return;
    const count = countByFolder.get(current.id) ?? 0;
    if (
      !(await showConfirmDialog({
        title: "Delete Folder",
        message:
          count > 0
            ? `Delete "${current.name}"? The ${count} image${count === 1 ? "" : "s"} inside will move to Unfiled.`
            : `Delete "${current.name}"?`,
        confirmLabel: "Delete",
        tone: "destructive",
      }))
    ) {
      return;
    }
    deleteFolder.mutate(current.id, {
      onSuccess: () => setActiveFolder("all"),
      onError: () => toast.error("Failed to delete folder."),
    });
  }, [activeFolder, countByFolder, deleteFolder, folderList]);

  // Re-file the dragged image onto a chip. "All" is a filter, not a destination.
  const handleDropOnFolder = useCallback(
    (target: ActiveFolder, event: ReactDragEvent<HTMLButtonElement>) => {
      event.preventDefault();
      const imageId = event.dataTransfer.getData("text/plain") || draggingImageId;
      setDraggingImageId(null);
      setDropTargetFolder(null);
      if (!imageId || target === "all") return;
      const targetFolderId = target === "root" ? null : target;
      const image = allImages.find((img) => img.id === imageId);
      if (!image || (image.folderId ?? null) === targetFolderId) return;
      move.mutate({ imageId, folderId: targetFolderId });
    },
    [allImages, draggingImageId, move],
  );

  const chip = (key: ActiveFolder, label: string, count: number) => {
    const isDropTarget = key !== "all";
    return (
      <button
        key={key}
        type="button"
        onClick={() => setActiveFolder(key)}
        onDragOver={
          isDropTarget
            ? (event) => {
                if (!draggingImageId) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                if (dropTargetFolder !== key) setDropTargetFolder(key);
              }
            : undefined
        }
        onDragLeave={
          isDropTarget ? () => setDropTargetFolder((current) => (current === key ? null : current)) : undefined
        }
        onDrop={isDropTarget ? (event) => handleDropOnFolder(key, event) : undefined}
        className={cn(
          "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
          activeFolder === key
            ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
            : "bg-[var(--secondary)] text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
          dropTargetFolder === key &&
            "ring-2 ring-[var(--primary)] ring-offset-1 ring-offset-[var(--background)]",
        )}
      >
        {key !== "all" && key !== "root" && <Folder size="0.75rem" />}
        <span className="max-w-[7rem] truncate">{label}</span>
        <span className="text-[0.625rem] opacity-70">{count}</span>
      </button>
    );
  };

  return (
    <div className="space-y-4 p-3">
      {/* Sort + folder controls */}
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
          {allImages.length} image{allImages.length === 1 ? "" : "s"}
          <HelpTooltip text="Tag an image as a custom emoji or sticker with the tag button on its corner. Emojis must be ≤256×256px, stickers ≤512×512px — larger images flash red." />
        </p>
        <select
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as SortMode)}
          aria-label="Sort images"
          className="rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-[var(--ring)]"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {/* Folder chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        {chip("all", "All", allImages.length)}
        {chip("root", "Unfiled", rootCount)}
        {folderList.map((folder) => chip(folder.id, folder.name, countByFolder.get(folder.id) ?? 0))}
        <button
          type="button"
          onClick={handleCreateFolder}
          title="New folder"
          aria-label="New folder"
          className="flex shrink-0 items-center gap-1 rounded-full border border-dashed border-[var(--border)] px-3 py-1 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)]/40 hover:text-[var(--foreground)]"
        >
          <FolderPlus size="0.75rem" />
          New
        </button>
      </div>

      {/* Active folder actions */}
      {activeFolder !== "all" && activeFolder !== "root" && activeFolderName && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-[var(--secondary)]/60 px-3 py-1.5">
          <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold">
            <Folder size="0.8125rem" className="shrink-0 text-[var(--primary)]" />
            <span className="truncate">{activeFolderName}</span>
          </span>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={handleRenameFolder}
              title="Rename folder"
              aria-label="Rename folder"
              className="rounded p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            >
              <Pencil size="0.75rem" />
            </button>
            <button
              type="button"
              onClick={handleDeleteFolder}
              title="Delete folder"
              aria-label="Delete folder"
              className="rounded p-1 transition-colors hover:bg-[var(--destructive)]/15"
            >
              <Trash2 size="0.75rem" className="text-[var(--destructive)]" />
            </button>
          </div>
        </div>
      )}

      <ImageUploadDropzone
        label={uploadFolderId ? `Upload to "${activeFolderName}"` : "Upload Images"}
        pending={upload.isPending}
        pendingLabel="Uploading…"
        dragLabel="Drop images to upload"
        onFilesSelected={handleUpload}
        icon={<Upload size="1rem" />}
        className="w-full"
      />

      {isLoading ? (
        <div className="grid grid-cols-2 gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="shimmer aspect-square rounded-xl" />
          ))}
        </div>
      ) : visibleImages.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {visibleImages.map((image) => (
            <div
              key={image.id}
              draggable
              onDragStart={(event) => {
                setDraggingImageId(image.id);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", image.id);
              }}
              onDragEnd={() => {
                setDraggingImageId(null);
                setDropTargetFolder(null);
              }}
              title="Drag onto a folder to move it"
              className={cn(
                "group relative cursor-grab overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] transition-all hover:border-[var(--primary)]/30 hover:shadow-md active:cursor-grabbing",
                draggingImageId === image.id && "opacity-40",
              )}
            >
              <button
                type="button"
                className="block aspect-square w-full bg-[var(--secondary)]"
                onClick={() => setLightbox(image)}
              >
                <GlobalGalleryThumbnail image={image} alt={image.filename || image.prompt || "Gallery image"} />
              </button>
              <CustomEmojiTagButton
                image={image}
                onApply={(patch) => tag.mutate({ imageId: image.id, patch })}
              />
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/75 via-black/25 to-transparent p-1.5 opacity-0 transition-opacity group-hover:opacity-100 max-md:opacity-100">
                <span className="max-w-[5rem] truncate text-[0.625rem] font-medium text-white/85">
                  {new Date(image.createdAt).toLocaleDateString()}
                </span>
                <div className="flex gap-1">
                  <a
                    href={image.url}
                    download
                    draggable={false}
                    className="rounded-lg bg-white/15 p-1.5 text-white transition-colors hover:bg-white/25"
                    title="Download"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Download size="0.6875rem" />
                  </a>
                  <button
                    type="button"
                    onClick={() => void handleDelete(image)}
                    className="rounded-lg bg-red-500/35 p-1.5 text-white transition-colors hover:bg-red-500/55"
                    title="Delete"
                  >
                    <Trash2 size="0.6875rem" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-[var(--border)] py-10 text-center">
          <Camera size="1.75rem" className="text-[var(--muted-foreground)]/40" />
          <div>
            <p className="text-sm font-medium text-[var(--muted-foreground)]">
              {activeFolder === "all" ? "No images yet" : "No images here"}
            </p>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]/60">
              Upload images to build a reusable, profile-wide library.
            </p>
          </div>
        </div>
      )}

      {lightbox && (
        <GlobalGalleryLightbox
          image={lightbox}
          folders={folderList}
          movePending={move.isPending}
          onClose={() => setLightbox(null)}
          onMove={(folderId) => {
            // Optimistically reflect the move in the lightbox, but roll back (and
            // warn) if the write fails so the dropdown can't show a folder the
            // image was never actually filed into.
            const previousFolderId = lightbox.folderId;
            setLightbox((current) => (current ? { ...current, folderId } : current));
            move.mutate(
              { imageId: lightbox.id, folderId },
              {
                onError: () => {
                  toast.error("Couldn't move this image. Putting it back.");
                  setLightbox((current) =>
                    // Only roll back if this failed move is still the one on screen — a
                    // newer move (A→B→C) must not be clobbered by an older failure.
                    current && current.id === lightbox.id && current.folderId === folderId
                      ? { ...current, folderId: previousFolderId }
                      : current,
                  );
                },
              },
            );
          }}
          onDelete={() => void handleDelete(lightbox)}
        />
      )}
    </div>
  );
}

function GlobalGalleryLightbox({
  image,
  folders,
  movePending,
  onClose,
  onMove,
  onDelete,
}: {
  image: GlobalGalleryImage;
  folders: GalleryFolder[];
  movePending: boolean;
  onClose: () => void;
  onMove: (folderId: string | null) => void;
  onDelete: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      // Trap Tab/Shift+Tab inside the dialog (it declares aria-modal), matching
      // the persona/character lightboxes so focus can't escape to the page behind.
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), select:not([disabled])'),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      const previousFocus = previousFocusRef.current;
      previousFocusRef.current = null;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={image.filename || image.prompt || "Gallery image preview"}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 max-md:pt-[env(safe-area-inset-top)]"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="relative flex max-h-[90vh] w-[min(90vw,40rem)] flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={image.url}
          alt={image.filename || image.prompt || "Gallery image"}
          className="max-h-[70vh] w-full rounded-lg object-contain shadow-2xl"
        />
        <div className="flex items-center gap-2 rounded-lg bg-black/60 p-2">
          <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-white/80">
            <Folder size="0.875rem" className="shrink-0" />
            <select
              value={image.folderId ?? ""}
              onChange={(e) => onMove(e.target.value ? e.target.value : null)}
              disabled={movePending}
              aria-label="Move image to folder"
              className="min-w-0 flex-1 rounded-md border border-white/20 bg-black/40 px-2 py-1 text-xs text-white outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">Unfiled</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
          </label>
          <a
            href={image.url}
            download
            className="rounded-lg bg-white/15 p-2 text-white transition-colors hover:bg-white/25"
            title="Download"
          >
            <Download size="0.875rem" />
          </a>
          <button
            type="button"
            onClick={onDelete}
            className="rounded-lg bg-red-500/35 p-2 text-white transition-colors hover:bg-red-500/55"
            title="Delete"
          >
            <Trash2 size="0.875rem" />
          </button>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="rounded-lg bg-white/15 p-2 text-white transition-colors hover:bg-white/25"
            title="Close"
          >
            <X size="0.875rem" />
          </button>
        </div>
      </div>
    </div>
  );
}

function GlobalGalleryThumbnail({ image, alt }: { image: GlobalGalleryImage; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const path = galleryThumbnailPath(image.filename, image.filePath);
    setSrc(null);
    resolveManagedAssetThumbnailFileUrl("gallery", path, 256)
      .then((url) => {
        if (!cancelled) setSrc(url || image.url);
      })
      .catch(() => {
        if (!cancelled) setSrc(image.url);
      });
    return () => {
      cancelled = true;
    };
  }, [image.filePath, image.filename, image.url]);

  if (!src) return <div className="h-full w-full bg-[var(--secondary)]" aria-hidden="true" />;
  return <img src={src} alt={alt} draggable={false} className="h-full w-full object-cover" loading="lazy" />;
}
