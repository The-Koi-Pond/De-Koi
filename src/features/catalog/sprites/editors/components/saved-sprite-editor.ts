import { showConfirmDialog } from "../../../../../shared/lib/app-dialogs";

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

/** Asks before closing an editor with unsaved changes. Resolves true to discard them. */
export function confirmDiscard(label: string): Promise<boolean> {
  return showConfirmDialog({
    title: "Discard changes?",
    message: `Discard your changes to ${label}?`,
    confirmLabel: "Discard",
    cancelLabel: "Keep editing",
    tone: "destructive",
  });
}
