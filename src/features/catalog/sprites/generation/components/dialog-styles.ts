/** Class names the dialog's steps share. */
export const primaryButton =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-3 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60";

export const secondaryButton =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[var(--border)] px-3 text-sm text-[var(--foreground)] hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60";

export const smallButton =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 text-xs text-[var(--foreground)] hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60";

export const sectionLabel = "text-xs font-semibold text-[var(--muted-foreground)]";

export const hintText = "text-xs text-[var(--muted-foreground)]";

export const fieldClass =
  "w-full rounded-md border border-[var(--input)] bg-[var(--secondary)] p-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

export const errorBanner =
  "rounded-md border border-[var(--destructive)]/40 bg-[var(--destructive)]/10 px-3 py-2 text-xs text-[var(--foreground)]";

export function choiceButton(selected: boolean): string {
  return `inline-flex min-h-8 items-center justify-center rounded-md border px-2.5 py-1 text-xs transition-colors ${
    selected
      ? "border-[var(--primary)] bg-[var(--primary)]/15 text-[var(--primary)]"
      : "border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--accent)]"
  }`;
}
