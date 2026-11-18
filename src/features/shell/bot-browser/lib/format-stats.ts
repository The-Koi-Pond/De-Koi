function trimmed(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

/** A stat on a tile: 950, 1.2K, 3.4M. */
export function shortNumber(value: number): string {
  if (value >= 1_000_000) return `${trimmed(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trimmed(value / 1_000)}K`;
  return String(Math.round(value));
}

/** Total pages for a total and a page size: rounded up, at least 1. */
export function totalPages(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
