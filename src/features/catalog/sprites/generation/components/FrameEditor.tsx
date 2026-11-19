import { Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { cropSpriteDataUrl, type SpriteFrameAdjustments } from "../../../../../shared/lib/sprite-frame-crop";
import { MAX_FRAME_EDGE, type FrameEdge } from "../lib/frame-limits";
import { sectionLabel, smallButton } from "./dialog-styles";
import { PercentSlider } from "./PercentSlider";

const EDGES: Array<{ edge: FrameEdge; label: string }> = [
  { edge: "top", label: "Top" },
  { edge: "bottom", label: "Bottom" },
  { edge: "left", label: "Left" },
  { edge: "right", label: "Right" },
];

function isZero(frame: SpriteFrameAdjustments): boolean {
  return frame.top === 0 && frame.bottom === 0 && frame.left === 0 && frame.right === 0;
}

/** The shown picture cropped by the frame; the uncropped picture while cropping or when it fails. */
function useFramePreview(picture: string, frame: SpriteFrameAdjustments): string {
  const [preview, setPreview] = useState<{ key: string; src: string } | null>(null);
  const key = `${frame.top}/${frame.bottom}/${frame.left}/${frame.right}/${picture}`;
  useEffect(() => {
    if (isZero(frame)) return;
    let current = true;
    cropSpriteDataUrl(picture, frame).then(
      (src) => {
        if (current) setPreview({ key, src });
      },
      () => {
        if (current) setPreview({ key, src: picture });
      },
    );
    return () => {
      current = false;
    };
  }, [picture, frame, key]);
  if (isZero(frame)) return picture;
  return preview?.key === key ? preview.src : picture;
}

/** Frames one sprite: crops each edge by a percentage of the picture. */
export function FrameEditor({
  name,
  picture,
  frame,
  busy,
  onChange,
  onReset,
  onApply,
  onClose,
}: {
  name: string;
  picture: string;
  frame: SpriteFrameAdjustments;
  busy: boolean;
  onChange: (edge: FrameEdge, value: number) => void;
  onReset: () => void;
  onApply: () => void;
  onClose: () => void;
}) {
  const preview = useFramePreview(picture, frame);
  return (
    <section className="space-y-3 rounded-md border border-[var(--primary)]/50 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className={sectionLabel}>Frame {name || "this sprite"}</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close frame editor"
          className="de-koi-icon-target rounded-md text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
        >
          <X size="1rem" aria-hidden="true" />
        </button>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="mx-auto aspect-square w-40 shrink-0 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--secondary)]">
          <img
            src={preview}
            alt={`Framed preview of ${name || "this sprite"}`}
            className="h-full w-full object-contain"
          />
        </div>
        <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
          {EDGES.map(({ edge, label }) => (
            <PercentSlider
              key={edge}
              label={label}
              min={0}
              max={MAX_FRAME_EDGE}
              step={0.5}
              value={frame[edge]}
              onChange={(value) => onChange(edge, value)}
            />
          ))}
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onReset} disabled={busy} aria-label="Reset frame" className={smallButton}>
          Reset
        </button>
        <button type="button" onClick={onApply} disabled={busy} className={smallButton}>
          {busy && <Loader2 size="0.75rem" className="animate-spin" aria-hidden="true" />}
          Apply frame
        </button>
      </div>
    </section>
  );
}
