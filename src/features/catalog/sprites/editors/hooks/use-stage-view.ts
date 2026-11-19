import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";

import type { RgbaPicture } from "../lib/picture";
import { fitZoom, wheelZoom, zoomIn as zoomInStep, zoomOut as zoomOutStep } from "../lib/view";

/** The stage's zoom: fitted once after the picture loads, then changed by the buttons and Ctrl/Cmd + wheel. */
export function useStageView(stageRef: RefObject<HTMLDivElement | null>, loaded: RgbaPicture | null) {
  const [zoom, setZoom] = useState(1);
  const fittedFor = useRef<RgbaPicture | null>(null);

  const fit = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || !loaded) return;
    setZoom(fitZoom({ width: stage.clientWidth, height: stage.clientHeight }, loaded));
  }, [loaded, stageRef]);

  useLayoutEffect(() => {
    if (!loaded || fittedFor.current === loaded) return;
    fittedFor.current = loaded;
    fit();
  }, [fit, loaded]);

  const zoomIn = useCallback(() => setZoom(zoomInStep), []);
  const zoomOut = useCallback(() => setZoom(zoomOutStep), []);
  const zoomByWheel = useCallback((deltaY: number) => setZoom((current) => wheelZoom(current, deltaY)), []);

  return { zoom, fit, zoomIn, zoomOut, zoomByWheel };
}
