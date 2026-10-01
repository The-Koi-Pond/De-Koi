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
    // Register once on mount: re-registering would move this overlay to the top
    // of the escape stack. The effect below keeps active and onEscape current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    overlayStack.update(idRef.current, { id: idRef.current, active, onEscape });
  }, [active, onEscape]);
}
