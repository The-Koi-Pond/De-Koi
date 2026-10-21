// Status dots that differ by color also differ by shape, so they read without color
// (PRODUCT.md, Accessibility). The cb-shape-* classes live in 07-responsive-accessibility.css.

const PRESENCE_DOT_CLASS = {
  online: "bg-green-500",
  idle: "bg-yellow-500 cb-shape-crescent",
  dnd: "bg-red-500 cb-shape-bar",
  offline: "bg-gray-400 cb-shape-ring",
} as const;

/**
 * Conversation presence dot: online = solid, idle = crescent, dnd = bar, offline = ring.
 * No status reads as online; an unrecognised one reads as offline, as the dots always have.
 */
export function presenceDotClass(status?: string): string {
  if (status == null) return PRESENCE_DOT_CLASS.online;
  return PRESENCE_DOT_CLASS[status as keyof typeof PRESENCE_DOT_CLASS] ?? PRESENCE_DOT_CLASS.offline;
}
