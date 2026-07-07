import { useEffect, useId, useRef } from "react";

import { overlayStack, type OverlayEscapeHandler } from "../lib/overlay-stack";

let globalListenerInstalled = false;

function ensureGlobalEscapeListener() {
  if (globalListenerInstalled || typeof document === "undefined") return;
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!overlayStack.handleEscape()) return;
    event.preventDefault();
    event.stopPropagation();
  });
  globalListenerInstalled = true;
}

export function useEscapeOverlay(onEscape: OverlayEscapeHandler, active = true) {
  const reactId = useId();
  const idRef = useRef(`overlay-${reactId}`);

  useEffect(() => {
    ensureGlobalEscapeListener();
  }, []);

  useEffect(() => {
    const unregister = overlayStack.register({ id: idRef.current, active, onEscape });
    return unregister;
  }, []);

  useEffect(() => {
    overlayStack.update(idRef.current, { id: idRef.current, active, onEscape });
  }, [active, onEscape]);
}
