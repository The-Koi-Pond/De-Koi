import { useCallback, useEffect, useRef, useState } from "react";

import { dismissActiveDialog, showConfirmDialog } from "../../../../../shared/lib/app-dialogs";

/** What the Sprites tabs pass to both saved-sprite editors. */
export interface SavedSpriteEditorProps {
  /** The sprite's address from `sprite_list`. */
  imageUrl: string;
  /** The tab's display name for the sprite (without `full_`). */
  label: string;
  /** The tab is saving this editor's picture. */
  applying: boolean;
  /** Saves the edited picture (a PNG data URL) over the sprite. */
  onApply: (dataUrl: string) => void | Promise<void>;
  onClose: () => void;
}

/**
 * Asks "Discard your changes to <label>?" before closing an editor with unsaved changes (decision 3). `asking` is true
 * while the question is open. If the editor goes away first (a running save finished and the tab closed it), the
 * question goes away with it.
 */
export function useDiscardQuestion(label: string) {
  const [asking, setAsking] = useState(false);
  const askingRef = useRef(false);

  useEffect(
    () => () => {
      if (askingRef.current) dismissActiveDialog();
    },
    [],
  );

  const confirmDiscard = useCallback(async () => {
    askingRef.current = true;
    setAsking(true);
    try {
      return await showConfirmDialog({
        title: "Discard changes?",
        message: `Discard your changes to ${label}?`,
        confirmLabel: "Discard",
        cancelLabel: "Keep editing",
        tone: "destructive",
      });
    } finally {
      askingRef.current = false;
      setAsking(false);
    }
  }, [label]);

  return { asking, confirmDiscard };
}
