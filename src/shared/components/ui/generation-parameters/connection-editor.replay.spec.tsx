import { afterEach, describe, expect, it } from "vitest";
import { FieldsHarness, type Group } from "./fields-replay-harness";
import {
  getEditableGenerationParameters,
  ROLEPLAY_PARAMETER_DEFAULTS,
  serviceTierOptionsForProvider,
  type EditableGenerationParameters,
} from "./index";
import { encode } from "./recorded-encoding";
import chromeJson from "./test-fixtures/recorded-chrome.json";

// Replays the connection editor flows of `recorded-chrome.json` (real Chrome, old build) against the fields, as
// ConnectionEditor drives them: Custom defaults on for an OpenAI connection with no stored defaults starts from
// `getEditableGenerationParameters(ROLEPLAY_PARAMETER_DEFAULTS, null)`, every handed-over value is taken back, and
// Save stores the value as it is, after which the editor reloads the connection's (key-sorted) stored defaults.

interface ShownFields {
  values: Record<string, string>;
  tags: Array<[string, string]>;
  selected: Record<Group, string[] | null>;
  options: Record<Group, string[]>;
  cpPlaceholder: string;
  cpNote: string;
  addDisabled: boolean;
}

interface ChromeStep {
  label: string;
  shown: { fields: ShownFields | null };
  stored: { connectionDefaultParameters: Record<string, unknown> | null };
}

interface ChromeFlow {
  flow: string;
  width: number;
  scheme: string;
  steps: ChromeStep[];
}

const flows = (chromeJson as unknown as { flows: ChromeFlow[] }).flows.filter((flow) => flow.flow === "connection");

type Drive = (fields: FieldsHarness) => void;

const edit =
  (field: string, text: string): Drive =>
  (fields) => {
    fields.run({ do: "focus", field });
    fields.run({ do: "fill", field, text });
    fields.run({ do: "blur", field });
  };
const pick =
  (group: Group, option: string): Drive =>
  (fields) => {
    fields.run({ do: "click", group, option });
  };

// The recording keeps each step's label and result, not the keystrokes. Where the typed text isn't recorded, the
// text below is one that gives the recorded result (the Custom Parameters text parses to the recorded object in
// the recorded key order; the bad text is invalid JSON).
const BAD_CUSTOM_PARAMETERS = "{bad";
const FIELD_STEPS: Record<string, Drive> = {
  "custom defaults on": () => {},
  "temperature 0.55": edit("temperature", "0.55"),
  "max tokens 3000": edit("maxTokens", "3000"),
  "top k 2.5": edit("topK", "2.5"),
  "reasoning Low": pick("reasoning", "Low"),
  "verbosity None": pick("verbosity", "None"),
  "tier Flex": pick("tier", "Flex"),
  prefill: (fields) => fields.run({ do: "fill", field: "prefill", text: "<th>" }),
  "custom params": edit("customParameters", '{"top_a": 0.2, "thinking": true}'),
  "add tag": (fields) => fields.run({ do: "click", button: "add-tag" }),
  "tag 1 open": (fields) => fields.run({ do: "fill", field: "tag:1:open", text: "<think>" }),
  "bad custom params": edit("customParameters", BAD_CUSTOM_PARAMETERS),
};
const SAVE_STEPS = new Set(["save", "save 2"]);
// Turning Custom defaults off hides the fields and makes ConnectionEditor save null: caller behavior, not this module.
const CALLER_ONLY_STEPS = new Set(["custom defaults off", "save 3"]);

// Decision 4: after the rejected text, the field keeps it and shows the error. Saving reloads equal stored
// defaults, which is no change, so the text and error stay through "save 2" as well.
const INVALID_JSON = "Invalid JSON. Check quotes, commas, and boolean casing.";
const INTENDED = new Set(["bad custom params", "save 2"]);

function expectedFields(step: ChromeStep): ShownFields {
  const recorded = step.shown.fields!;
  if (!INTENDED.has(step.label)) return recorded;
  return {
    ...recorded,
    values: { ...recorded.values, customParameters: BAD_CUSTOM_PARAMETERS },
    cpNote: INVALID_JSON,
  };
}

/** JSON with object keys sorted at every level, as the store returns saved defaults. */
function sortedJson(value: unknown): string {
  const sort = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sort);
    if (typeof item !== "object" || item === null) return item;
    return Object.fromEntries(
      Object.keys(item)
        .sort()
        .map((key) => [key, sort((item as Record<string, unknown>)[key])]),
    );
  };
  return JSON.stringify(sort(value));
}

function shownFields(fields: FieldsHarness): ShownFields {
  const { values, tags, selected, cpPlaceholder, cpNote, addDisabled } = fields.view.snapshot();
  const options = (group: Group) => fields.view.optionButtons(group)?.map((button) => button.textContent ?? "") ?? [];
  return {
    values,
    tags,
    selected,
    options: { tier: options("tier"), reasoning: options("reasoning"), verbosity: options("verbosity") },
    cpPlaceholder,
    cpNote,
    addDisabled,
  };
}

let harness: FieldsHarness | null = null;

afterEach(() => {
  harness?.unmount();
  harness = null;
});

describe("the connection editor flows replay against the new fields", () => {
  it("has the four recorded connection flows, each step mapped or named as caller-only", () => {
    expect(flows.map((flow) => `${flow.width} ${flow.scheme}`)).toEqual([
      "1366 light",
      "1366 dark",
      "660 light",
      "660 dark",
    ]);
    for (const flow of flows) {
      for (const step of flow.steps) {
        const mapped = step.label in FIELD_STEPS || SAVE_STEPS.has(step.label) || CALLER_ONLY_STEPS.has(step.label);
        expect(mapped, step.label).toBe(true);
      }
    }
  });

  it("lists decision 4 differences only for steps that really differ", () => {
    for (const flow of flows) {
      for (const step of flow.steps.filter((candidate) => INTENDED.has(candidate.label))) {
        expect(expectedFields(step), step.label).not.toEqual(step.shown.fields);
      }
    }
  });

  it.each(flows.map((flow) => [`${flow.width} ${flow.scheme}`, flow] as const))("%s", (_name, flow) => {
    const start = getEditableGenerationParameters(ROLEPLAY_PARAMETER_DEFAULTS, null);
    const fields = new FieldsHarness(start, serviceTierOptionsForProvider("openai"), true);
    harness = fields;
    let saves = 0;
    for (const step of flow.steps) {
      if (CALLER_ONLY_STEPS.has(step.label)) {
        expect(step.shown.fields, step.label).toBeNull();
        continue;
      }
      if (SAVE_STEPS.has(step.label)) {
        saves += 1;
        const stored = step.stored.connectionDefaultParameters;
        expect(stored, step.label).not.toBeNull();
        expect(sortedJson(encode(fields.value)), `${step.label} stores the recorded defaults`).toBe(sortedJson(stored));
        // ConnectionEditor reloads the saved connection: the fields get the stored defaults back, keys sorted.
        const reloaded: EditableGenerationParameters = getEditableGenerationParameters(
          ROLEPLAY_PARAMETER_DEFAULTS,
          stored,
        );
        fields.run({ do: "rerender", patch: { ...reloaded } });
      } else {
        FIELD_STEPS[step.label]!(fields);
      }
      expect(shownFields(fields), `${step.label} shows the recorded fields`).toEqual(expectedFields(step));
    }
    expect(saves).toBe(2);
  });
});
