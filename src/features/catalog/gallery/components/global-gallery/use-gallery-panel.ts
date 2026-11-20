// The panel's state and actions: the selected chip, the sort, the open lightbox, drag-to-move, and every
// write, each through the gallery hooks so the storage calls stay exactly the hooks' calls.
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { showConfirmDialog, showPromptDialog } from "../../../../../shared/lib/app-dialogs";
import { toUserMessage } from "../../../../../shared/lib/error-message";
import { describeGalleryUploadFailures } from "../../../../../shared/lib/gallery-upload";
import type { CustomTagPatch } from "../../../../../shared/lib/custom-emoji";
import {
  useCreateGalleryFolder,
  useDeleteGalleryFolder,
  useDeleteGlobalGalleryImage,
  useGalleryFolders,
  useGlobalGalleryImages,
  useMoveGlobalGalleryImage,
  useRenameGalleryFolder,
  useTagGlobalGalleryImage,
  useUploadGlobalGalleryImages,
  type GlobalGalleryImage,
} from "../../hooks/use-global-gallery";
import {
  ALL_IMAGES,
  countImages,
  deleteFolderMessage,
  filterImages,
  folderFilter,
  moveTargetOf,
  sameFilter,
  sortImages,
  type GalleryFilter,
  type GallerySort,
} from "./gallery-view";

const NO_IMAGES: GlobalGalleryImage[] = [];

/** The open lightbox: which image, and the folder picked in its dropdown (undefined: none picked yet). */
interface LightboxState {
  imageId: string;
  folderChoice?: string | null;
}

