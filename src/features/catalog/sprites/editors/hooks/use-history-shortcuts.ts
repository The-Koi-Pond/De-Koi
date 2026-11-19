import { useEffect } from "react";

const TEXT_INPUT_TYPES = new Set(["text", "search", "email", "url", "tel", "password", "number"]);

/** Typing in a text box, text area, select or editable text keeps the browser's own undo. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type);
}

/**
 * Ctrl/Cmd+Z undoes, Ctrl/Cmd+Y and Ctrl/Cmd+Shift+Z redo, anywhere in the window while the editor is open. A key that
 * does nothing here (busy, nothing to undo or redo, Alt held, typing) keeps its normal behaviour.
 */
export function useHistoryShortcuts({
  enabled,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  ownDialog,
}: {
  enabled: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** The editor's own dialog: keys typed inside another dialog on top of it are left alone. */
  ownDialog: () => Element | null;
}) {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || isTyping(event.target)) return;
      const dialog = event.target instanceof Element ? event.target.closest("[role='dialog']") : null;
      if (dialog && dialog !== ownDialog()) return;
      const key = event.key.toLowerCase();
      const wantsRedo = key === "y" || (key === "z" && event.shiftKey);
      const wantsUndo = key === "z" && !event.shiftKey;
      if (wantsUndo && canUndo) {
        event.preventDefault();
        onUndo();
      } else if (wantsRedo && canRedo) {
        event.preventDefault();
        onRedo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canRedo, canUndo, enabled, onRedo, onUndo, ownDialog]);
}
