/** A plain object (not null, not an array) whose fields can be read by name. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}
