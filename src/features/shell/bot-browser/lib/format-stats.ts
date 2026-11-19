/** One decimal place, without a trailing ".0". */
function oneDecimal(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

/** A stat on a tile: 950, 1.2K, 3.4M. Rounds first, so 999.5 is 1K and 999,999 is 1M. */
export function shortNumber(value: number): string {
  const whole = Math.round(value);
  if (whole < 1_000) return String(whole);
  const thousands = Math.round(value / 100) / 10;
  if (thousands < 1_000) return `${oneDecimal(thousands)}K`;
  return `${oneDecimal(Math.round(value / 100_000) / 10)}M`;
}

/** Total pages for a total and a page size: rounded up, at least 1. */
export function totalPages(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
