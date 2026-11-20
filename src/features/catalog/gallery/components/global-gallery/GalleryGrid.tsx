import { useEffect, useRef, useState, type DragEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Download, Trash2 } from "lucide-react";
import { CustomEmojiTagButton } from "../../../../../shared/components/ui/CustomEmojiTagButton";
import { galleryThumbnailPath, resolveManagedAssetThumbnailFileUrl } from "../../../../../shared/api/local-file-api";
import type { CustomTagPatch } from "../../../../../shared/lib/custom-emoji";
import { cn } from "../../../../../shared/lib/utils";
import type { GlobalGalleryImage } from "../../hooks/use-global-gallery";
import { imageAlt, rowsOf } from "./gallery-view";

interface CardActions {
  onOpen: (imageId: string) => void;
  onDelete: (imageId: string) => void;
  onTag: (imageId: string, patch: CustomTagPatch) => void;
  onDragStart: (imageId: string) => void;
  onDragEnd: () => void;
}

interface GalleryGridProps extends CardActions {
  images: readonly GlobalGalleryImage[];
  draggingId: string | null;
}

const ROW_ESTIMATE_PX = 180;

/** Two square cards per row; only the rows near the view are mounted. */
export function GalleryGrid({ images, draggingId, ...actions }: GalleryGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rows = rowsOf(images);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: 2,
  });

  return (
    <div ref={scrollRef} className="max-h-[60vh] overflow-y-auto">
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            className="absolute left-0 top-0 grid w-full grid-cols-2 gap-2 pb-2"
            style={{ transform: `translateY(${virtualRow.start}px)` }}
          >
            {rows[virtualRow.index]?.map((image) => (
              <GalleryCard key={image.id} image={image} dragging={draggingId === image.id} {...actions} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function GalleryCard({
  image,
  dragging,
  onOpen,
  onDelete,
  onTag,
  onDragStart,
  onDragEnd,
}: CardActions & { image: GlobalGalleryImage; dragging: boolean }) {
  const handleDragStart = (event: DragEvent<HTMLDivElement>) => {
    event.dataTransfer.setData("text/plain", image.id);
    event.dataTransfer.effectAllowed = "move";
    onDragStart(image.id);
  };

  return (
    <div
      draggable
      title="Drag onto a folder to move it"
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "group relative aspect-square overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] transition-all hover:border-[var(--primary)]/40 hover:shadow-md",
        dragging && "opacity-40",
      )}
    >
      <button type="button" onClick={() => onOpen(image.id)} className="block h-full w-full">
        <GalleryThumbnail image={image} />
      </button>
      <CustomEmojiTagButton image={image} onApply={(patch) => onTag(image.id, patch)} />
      {/* Decision 2: on desktop the strip shows on hover and while something in the card has keyboard focus. */}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/75 to-transparent p-1.5 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-has-[:focus-visible]:opacity-100">
        <span className="min-w-0 flex-1 truncate text-[0.625rem] font-medium text-white">
          {new Date(image.createdAt).toLocaleDateString()}
        </span>
        <a
          href={image.url}
          download
          title="Download"
          draggable={false}
          className="rounded-full bg-white/15 p-1.5 text-white transition-colors hover:bg-white/25"
        >
          <Download size="0.6875rem" />
        </a>
        <button
          type="button"
          onClick={() => onDelete(image.id)}
          title="Delete"
          className="rounded-full bg-red-500/35 p-1.5 text-white transition-colors hover:bg-red-500/55"
        >
          <Trash2 size="0.6875rem" />
        </button>
      </div>
    </div>
  );
}

/** The 256px gallery thumbnail, or the image's own URL when there's none. */
function GalleryThumbnail({ image }: { image: GlobalGalleryImage }) {
  const { filename, filePath, url } = image;
  const [resolved, setResolved] = useState<{ key: string; src: string } | null>(null);
  const key = `${filename ?? ""}\u0000${filePath}\u0000${url}`;

  useEffect(() => {
    let current = true;
    // `then` also catches a resolver that throws before returning its promise.
    Promise.resolve()
      .then(() => resolveManagedAssetThumbnailFileUrl("gallery", galleryThumbnailPath(filename, filePath), 256))
      .then(
        (thumbnail) => thumbnail || url,
        () => url,
      )
      .then((src) => {
        if (current) setResolved({ key, src });
      });
    return () => {
      current = false;
    };
  }, [filePath, filename, key, url]);

  // A different file shows the placeholder until its own thumbnail resolves.
  if (!resolved || resolved.key !== key) {
    return <div aria-hidden="true" className="h-full w-full bg-[var(--secondary)]" />;
  }
  return (
    <img
      src={resolved.src}
      alt={imageAlt(image)}
      loading="lazy"
      draggable={false}
      className="h-full w-full object-cover"
    />
  );
}
