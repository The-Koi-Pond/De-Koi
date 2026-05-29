export function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}
