// The profile-wide image library in the right panel: count and sort, folder chips, the selected folder's
// bar, upload, the virtualized grid and the lightbox. Behavior: docs/provenance/gallery-panel.md.
import { Camera, Upload } from "lucide-react";
import { HelpTooltip } from "../../../../../shared/components/ui/HelpTooltip";
import { ImageUploadDropzone } from "../../../../../shared/components/ui/ImageUploadDropzone";
import { FolderBar, FolderChips } from "./FolderChips";
import { GalleryGrid } from "./GalleryGrid";
import { GalleryLightbox } from "./GalleryLightbox";
import { imageCountLabel, isGallerySort, SORT_OPTIONS, uploadLabel } from "./gallery-view";
import { useGalleryPanel } from "./use-gallery-panel";

const TAG_HELP =
  "Tag an image as a custom emoji or sticker with the tag button on its corner. Emojis must be ≤256×256px, stickers ≤512×512px — larger images flash red.";

export function GlobalGalleryPanel() {
  const panel = useGalleryPanel();
  const { imagesQuery, filter, selectedFolder, lightboxImage } = panel;
  const loadFailed = imagesQuery.isError && !imagesQuery.data && !imagesQuery.isFetching;
  const loading = !imagesQuery.data && !loadFailed;

  return (
    <div className="flex flex-col gap-4 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
          {imageCountLabel(panel.counts.all)}
          <HelpTooltip text={TAG_HELP} />
        </div>
        <select
          aria-label="Sort images"
          value={panel.sort}
          onChange={(event) => {
            if (isGallerySort(event.target.value)) panel.setSort(event.target.value);
          }}
          className="rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-2 py-1 text-xs text-[var(--foreground)] outline-none focus:ring-1 focus:ring-[var(--ring)]"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <FolderChips
        folders={panel.folders}
        counts={panel.counts}
        selected={filter}
        dropTarget={panel.dropTarget}
        onSelect={panel.selectFilter}
        onNewFolder={() => void panel.addFolder()}
        onDragOver={panel.dragOver}
        onDragLeave={panel.dragLeave}
        onDrop={panel.drop}
      />

      {selectedFolder?.name && (
        <FolderBar
          name={selectedFolder.name}
          onRename={() => void panel.renameSelectedFolder()}
          onDelete={() => void panel.deleteSelectedFolder()}
        />
      )}

      <ImageUploadDropzone
        label={uploadLabel(selectedFolder)}
        onFilesSelected={(files) => void panel.uploadFiles(files)}
        icon={<Upload size="1rem" />}
        pending={panel.uploading}
        pendingLabel="Uploading…"
        className="w-full"
      />

      {loadFailed ? (
        // Decision 3: a library that couldn't load says so instead of looking empty.
        <div className="rounded-xl border border-[var(--destructive)]/25 bg-[var(--destructive)]/10 px-3 py-2 text-xs text-[var(--destructive)]">
          <p>Couldn&apos;t load the gallery.</p>
          <button
            type="button"
            onClick={() => void imagesQuery.refetch()}
            className="mt-1 rounded-md px-2 py-1 text-[0.625rem] font-medium ring-1 ring-[var(--destructive)]/30 hover:bg-[var(--destructive)]/10"
          >
            Retry
          </button>
        </div>
      ) : loading ? (
        <div className="grid grid-cols-2 gap-2">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="shimmer aspect-square rounded-xl" />
          ))}
        </div>
      ) : panel.shown.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border-2 border-dashed border-[var(--border)] px-2 py-10 text-center">
          <Camera size="1.75rem" className="mb-2 text-[var(--muted-foreground)] opacity-40" />
          <p className="text-sm font-medium text-[var(--muted-foreground)]">
            {filter.kind === "all" ? "No images yet" : "No images here"}
          </p>
          <p className="text-xs text-[var(--muted-foreground)]/70">
            Upload images to build a reusable, profile-wide library.
          </p>
        </div>
      ) : (
        <GalleryGrid
          images={panel.shown}
          draggingId={panel.draggingId}
          onOpen={panel.openLightbox}
          onDelete={(imageId) => void panel.confirmDeleteImage(imageId)}
          onTag={panel.tagImage}
          onDragStart={panel.startDrag}
          onDragEnd={panel.endDrag}
        />
      )}

      {imagesQuery.hasNextPage && (
        <button
          type="button"
          onClick={() => void imagesQuery.fetchNextPage()}
          disabled={imagesQuery.isFetchingNextPage}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--accent)] disabled:opacity-60"
        >
          {imagesQuery.isFetchingNextPage ? "Loading older images…" : "Load older images"}
        </button>
      )}

      {lightboxImage && (
        <GalleryLightbox
          key={lightboxImage.id}
          image={lightboxImage}
          folders={panel.folders}
          folderId={panel.lightboxFolderId}
          moving={panel.lightboxMoving}
          onMove={(folderId) => void panel.moveFromLightbox(folderId)}
          onDelete={(imageId) => void panel.confirmDeleteImage(imageId)}
          onClose={panel.closeLightbox}
        />
      )}
    </div>
  );
}
