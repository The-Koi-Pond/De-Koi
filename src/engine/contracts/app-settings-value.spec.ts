import { describe, expect, it } from "vitest";
import { readAppSettingsValue } from "./app-settings-value";
import { appSettingsResponseSchema } from "./schemas/app-settings.schema";

// What the settings reads did before readAppSettingsValue replaced the zod parse on the startup path.
function zodValue(record: unknown): unknown {
  const parsed = appSettingsResponseSchema.safeParse(record ?? { value: null });
  return parsed.success ? parsed.data.value : null;
}

class StoredRow {
  value = { theme: "dark" };
}

const shared = { nested: [1, { deep: true }] };
const records: unknown[] = [
  undefined,
  null,
  0,
  1,
  "",
  "row",
  true,
  false,
  [],
  [{ value: 1 }],
  {},
  { value: undefined },
  { value: null },
  { value: 0 },
  { value: "" },
  { value: false },
  { value: [] },
  { value: { enabled: { "music-dj": true } } },
  { value: shared, id: "core-modules", updatedAt: "2026-11-19" },
  { id: "no-value" },
  Object.assign(Object.create(null) as object, { value: "no prototype" }),
  new StoredRow(),
  new Date(0),
  new Map([["value", 1]]),
];

describe("readAppSettingsValue", () => {
  it.each(records.map((record, index) => [index, record]))(
    "matches the zod response schema for record %i",
    (_index, record) => {
      const value = readAppSettingsValue(record);
      expect(value).toStrictEqual(zodValue(record));
    },
  );

  it("returns the stored value itself, as the schema did", () => {
    expect(readAppSettingsValue({ value: shared })).toBe(shared);
    expect(zodValue({ value: shared })).toBe(shared);
  });
});
