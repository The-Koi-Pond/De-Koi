// Shared look for the scene bar and cards, in the same style as the other bars above the message box.
export const SCENE_PANEL =
  "flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)]/95 px-3 py-2 text-xs text-[var(--card-foreground)] shadow-sm backdrop-blur";
export const SCENE_PRIMARY_ACTION =
  "rounded-lg bg-[var(--primary)] px-2.5 py-1 font-semibold text-[var(--primary-foreground)] disabled:cursor-not-allowed disabled:opacity-40";
export const SCENE_ACTION =
  "rounded-lg border border-[var(--border)] px-2.5 py-1 font-medium hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40";
export const SCENE_DESTRUCTIVE_ACTION =
  "rounded-lg border border-[var(--destructive)]/40 px-2.5 py-1 font-medium text-[var(--destructive)] hover:bg-[var(--destructive)]/10 disabled:cursor-not-allowed disabled:opacity-40";
