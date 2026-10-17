const GAME_STATE_TEXT_OBJECT_KEYS = [
  "name",
  "label",
  "title",
  "value",
  "text",
  "description",
  "summary",
  "current",
  "location",
  "weather",
  "temperature",
  "date",
  "time",
  "timeOfDay",
  "condition",
  "type",
] as const;

const GAME_STATE_TEXT_FIELDS = ["date", "time", "location", "weather", "temperature"] as const;

export type TrackerStateTextField = (typeof GAME_STATE_TEXT_FIELDS)[number];

function coerceTrackerStateTextValue(value: unknown): string | null {
  return coerceTrackerStateTextValueInner(value, new WeakSet<object>());
}

export function coerceTrackerStateTextFields(fields: Partial<Record<TrackerStateTextField, unknown>>) {
  const coerced: Partial<Record<TrackerStateTextField, string | null>> = {};
  for (const field of GAME_STATE_TEXT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(fields, field)) {
      coerced[field] = coerceTrackerStateTextValue(fields[field]);
    }
  }
  return coerced;
}

function coerceTrackerStateTextValueInner(value: unknown, seen: WeakSet<object>): string | null {
  if (value === null || value === undefined) return null;

  if (typeof value === "string") {
    const text = value.trim();
    return text.length > 0 ? text : null;
  }

  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "boolean" || typeof value === "symbol" || typeof value === "function") return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => coerceTrackerStateTextValueInner(entry, seen))
      .filter((entry): entry is string => entry !== null);
    return parts.length > 0 ? parts.join(", ") : null;
  }

  if (typeof value !== "object") return null;
  if (seen.has(value)) return null;
  seen.add(value);

  const record = value as Record<string, unknown>;
  for (const key of GAME_STATE_TEXT_OBJECT_KEYS) {
    const text = coerceTrackerStateTextValueInner(record[key], seen);
    if (text) return text;
  }

  const scalarParts = Object.entries(record)
    .map(([key, entry]) => {
      if (entry === null || entry === undefined || typeof entry === "object") return null;
      const text = coerceTrackerStateTextValueInner(entry, seen);
      return text ? `${key}: ${text}` : null;
    })
    .filter((entry): entry is string => entry !== null);

  if (scalarParts.length === 1) return scalarParts[0]!;
  if (scalarParts.length > 1 && scalarParts.length <= 3) return scalarParts.join(", ");
  return null;
}
