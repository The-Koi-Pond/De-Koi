export interface VisualViewportHeightSource {
  innerHeight: number;
  visualViewport?: Pick<VisualViewport, "height" | "addEventListener" | "removeEventListener"> | null;
  addEventListener?: Window["addEventListener"];
  removeEventListener?: Window["removeEventListener"];
}

function getVisualViewportHeightPx(source: VisualViewportHeightSource): string {
  const visibleHeight = source.visualViewport?.height;
  const height =
    typeof visibleHeight === "number" && Number.isFinite(visibleHeight) && visibleHeight > 0
      ? visibleHeight
      : source.innerHeight;
  return `${Math.round(height)}px`;
}

export function applyVisualViewportHeightVar(root: HTMLElement, source: VisualViewportHeightSource): void {
  root.style.setProperty("--mari-visual-viewport-height", getVisualViewportHeightPx(source));
}

export function watchVisualViewportHeightVar(root: HTMLElement, source: VisualViewportHeightSource): () => void {
  applyVisualViewportHeightVar(root, source);

  const update = () => applyVisualViewportHeightVar(root, source);
  const visualViewport = source.visualViewport;
  visualViewport?.addEventListener("resize", update);
  visualViewport?.addEventListener("scroll", update);
  source.addEventListener?.("resize", update);
  source.addEventListener?.("orientationchange", update);

  return () => {
    visualViewport?.removeEventListener("resize", update);
    visualViewport?.removeEventListener("scroll", update);
    source.removeEventListener?.("resize", update);
    source.removeEventListener?.("orientationchange", update);
  };
}
