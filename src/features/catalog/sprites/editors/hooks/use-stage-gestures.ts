import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

import { drawPicture } from "../browser/picture-canvas";
import { stampBrush, strokeBrushLine, type BrushSettings, type StrokeCanvas } from "../lib/brush";
import {
  CLEANUP_TEXT,
  pickedColorText,
  rgbToHex,
  strokeChangedText,
  wandRemovedText,
  type CleanupTool,
} from "../lib/cleanup-text";
import { copyPicture, pixelAt, type Rgba, type RgbaPicture } from "../lib/picture";
import { isBrushTool, strokeSettingsFor, type BrushControls } from "../lib/tool-settings";
import { pixelUnderPointer } from "../lib/view";
import { removeWandArea, type WandSettings } from "../lib/wand";
import type { EditorPicture } from "./use-cleanup-picture";

export interface HoveredPixel {
  x: number;
  y: number;
  rgba: Rgba;
}

type Gesture =
  | { kind: "pan"; pointerId: number; startX: number; startY: number; scrollLeft: number; scrollTop: number }
  | {
      kind: "stroke";
      pointerId: number;
      settings: BrushSettings;
      before: RgbaPicture;
      canvas: StrokeCanvas & { changed: Uint8Array };
      /** The last pixel stamped on, or null while the pointer is outside the picture. */
      last: { x: number; y: number } | null;
      stamped: number;
    };

const MAIN_BUTTON = 0;
const MIDDLE_BUTTON = 1;

interface StageGestureOptions {
  stageRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  pictureRef: RefObject<EditorPicture | null>;
  /** Loading, saving or showing the original: the stage takes no input. */
  blocked: boolean;
  tool: CleanupTool;
  wand: WandSettings;
  brush: BrushControls;
  picking: boolean;
  onPicked: (hex: string) => void;
  commitChange: (before: RgbaPicture, next: RgbaPicture, status: string) => void;
  setStatus: (text: string, clearsError?: boolean) => void;
}

/** Pointer input on the stage: wand clicks, brush strokes, colour picking, panning and the pixel readout. */
export function useStageGestures(options: StageGestureOptions) {
  const { stageRef, canvasRef, pictureRef, blocked, tool, wand, brush, picking } = options;
  const { onPicked, commitChange, setStatus } = options;
  const gesture = useRef<Gesture | null>(null);
  const [hover, setHover] = useState<HoveredPixel | null>(null);
  const [panning, setPanning] = useState(false);
  /** A stroke or pan is in progress (pointer still down): history buttons and keys wait until it ends. */
  const [gestureActive, setGestureActive] = useState(false);

  const beginGesture = (next: Gesture) => {
    gesture.current = next;
    setGestureActive(true);
  };

  const pixelFor = useCallback(
    (event: { clientX: number; clientY: number }, picture: RgbaPicture) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const box = canvas.getBoundingClientRect();
      return pixelUnderPointer({ x: event.clientX, y: event.clientY }, box, picture);
    },
    [canvasRef],
  );

  /** The picture the pointer sees: the stroke's working copy while drawing, else the current picture. */
  const visiblePicture = (): RgbaPicture | null => {
    const active = gesture.current;
    if (active?.kind === "stroke") return active.canvas.current;
    return pictureRef.current?.current ?? null;
  };

  const sampleHover = (event: { clientX: number; clientY: number }) => {
    const picture = visiblePicture();
    const pixel = picture ? pixelFor(event, picture) : null;
    setHover(pixel && picture ? { ...pixel, rgba: pixelAt(picture, pixel.x, pixel.y) } : null);
    return pixel;
  };

  const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const stage = stageRef.current;
    if (!stage) return;
    beginGesture({
      kind: "pan",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: stage.scrollLeft,
      scrollTop: stage.scrollTop,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
    setPanning(true);
    setStatus(CLEANUP_TEXT.panning, false);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (blocked || gesture.current) return;
    if (event.button === MIDDLE_BUTTON) {
      event.preventDefault();
      startPan(event);
      return;
    }
    if (event.button !== MAIN_BUTTON) return;
    const editing = pictureRef.current;
    if (!editing) return;
    const pixel = sampleHover(event);
    if (!pixel) return;

    if (tool === "pan") {
      startPan(event);
      return;
    }
    const current = editing.current;
    if (picking && tool === "brush" && brush.paintMode === "color") {
      const rgba = pixelAt(current, pixel.x, pixel.y);
      // A fully see-through pixel's colour is hidden (usually black after loading); keep picking instead.
      if (rgba[3] === 0) {
        setStatus(CLEANUP_TEXT.pickSeeThrough, false);
        return;
      }
      onPicked(rgbToHex(rgba[0], rgba[1], rgba[2]));
      setStatus(pickedColorText(rgba));
      return;
    }
    if (tool === "wand") {
      const result = removeWandArea(current, pixel.x, pixel.y, wand);
      if (result.removed === 0) setStatus(CLEANUP_TEXT.noOpaquePixels, false);
      else commitChange(current, result.picture, wandRemovedText(result.removed, wand, result.target));
      return;
    }
    if (!isBrushTool(tool)) return;
    const settings = strokeSettingsFor(tool, brush, current, pixel);
    const canvas = {
      current: copyPicture(current),
      original: editing.original,
      changed: new Uint8Array(current.width * current.height),
    };
    const stamped = stampBrush(canvas, pixel, settings);
    beginGesture({
      kind: "stroke",
      pointerId: event.pointerId,
      settings,
      before: current,
      canvas,
      last: pixel,
      stamped,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
    if (stamped > 0 && canvasRef.current) drawPicture(canvasRef.current, canvas.current);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pixel = sampleHover(event);
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (active.kind === "pan") {
      const stage = stageRef.current;
      if (!stage) return;
      stage.scrollLeft = active.scrollLeft - (event.clientX - active.startX);
      stage.scrollTop = active.scrollTop - (event.clientY - active.startY);
      return;
    }
    if (!pixel) {
      active.last = null;
      return;
    }
    if (active.last && active.last.x === pixel.x && active.last.y === pixel.y) return;
    const stamped = active.last
      ? strokeBrushLine(active.canvas, active.last, pixel, active.settings)
      : stampBrush(active.canvas, pixel, active.settings);
    active.last = pixel;
    active.stamped += stamped;
    if (stamped > 0 && canvasRef.current) drawPicture(canvasRef.current, active.canvas.current);
  };

  const endGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    gesture.current = null;
    setGestureActive(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (active.kind === "pan") {
      setPanning(false);
      return;
    }
    if (active.stamped === 0) {
      setStatus(CLEANUP_TEXT.noPixelsChanged, false);
      return;
    }
    let changedPixels = 0;
    for (const mark of active.canvas.changed) changedPixels += mark;
    commitChange(active.before, active.canvas.current, strokeChangedText(active.settings.mode, changedPixels));
  };

  const onPointerLeave = () => {
    if (!gesture.current) setHover(null);
  };

  return {
    hover,
    panning,
    gestureActive,
    isGestureActive: () => gesture.current !== null,
    stageHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endGesture,
      onPointerCancel: endGesture,
      onPointerLeave,
    },
  };
}
