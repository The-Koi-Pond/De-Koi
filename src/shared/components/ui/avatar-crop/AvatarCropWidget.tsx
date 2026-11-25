import { Crop, Maximize2, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { getAvatarCropStyle, isLegacyAvatarCrop, type AvatarCrop, type LegacyAvatarCrop } from "../../../lib/utils";
import { CropSquare } from "./CropSquare";
import {
  cropFromSquare,
  defaultSquare,
  displaySizeOf,
  dragSquare,
  squareFromCrop,
  STAGE_SIZE,
  type DisplaySize,
  type Square,
  type SquarePart,
} from "./crop-math";
import { FullImageView } from "./FullImageView";

export interface AvatarCropWidgetProps {
  /** Picture URL or data URL. */
  src: string;
  alt: string;
  /** The saved crop, as the caller has it. */
  crop: AvatarCrop | LegacyAvatarCrop | null;
  onChange: (next: AvatarCrop) => void;
}

/** The display size, tagged with the picture it was measured for: a new `src` is not ready until it is measured. */
interface Measured extends DisplaySize {
  src: string;
}

interface Drag {
  part: SquarePart;
  clientX: number;
  clientY: number;
  start: Square;
}

const headerButtonClass =
  "flex items-center gap-1 rounded-xl bg-[var(--accent)] px-2 py-1 text-[0.625rem] font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]";

/**
 * The "Avatar Crop" card: drag a square over the picture to choose the region round avatars show. Hands the square
 * to `onChange` only on drags and Reset, never on opening. Behavior: docs/provenance/avatar-crop.md.
 */
export function AvatarCropWidget({ src, alt, crop, onChange }: AvatarCropWidgetProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [measured, setMeasured] = useState<Measured | null>(null);
  const [square, setSquare] = useState<Square | null>(null);
  const [fullOpen, setFullOpen] = useState(false);

  // Throws for a non-object crop such as a string or a number (recorded behavior, kept).
  const legacy = !!crop && isLegacyAvatarCrop(crop);
  const currentCrop = crop && !legacy ? (crop as AvatarCrop) : null;
  const display = measured && measured.src === src ? measured : null;
  const shown = display ? square : null;

  // Getting ready sets the square from the crop prop, even mid-drag, and hands nothing over.
  const becomeReady = (image: HTMLImageElement) => {
    const size = displaySizeOf(image.naturalWidth, image.naturalHeight);
    setMeasured({ src, ...size });
    setSquare(squareFromCrop(currentCrop, size));
  };

  // A cached picture can be complete before React listens for its `load`.
  useEffect(() => {
    const image = imageRef.current;
    if (!display && image && image.complete && image.naturalWidth > 0) becomeReady(image);
  });

  // Follow a new crop prop (by identity) while ready and not dragging. A change during a drag is dropped for good.
  const followedCrop = useRef(crop);
  useEffect(() => {
    if (followedCrop.current === crop) return;
    followedCrop.current = crop;
    if (!display || dragRef.current) return;
    setSquare(squareFromCrop(currentCrop, display));
  }, [crop, currentCrop, display]);

  const handOver = (next: Square, size: DisplaySize) => {
    setSquare(next);
    onChange(cropFromSquare(next, size));
  };

  const press = (part: SquarePart, event: ReactPointerEvent<HTMLDivElement>) => {
    if (!shown) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { part, clientX: event.clientX, clientY: event.clientY, start: shown };
  };

  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || !display) return;
    const dx = event.clientX - drag.clientX;
    const dy = event.clientY - drag.clientY;
    handOver(dragSquare(drag.part, drag.start, dx, dy, display), display);
  };

  const release = () => {
    dragRef.current = null;
  };

  const reset = () => {
    if (display) handOver(defaultSquare(display), display);
  };

  const previewCrop = legacy ? crop : shown && display ? cropFromSquare(shown, display) : null;
  const imageSrc = src || undefined;

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--secondary)] p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
          <Crop className="h-3 w-3" aria-hidden="true" />
          Avatar Crop
        </span>
        <div className="flex items-center gap-1.5">
          <button type="button" title="Open full image" className={headerButtonClass} onClick={() => setFullOpen(true)}>
            <Maximize2 className="h-2.5 w-2.5" aria-hidden="true" />
            Full image
          </button>
          <button type="button" title="Reset to centered max-square crop" className={headerButtonClass} onClick={reset}>
            <RotateCcw className="h-2.5 w-2.5" aria-hidden="true" />
            Reset
          </button>
        </div>
      </div>
      <p className="mb-3 text-[0.625rem] text-[var(--muted-foreground)]">
        Drag the square to pan, the corners to resize. The avatar shows exactly the region inside the square.
      </p>
      <div className="flex gap-4 max-md:flex-col max-md:items-center">
        <div
          className="relative flex items-center justify-center overflow-hidden rounded-xl bg-black/40 select-none"
          style={{ width: STAGE_SIZE, height: STAGE_SIZE }}
        >
          <div
            className="relative overflow-hidden"
            style={
              display
                ? { width: display.w, height: display.h, visibility: "visible" }
                : { width: STAGE_SIZE, height: STAGE_SIZE, visibility: "hidden" }
            }
          >
            <img
              key={src}
              ref={imageRef}
              src={imageSrc}
              alt={alt}
              draggable={false}
              className="h-full w-full"
              onLoad={(event) => becomeReady(event.currentTarget)}
            />
            {shown && <CropSquare square={shown} onPress={press} onMove={move} onRelease={release} />}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-center gap-2">
          <span className="text-[0.625rem] text-[var(--muted-foreground)]">Preview</span>
          <div className="relative h-24 w-24 overflow-hidden rounded-full bg-black/20 ring-2 ring-[var(--border)]">
            <img
              src={imageSrc}
              alt={alt}
              className="h-full w-full object-cover"
              style={getAvatarCropStyle(previewCrop)}
            />
          </div>
        </div>
      </div>
      {fullOpen && <FullImageView src={src} alt={alt} onClose={() => setFullOpen(false)} />}
    </div>
  );
}
