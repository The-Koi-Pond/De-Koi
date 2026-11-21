import { describe, expect, it } from "vitest";
import {
  NUMBER_FIELD_NAMES,
  replayFieldsScenario,
  type CompactSnapshot,
  type Control,
  type FieldsRecording,
  type FieldsScenario,
  type FieldsStep,
  type FullSnapshot,
} from "./fields-replay-harness";
import choicesJson from "./test-fixtures/recorded-choices.json";
import numbersJson from "./test-fixtures/recorded-numbers.json";
import showJson from "./test-fixtures/recorded-show.json";
import tagsJson from "./test-fixtures/recorded-tags.json";
import textJson from "./test-fixtures/recorded-text.json";

const RECORDINGS: ReadonlyArray<[string, FieldsRecording]> = [
  ["recorded-show.json", showJson as unknown as FieldsRecording],
  ["recorded-numbers.json", numbersJson as unknown as FieldsRecording],
  ["recorded-text.json", textJson as unknown as FieldsRecording],
  ["recorded-tags.json", tagsJson as unknown as FieldsRecording],
  ["recorded-choices.json", choicesJson as unknown as FieldsRecording],
];

const scenarios = RECORDINGS.flatMap(([file, recording]) =>
  recording.scenarios.map((scenario) => ({ file, recording, scenario })),
);

// ── Intended differences, decisions 2 and 3: by rule, in the full snapshots' `controls` ────────────────────
// The old markup named no field and called every trash button "Remove custom thinking tag", and its reasoning
// and verbosity buttons had no `type`. Decision 1 needs no entry: the recorder read selection from the look and
// this harness reads it from `aria-pressed`, so matching recordings prove `aria-pressed` marks the same buttons.

const NUMBER_NAMES = Object.values(NUMBER_FIELD_NAMES);

/** The recorded controls with the names (decision 2) and button types (decision 3) the rebuild adds. */
function withDecisions2And3(recorded: Control[]): Control[] {
  let numbers = 0;
  let textAreas = 0;
  let tagFields = 0;
  let trashButtons = 0;
  return recorded.map((control) => {
    if (control.tag === "input" && control.inputMode === "decimal") {
      return { ...control, name: NUMBER_NAMES[numbers++] };
    }
    if (control.tag === "textarea") {
      return { ...control, name: textAreas++ === 0 ? "Assistant Prefill" : "Custom Parameters" };
    }
    if (control.tag === "input") {
      const row = Math.floor(tagFields / 2) + 1;
      const side = tagFields++ % 2 === 0 ? "open" : "close";
      return { ...control, name: `Custom thinking tag ${row} ${side}` };
    }
    if (control.name === "Remove custom thinking tag") {
      return { ...control, name: `Remove custom thinking tag ${++trashButtons}` };
    }
    if (control.tag === "button" && control.type === undefined) return { ...control, type: "button" };
    return control;
  });
}

// ── Intended differences, decision 4: by scenario id and step ──────────────────────────────────────────────
// After a rejected Custom Parameters blur the rebuild keeps the typed text and shows the error in place of the
// hint, until the next edit. The error texts are the spec's, verbatim.

const INVALID_JSON = "Invalid JSON. Check quotes, commas, and boolean casing.";
const NOT_OBJECT = "Custom parameters must be a JSON object, not an array or scalar.";

type StepExpectation = (recorded: FieldsStep) => Pick<FieldsStep, "calls" | "shown">;

/** The rejected text stays in the field with its error under it; what is handed over is as recorded. */
const keepsRejected =
  (text: string, error: string): StepExpectation =>
  (recorded) => ({
    calls: recorded.calls,
    shown: { ...recorded.shown, values: { ...recorded.shown.values, customParameters: text }, cpNote: error },
  });

/**
 * Leaving the field again with the rejected text still in it rejects it again, so nothing is handed over. The
 * old editor had already put the saved text back, so its second blur handed the saved value over unchanged.
 */
const rejectsAgain =
  (text: string, error: string): StepExpectation =>
  (recorded) => ({ ...keepsRejected(text, error)(recorded), calls: [] });

const REJECTED_ON_BLUR: ReadonlyArray<[string, string]> = [
  ["{'a':1}", INVALID_JSON],
  ["[1]", NOT_OBJECT],
  ["null", NOT_OBJECT],
  ["5", NOT_OBJECT],
  ['"x"', NOT_OBJECT],
  ["{bad", INVALID_JSON],
  ["[True]", NOT_OBJECT],
  ['{"a":1}{"b":2}', INVALID_JSON],
  ['{"a":1,}', INVALID_JSON],
];

