/** Class names the saved-sprite editors share. */
export const editorButton =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50";

export const primaryEditorButton =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-[var(--primary)] px-3 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

export const iconButton =
  "inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--foreground)] transition-colors hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50";

export function toggleButton(pressed: boolean): string {
  return `inline-flex h-8 items-center justify-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
    pressed
      ? "border-[var(--primary)] bg-[var(--primary)]/15 text-[var(--primary)]"
      : "border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--accent)]"
  }`;
}

export const errorText = "text-xs text-[var(--destructive)]";

export const mutedText = "text-xs text-[var(--muted-foreground)]";
