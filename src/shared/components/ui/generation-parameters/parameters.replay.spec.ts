import { describe, expect, it } from "vitest";
import {
  CHAT_PARAMETER_DEFAULTS,
  EDITABLE_GENERATION_PARAMETER_KEYS,
  getEditableGenerationParameterOverrides,
  getEditableGenerationParameters,
  parseEditableGenerationParameters,
  parseGenerationParameterRecord,
  ROLEPLAY_PARAMETER_DEFAULTS,
  serviceTierOptionsForProvider,
  type EditableGenerationParameterOverrides,
  type EditableGenerationParameters,
  type GenerationServiceTier,
} from "./index";
import { decode, encode } from "./recorded-encoding";
import recordedJson from "./test-fixtures/recorded-helpers.json";

interface HelpersRecording {
  constants: Record<string, unknown>;
  defaults: Record<string, unknown>;
  raw: Record<string, unknown>;
  parseGenerationParameterRecord: Array<[string, unknown]>;
  parseEditableGenerationParameters: Array<[string, unknown]>;
  getEditableGenerationParameters: Array<[string, string, unknown]>;
  getEditableGenerationParameterOverrides: Array<[string, string, unknown, unknown]>;
  serviceTierOptionsForProvider: Array<[unknown, unknown]>;
}

const recorded = recordedJson as unknown as HelpersRecording;

const raw = (key: string) => decode(recorded.raw[key]);
const defaultsFor = (key: string) => decode(recorded.defaults[key]) as EditableGenerationParameters;

/** Equal after encoding, key order included (`toEqual` alone ignores key order). */
function expectRecorded(actual: unknown, expected: unknown, label: string) {
  const encoded = encode(actual);
  expect(encoded, label).toEqual(expected);
  expect(JSON.stringify(encoded), `${label} (key order)`).toBe(JSON.stringify(expected));
}

describe("generation parameter helpers replay the recorded old helpers", () => {
  it("covers every recorded call", () => {
    expect(Object.keys(recorded.raw)).toHaveLength(99);
    expect(recorded.parseGenerationParameterRecord).toHaveLength(88);
    expect(recorded.parseEditableGenerationParameters).toHaveLength(99);
    expect(recorded.getEditableGenerationParameters).toHaveLength(3 * 99);
    expect(recorded.getEditableGenerationParameterOverrides).toHaveLength(105);
    expect(recorded.serviceTierOptionsForProvider).toHaveLength(11);
  });

  it("exports the recorded constants", () => {
    expectRecorded(EDITABLE_GENERATION_PARAMETER_KEYS, recorded.constants.EDITABLE_GENERATION_PARAMETER_KEYS, "keys");
    expectRecorded(CHAT_PARAMETER_DEFAULTS, recorded.constants.CHAT_PARAMETER_DEFAULTS, "chat defaults");
    expectRecorded(ROLEPLAY_PARAMETER_DEFAULTS, recorded.constants.ROLEPLAY_PARAMETER_DEFAULTS, "roleplay defaults");
  });

  it.each(recorded.parseGenerationParameterRecord)("parseGenerationParameterRecord(%s)", (key, result) => {
    expectRecorded(parseGenerationParameterRecord(raw(key)), result, key);
  });

  it.each(recorded.parseEditableGenerationParameters)("parseEditableGenerationParameters(%s)", (key, result) => {
    const parsed: EditableGenerationParameterOverrides | null = parseEditableGenerationParameters(raw(key));
    expectRecorded(parsed, result, key);
  });

  it.each(recorded.getEditableGenerationParameters)(
    "getEditableGenerationParameters(%s, %s)",
    (defaultsKey, rawKey, result) => {
      expectRecorded(getEditableGenerationParameters(defaultsFor(defaultsKey), raw(rawKey)), result, rawKey);
    },
  );

  it.each(recorded.getEditableGenerationParameterOverrides)(
    "getEditableGenerationParameterOverrides(%s, %s)",
    (defaultsKey, valueKey, value, result) => {
      const next = decode(value) as EditableGenerationParameters;
      expectRecorded(getEditableGenerationParameterOverrides(defaultsFor(defaultsKey), next), result, valueKey);
    },
  );

  it.each(recorded.serviceTierOptionsForProvider)("serviceTierOptionsForProvider(%j)", (provider, result) => {
    const options: readonly GenerationServiceTier[] | undefined = serviceTierOptionsForProvider(decode(provider));
    expectRecorded(options, result, String(provider));
  });
});

describe("getEditableGenerationParameters keeps identities the callers rely on", () => {
  it("returns the defaults object itself when the overrides set no editable key", () => {
    expect(getEditableGenerationParameters(CHAT_PARAMETER_DEFAULTS, { seed: 1 })).toBe(CHAT_PARAMETER_DEFAULTS);
    expect(getEditableGenerationParameters(CHAT_PARAMETER_DEFAULTS, "not json")).toBe(CHAT_PARAMETER_DEFAULTS);
  });
});
