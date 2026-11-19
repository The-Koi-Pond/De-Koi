import { Crop, Loader2, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { cropSpriteDataUrl, type SpriteFrameAdjustments } from "../../../../../shared/lib/sprite-frame-crop";
import { PercentSlider } from "../../generation/components/PercentSlider";
import { MAX_FRAME_EDGE, ZERO_FRAME, setFrameEdge, type FrameEdge } from "../../generation/lib/frame-limits";
import { editorButton, errorText, primaryEditorButton } from "./editor-styles";
import { confirmDiscard, type SavedSpriteEditorProps } from "./saved-sprite-editor";

const EDGES: Array<{ edge: FrameEdge; label: string }> = [
  { edge: "top", label: "Top" },
  { edge: "bottom", label: "Bottom" },
  { edge: "left", label: "Left" },
  { edge: "right", label: "Right" },
];

const FRAME_TEXT = {
  previewFailed: "Couldn't show the framed preview.",
  applyFailed: "Couldn't frame sprite. Try again.",
} as const;

type FrameError = { kind: "preview" | "apply"; text: string };

function frameKey(imageUrl: string, frame: SpriteFrameAdjustments): string {
  return `${frame.top}/${frame.bottom}/${frame.left}/${frame.right}/${imageUrl}`;
}

function hasFrame(frame: SpriteFrameAdjustments): boolean {
  return frame.top > 0 || frame.bottom > 0 || frame.left > 0 || frame.right > 0;
}

/**
 * The frame editor for a saved sprite: crops each edge by a percentage and hands the cropped PNG to `onApply`.
 * Opening it for another sprite starts over. Spec: docs/provenance/sprite-editors.md, "Frame editor".
 */
export function SpriteFrameEditor({ imageUrl, label, applying, onApply, onClose }: SavedSpriteEditorProps) {
  const [framedUrl, setFramedUrl] = useState(imageUrl);
  const [frame, setFrame] = useState<SpriteFrameAdjustments>(ZERO_FRAME);
  const [preview, setPreview] = useState<{ key: string; src: string } | null>(null);
  const [error, setError] = useState<FrameError | null>(null);
  const [cropping, setCropping] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const headingId = useId();

  if (framedUrl !== imageUrl) {
    setFramedUrl(imageUrl);
    setFrame(ZERO_FRAME);
    setPreview(null);
    setError(null);
  }

  const key = frameKey(imageUrl, frame);
  useEffect(() => {
    let current = true;
    cropSpriteDataUrl(imageUrl, frame).then(
      (src) => {
        if (!current) return;
        setPreview({ key, src });
        setError((shown) => (shown?.kind === "preview" ? null : shown));
      },
      () => {
        if (!current) return;
        setPreview(null);
        setError({ kind: "preview", text: FRAME_TEXT.previewFailed });
      },
    );
    return () => {
      current = false;
    };
  }, [frame, imageUrl, key]);

  // Opening (or switching sprite) brings the panel into view and focus to its heading; closing returns focus to
  // whatever opened it, usually the tile's Frame button.
  useLayoutEffect(() => {
    const opener = document.activeElement;
    if (opener instanceof HTMLElement && !panelRef.current?.contains(opener)) returnFocusRef.current = opener;
    panelRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    headingRef.current?.focus({ preventScroll: true });
  }, [imageUrl]);

  useEffect(
    () => () => {
      const opener = returnFocusRef.current;
      if (opener?.isConnected) opener.focus();
    },
    [],
  );

  const changeEdge = (edge: FrameEdge, value: number) => setFrame((current) => setFrameEdge(current, edge, value));

  const apply = async () => {
    setCropping(true);
    setError(null);
    try {
      const dataUrl = await cropSpriteDataUrl(imageUrl, frame);
      await onApply(dataUrl);
    } catch {
      setError({ kind: "apply", text: FRAME_TEXT.applyFailed });
    } finally {
      setCropping(false);
    }
  };

  const requestClose = async () => {
    if (hasFrame(frame) && !(await confirmDiscard(label))) return;
    onClose();
  };

  const shownPicture = preview?.key === key ? preview.src : imageUrl;
  return (
    <section
      ref={panelRef}
      aria-labelledby={headingId}
      className="rounded-xl border border-[var(--primary)]/40 bg-[var(--card)] p-4"
    >
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="aspect-square w-full shrink-0 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--secondary)] sm:w-36">
          <img src={shownPicture} alt={`Framed preview of ${label}`} className="h-full w-full object-contain" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h3
              ref={headingRef}
              id={headingId}
              tabIndex={-1}
              className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)] focus:outline-none"
            >
              <Crop size="1rem" aria-hidden="true" className="text-[var(--primary)]" />
              Frame {label}
            </h3>
            <button
              type="button"
              aria-label="Close frame editor"
              title="Close frame editor"
              onClick={() => void requestClose()}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            >
              <X size="1rem" aria-hidden="true" />
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {EDGES.map(({ edge, label: edgeLabel }) => (
              <PercentSlider
                key={edge}
                label={edgeLabel}
                min={0}
                max={MAX_FRAME_EDGE}
                step={0.5}
                value={frame[edge]}
                disabled={applying}
                onChange={(value) => changeEdge(edge, value)}
              />
            ))}
          </div>
          <p role="alert" className={`${errorText} empty:hidden`}>
            {error?.text}
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" disabled={applying} onClick={() => setFrame(ZERO_FRAME)} className={editorButton}>
              Reset
            </button>
            <button
              type="button"
              disabled={applying || cropping}
              onClick={() => void apply()}
              className={primaryEditorButton}
            >
              {applying ? (
                <Loader2 size="0.875rem" className="animate-spin" aria-hidden="true" />
              ) : (
                <Crop size="0.875rem" aria-hidden="true" />
              )}
              Apply frame
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
