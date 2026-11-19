import { isRecord } from "../shared/value-readers";

/**
 * The value stored in an app-settings row, or null when the row is missing or not an object. Same result as
 * `appSettingsResponseSchema.safeParse(record)` then `.data.value` (null on failure), without zod, so the settings
 * reads the home screen makes at startup do not load it.
 */
export function readAppSettingsValue(record: unknown): unknown {
  if (!isRecord(record)) return null;
  return record.value === undefined ? null : record.value;
}