const INTENDED: Record<string, Record<number, StepExpectation>> = {
  ...Object.fromEntries(
    REJECTED_ON_BLUR.flatMap(([text, error]) =>
      ["chat", "full"].map((value) => [`cp:${value}:${JSON.stringify(text)}`, { 2: keepsRejected(text, error) }]),
    ),
  ),
  'cp-ignored:"{bad"': { 2: keepsRejected("{bad", INVALID_JSON) },
  'cp-ignored:"[1]"': { 2: keepsRejected("[1]", NOT_OBJECT) },
  "cp-enter-bad:ctrl": { 2: keepsRejected("{bad", INVALID_JSON) },
  "cp-enter-bad:meta": { 2: keepsRejected("{bad", INVALID_JSON) },
  "cp-bad-twice": {
    2: keepsRejected("{bad", INVALID_JSON),
    3: keepsRejected("{bad", INVALID_JSON),
    4: rejectsAgain("{bad", INVALID_JSON),
  },
  "cp-edit-clears-error": {
    2: keepsRejected("{bad", INVALID_JSON),
    3: keepsRejected("{bad", INVALID_JSON),
  },
};

function expectedStep(scenario: FieldsScenario, index: number): Pick<FieldsStep, "calls" | "shown"> {
  const recorded = scenario.steps[index]!;
  const intended = INTENDED[scenario.id]?.[index];
  return intended ? intended(recorded) : { calls: recorded.calls, shown: recorded.shown };
}

function expectedStart(scenario: FieldsScenario): CompactSnapshot | FullSnapshot {
  const start = scenario.start;
  return "controls" in start ? { ...start, controls: withDecisions2And3(start.controls) } : start;
}

describe("GenerationParametersFields replays the recorded old fields", () => {
  it("covers every recorded scenario and step", () => {
    expect(scenarios).toHaveLength(45 + 204 + 55 + 15 + 50);
    expect(scenarios.reduce((sum, { scenario }) => sum + scenario.steps.length, 0)).toBe(648 + 165 + 76 + 105);
  });

  it("lists decision 4 differences only for steps that exist and really differ", () => {
    let entries = 0;
    for (const [id, steps] of Object.entries(INTENDED)) {
      const found = scenarios.find(({ scenario }) => scenario.id === id);
      expect(found, id).toBeDefined();
      for (const key of Object.keys(steps)) {
        entries += 1;
        const index = Number(key);
        const recorded = found!.scenario.steps[index];
        expect(recorded, `${id} ${index}`).toBeDefined();
        expect(expectedStep(found!.scenario, index), `${id} ${index} differs from the recording`).not.toEqual({
          calls: recorded!.calls,
          shown: recorded!.shown,
        });
      }
    }
    expect(entries).toBe(2 * REJECTED_ON_BLUR.length + 4 + 3 + 2);
  });

  it("names every rejected Custom Parameters blur in the recordings as a decision 4 difference", () => {
    for (const { scenario } of scenarios) {
      scenario.steps.forEach((step, index) => {
        const before = index === 0 ? scenario.start : scenario.steps[index - 1]!.shown;
        const leftField =
          (step.action.do === "blur" || (step.action.do === "key" && (step.action.ctrl || step.action.meta))) &&
          step.action.field === "customParameters";
        const typed = before.values.customParameters !== step.shown.values.customParameters;
        if (leftField && typed && step.calls.length === 0) {
          expect(INTENDED[scenario.id]?.[index], `${scenario.id} ${index}`).toBeDefined();
        }
      });
    }
  });

  it("changes only names and button types in the full snapshots' controls, and each change is needed", () => {
    const shown = scenarios.filter(({ scenario }) => "controls" in scenario.start);
    expect(shown).toHaveLength(45);
    for (const { scenario } of shown) {
      const recorded = (scenario.start as FullSnapshot).controls;
      const expected = withDecisions2And3(recorded);
      expected.forEach((control, index) => {
        const before = recorded[index]!;
        if (control === before) return;
        expect(control, `${scenario.id} control ${index} really changes`).not.toEqual(before);
        expect({ ...control, name: before.name, type: before.type }, `${scenario.id} control ${index}`).toEqual(before);
      });
    }
  });

  it.each(scenarios.map(({ file, recording, scenario }) => [`${file} ${scenario.id}`, recording, scenario] as const))(
    "%s",
    (_name, recording: FieldsRecording, scenario: FieldsScenario) => {
      const result = replayFieldsScenario(recording, scenario);
      expect(result.start, `${scenario.id} start`).toEqual(expectedStart(scenario));
      result.steps.forEach((actual, index) => {
        const label = `${scenario.id} step ${index} ${JSON.stringify(scenario.steps[index]!.action)}`;
        const expected = expectedStep(scenario, index);
        expect(actual, label).toEqual(expected);
        expect(JSON.stringify(actual.calls), `${label} (key order)`).toBe(JSON.stringify(expected.calls));
      });
    },
  );
});
