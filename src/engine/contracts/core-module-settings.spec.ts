import { describe, expect, it } from "vitest";
import { readCoreModuleSettings } from "./core-module-settings";
import { coreModuleSettingsSchema } from "./schemas/core-module.schema";
import { isRecord } from "../shared/value-readers";
import type { CoreModuleSettings } from "./types/core-module";

// The zod-based read readCoreModuleSettings replaced (core-modules-api's storedSettings before this change).
function zodStoredSettings(value: unknown): CoreModuleSettings {
  const parsed = coreModuleSettingsSchema.safeParse(value ?? undefined);
  if (parsed.success) return parsed.data;
  const enabled = isRecord(value) && isRecord(value.enabled) ? value.enabled : {};
  return coreModuleSettingsSchema.parse({
    enabled: Object.fromEntries(
      Object.entries(enabled).filter(
        ([id, on]) => coreModuleSettingsSchema.safeParse({ enabled: { [id]: on } }).success,
      ),
    ),
  });
}

const ids = [
  "music-dj",
  "a",
  "0",
  "a.b-c",
  " padded ",
  "\tmusic-dj\n",
  "",
  "   ",
  "Music",
  "-lead",
  ".lead",
  "under_score",
  "spa ce",
  "é",
  "a".repeat(80),
  "a".repeat(81),
  ` ${"a".repeat(80)} `,
];
const values = [true, false, 1, 0, "true", null, undefined, {}];

const cases: unknown[] = [
  undefined,
  null,
  0,
  "core",
  true,
  [],
  [true],
  {},
  { enabled: undefined },
  { enabled: null },
  { enabled: "music-dj" },
  { enabled: [] },
  { enabled: [true, false] },
  { enabled: new Date(0) },
  { enabled: {} },
  { enabled: { "music-dj": true }, extra: 1 },
  { enabled: { "music-dj": true, Bad: true, other: false } },
  { enabled: { " music-dj": true, "music-dj ": false } },
  { enabled: { "music-dj": false, " music-dj": true } },
  { enabled: Object.assign(Object.create(null) as object, { "music-dj": true }) },
  ...ids.flatMap((id) => values.map((on) => ({ enabled: { [id]: on } }))),
  { enabled: Object.fromEntries(ids.map((id, index) => [id, index % 2 === 0])) },
];

describe("readCoreModuleSettings", () => {
  it.each(cases.map((value, index) => [index, value]))("matches the zod read for case %i", (_index, value) => {
    const read = readCoreModuleSettings(value);
    const expected = zodStoredSettings(value);
    expect(read).toStrictEqual(expected);
    expect(Object.keys(read.enabled)).toEqual(Object.keys(expected.enabled));
  });

  it("keeps the valid entries of a row with a bad one, by trimmed id", () => {
    expect(readCoreModuleSettings({ enabled: { " music-dj ": true, Bad: true, other: "yes" } })).toEqual({
      enabled: { "music-dj": true },
    });
  });
});
