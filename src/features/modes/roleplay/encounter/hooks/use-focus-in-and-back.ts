import { useEffect, type RefObject } from "react";

/**
 * Focus moves to `target` when an encounter window opens and back to where it was when it closes (decision 11).
 * It runs as an effect, after a window it replaces has put focus back, so a window shown in place of another (the
 * crash screen for the combat window) returns focus where that one would have, not to an element that is gone.
 */
export function useFocusInAndBack(target: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    target.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, [target]);
}
