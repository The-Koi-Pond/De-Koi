import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { Download, Folder, Trash2, X } from "lucide-react";
import { resolveGalleryFileUrl } from "../../../../../shared/api/local-file-api";
import { useEscapeOverlay } from "../../../../../shared/hooks/use-escape-overlay";
import type { GalleryFolder, GlobalGalleryImage } from "../../hooks/use-global-gallery";
import { imageAlt, lightboxLabel } from "./gallery-view";

const FOCUSABLE = "a[href], button:not([disabled]), select:not([disabled])";

interface GalleryLightboxProps {
  image: GlobalGalleryImage;
  folders: readonly GalleryFolder[];
  /** The folder shown in the dropdown (`null`: Unfiled). */
  folderId: string | null;
  moving: boolean;
  onMove: (folderId: string | null) => void;
  onDelete: (imageId: string) => void;
  onClose: () => void;
}

/** One image at full size, above everything. Mount it with `key={image.id}` so each image starts fresh. */
export function GalleryLightbox({ image, folders, folderId, moving, onMove, onDelete, onClose }: GalleryLightboxProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const src = useFullSizeUrl(image);

  // Decision 4: Escape goes through the app's overlay stack, so it closes only the lightbox and not the
  // panel that registered before it.
  useEscapeOverlay(
    useCallback(() => {
      onClose();
      return true;
    }, [onClose]),
  );

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    const keepFocusInside = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      const active = document.activeElement;
      const inside = active instanceof Node && dialogRef.current.contains(active);
      if (event.shiftKey && (active === first || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keepFocusInside);
    return () => document.removeEventListener("keydown", keepFocusInside);
  }, []);

  const closeOnBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={lightboxLabel(image)}
      onClick={closeOnBackdrop}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
    >
      <div className="flex max-h-[90vh] w-[min(90vw,40rem)] flex-col gap-3">
        <img src={src} alt={imageAlt(image)} className="max-h-[70vh] w-full rounded-xl object-contain shadow-2xl" />
        <div className="flex items-center gap-2 rounded-xl bg-black/60 p-2 text-white">
          <Folder size="0.875rem" className="shrink-0 text-white/70" />
          <select
            aria-label="Move image to folder"
            value={folderId ?? ""}
            disabled={moving}
            onChange={(event) => onMove(event.target.value || null)}
            className="min-w-0 flex-1 rounded-lg border border-white/15 bg-black/40 px-2 py-1.5 text-xs text-white disabled:opacity-60"
          >
            <option value="">Unfiled</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
          <a
            href={src}
            download
            title="Download"
            className="rounded-lg bg-white/15 p-2 text-white transition-colors hover:bg-white/25"
          >
            <Download size="0.875rem" />
          </a>
          <button
            type="button"
            onClick={() => onDelete(image.id)}
            title="Delete"
            className="rounded-lg bg-red-500/40 p-2 text-white transition-colors hover:bg-red-500/60"
          >
            <Trash2 size="0.875rem" />
          </button>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            title="Close"
            className="rounded-lg bg-white/15 p-2 text-white transition-colors hover:bg-white/25"
          >
            <X size="0.875rem" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** The image's stored URL until the full-size file URL resolves (a failed lookup keeps the stored URL). */
function useFullSizeUrl(image: GlobalGalleryImage): string {
  const { filename, filePath, url } = image;
  const [resolved, setResolved] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    Promise.resolve()
      .then(() => resolveGalleryFileUrl(filename, filePath))
      .then(
        (fullSize) => {
          if (current && fullSize) setResolved(fullSize);
        },
        () => undefined,
      );
    return () => {
      current = false;
    };
  }, [filePath, filename]);

  return resolved ?? url;
}
