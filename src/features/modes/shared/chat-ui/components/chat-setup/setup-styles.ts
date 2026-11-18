// Class names shared by the setup cards, so the three layouts look like one tool.

export const SETUP_FIELD_LABEL_CLASS = "mb-1 block text-[0.6875rem] font-semibold text-[var(--muted-foreground)]";

export const SETUP_SELECT_CLASS =
  "w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs text-[var(--foreground)] outline-none ring-1 ring-[var(--border)] transition-shadow focus:ring-[var(--primary)] disabled:opacity-60";

export const SETUP_INPUT_CLASS =
  "w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs text-[var(--foreground)] outline-none ring-1 ring-[var(--border)] transition-shadow placeholder:text-[var(--muted-foreground)] focus:ring-[var(--primary)]";

export const SETUP_SECTION_HEADING_CLASS = "text-xs font-semibold text-[var(--foreground)]";

export const SETUP_PRIMARY_BUTTON_CLASS =
  "flex items-center justify-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-2 text-xs font-semibold text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

export const SETUP_QUIET_BUTTON_CLASS =
  "flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-50";

export const SETUP_ICON_BUTTON_CLASS =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-50";

export const SETUP_ROW_CLASS =
  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--accent)]";