export function useGalleryPanel() {
  // Images first: on open the image list is asked for before the folders.
  const imagesQuery = useGlobalGalleryImages();
  const foldersQuery = useGalleryFolders();
  const images = imagesQuery.data ?? NO_IMAGES;
  const folders = foldersQuery.data;

  const upload = useUploadGlobalGalleryImages();
  const deleteImage = useDeleteGlobalGalleryImage();
  const dragMove = useMoveGlobalGalleryImage();
  const lightboxMove = useMoveGlobalGalleryImage();
  const tag = useTagGlobalGalleryImage();
  const createFolder = useCreateGalleryFolder();
  const renameFolder = useRenameGalleryFolder();
  const removeFolder = useDeleteGalleryFolder();

  const [filter, setFilter] = useState<GalleryFilter>(ALL_IMAGES);
  const [sort, setSort] = useState<GallerySort>("newest");
  // Decision 5: a new folder is selected once the folder list has it, not before.
  const [awaitedFolderId, setAwaitedFolderId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<GalleryFilter | null>(null);

  const selectedFolder =
    filter.kind === "folder" ? folders?.find((folder) => folder.id === filter.folderId) : undefined;

  useEffect(() => {
    if (!folders) return;
    if (awaitedFolderId && folders.some((folder) => folder.id === awaitedFolderId)) {
      setFilter(folderFilter(awaitedFolderId));
      setAwaitedFolderId(null);
      return;
    }
    if (filter.kind === "folder" && !folders.some((folder) => folder.id === filter.folderId)) {
      setFilter(ALL_IMAGES);
    }
  }, [awaitedFolderId, filter, folders]);

  const counts = useMemo(() => countImages(images), [images]);
  const shown = useMemo(() => sortImages(filterImages(images, filter), sort), [images, filter, sort]);

  const lightboxImage = lightbox ? images.find((image) => image.id === lightbox.imageId) : undefined;
  // The open image is gone from the library (deleted here or elsewhere): the lightbox closes.
  useEffect(() => {
    if (lightbox && !lightboxImage && imagesQuery.data) setLightbox(null);
  }, [imagesQuery.data, lightbox, lightboxImage]);

  // A pick by the user wins over a new folder still waiting for the folder list (decision 5).
  const selectFilter = useCallback((next: GalleryFilter) => {
    setAwaitedFolderId(null);
    setFilter(next);
  }, []);

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      try {
        const { failures } = await upload.mutateAsync({ files, folderId: moveTargetOf(filter) });
        if (failures.length > 0) {
          toast.warning(`Some images didn't upload — ${describeGalleryUploadFailures(failures)} Try those again.`);
        }
      } catch (error) {
        toast.error(toUserMessage(error, { fallback: "Couldn't upload gallery images. Try again." }));
      }
    },
    [filter, upload],
  );

  const confirmDeleteImage = useCallback(
    async (imageId: string) => {
      const confirmed = await showConfirmDialog({
        title: "Delete Image",
        message: "Delete this gallery image?",
        confirmLabel: "Delete",
        tone: "destructive",
      });
      // The lightbox closes on its own once the deleted image leaves the refreshed list.
      if (confirmed) deleteImage.mutate(imageId);
    },
    [deleteImage],
  );

  const addFolder = useCallback(async () => {
    const name = await showPromptDialog({
      title: "New Folder",
      message: "Name this gallery folder.",
      placeholder: "e.g. Reactions",
      confirmLabel: "Create",
    });
    const trimmed = name?.trim();
    if (!trimmed) return;
    try {
      const folder = await createFolder.mutateAsync(trimmed);
      setAwaitedFolderId(folder.id);
    } catch {
      toast.error("Couldn't create the folder. Try again.");
    }
  }, [createFolder]);

  const renameSelectedFolder = useCallback(async () => {
    if (!selectedFolder) return;
    const name = await showPromptDialog({
      title: "Rename Folder",
      message: "Enter a new name for this folder.",
      defaultValue: selectedFolder.name,
      confirmLabel: "Rename",
    });
    const trimmed = name?.trim();
    if (!trimmed || trimmed === selectedFolder.name.trim()) return;
    try {
      await renameFolder.mutateAsync({ folderId: selectedFolder.id, name: trimmed });
    } catch {
      toast.error("Couldn't rename the folder. Try again.");
    }
  }, [renameFolder, selectedFolder]);

  const deleteSelectedFolder = useCallback(async () => {
    if (!selectedFolder) return;
    const confirmed = await showConfirmDialog({
      title: "Delete Folder",
      message: deleteFolderMessage(selectedFolder.name, counts.byFolder.get(selectedFolder.id) ?? 0),
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (!confirmed) return;
    try {
      await removeFolder.mutateAsync(selectedFolder.id);
      selectFilter(ALL_IMAGES);
    } catch {
      toast.error("Couldn't delete the folder. Try again.");
    }
  }, [counts, removeFolder, selectFilter, selectedFolder]);

  const tagImage = useCallback((imageId: string, patch: CustomTagPatch) => tag.mutate({ imageId, patch }), [tag]);

  // ── Drag a card onto a chip ──

  const startDrag = useCallback((imageId: string) => setDraggingId(imageId), []);

  const endDrag = useCallback(() => {
    setDraggingId(null);
    setDropTarget(null);
  }, []);

  const dragOver = useCallback(
    (target: GalleryFilter) => {
      if (!draggingId) return false;
      setDropTarget(target);
      return true;
    },
    [draggingId],
  );

  const dragLeave = useCallback((target: GalleryFilter) => {
    setDropTarget((current) => (current && sameFilter(current, target) ? null : current));
  }, []);

  const drop = useCallback(
    (target: GalleryFilter, draggedId: string) => {
      const imageId = draggedId || draggingId;
      endDrag();
      const image = images.find((candidate) => candidate.id === imageId);
      if (!image) return;
      const folderId = moveTargetOf(target);
      if ((image.folderId ?? null) === folderId) return;
      dragMove.mutate({ imageId: image.id, folderId });
    },
    [dragMove, draggingId, endDrag, images],
  );

  // ── Lightbox ──

  const openLightbox = useCallback((imageId: string) => setLightbox({ imageId }), []);
  const closeLightbox = useCallback(() => setLightbox(null), []);

  const lightboxFolderId =
    lightbox && lightbox.folderChoice !== undefined ? lightbox.folderChoice : (lightboxImage?.folderId ?? null);

  const moveFromLightbox = useCallback(
    async (folderId: string | null) => {
      if (!lightboxImage) return;
      const imageId = lightboxImage.id;
      const previous = lightboxFolderId;
      setLightbox({ imageId, folderChoice: folderId });
      try {
        await lightboxMove.mutateAsync({ imageId, folderId });
      } catch {
        toast.error("Couldn't move this image. Putting it back.");
        // Only undo the failed choice itself: a later choice, or another image, stays as it is.
        setLightbox((current) =>
          current && current.imageId === imageId && current.folderChoice === folderId
            ? { imageId, folderChoice: previous }
            : current,
        );
      }
    },
    [lightboxFolderId, lightboxImage, lightboxMove],
  );

  return {
    imagesQuery,
    images,
    folders: folders ?? [],
    shown,
    counts,
    filter,
    selectFilter,
    selectedFolder,
    sort,
    setSort,
    uploading: upload.isPending,
    uploadFiles,
    confirmDeleteImage,
    addFolder,
    renameSelectedFolder,
    deleteSelectedFolder,
    tagImage,
    draggingId,
    dropTarget,
    startDrag,
    endDrag,
    dragOver,
    dragLeave,
    drop,
    lightboxImage,
    lightboxFolderId,
    lightboxMoving: lightboxMove.isPending,
    openLightbox,
    closeLightbox,
    moveFromLightbox,
  };
}
