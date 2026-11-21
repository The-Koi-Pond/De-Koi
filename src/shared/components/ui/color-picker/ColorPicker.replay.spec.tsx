import { describe, expect, it } from "vitest";
import {
  PickerHarness,
  replayScenario,
  type Recording,
  type RecordedStep,
  type Scenario,
  type Snapshot,
} from "./color-picker-replay-harness";
import gradientJson from "./test-fixtures/recorded-gradient.json";
import showJson from "./test-fixtures/recorded-show.json";
import solidJson from "./test-fixtures/recorded-solid.json";

const RECORDINGS: ReadonlyArray<[string, Recording]> = [
  ["recorded-show.json", showJson as unknown as Recording],
  ["recorded-solid.json", solidJson as unknown as Recording],
  ["recorded-gradient.json", gradientJson as unknown as Recording],
];

const scenarios = RECORDINGS.flatMap(([file, recording]) =>
  recording.scenarios.map((scenario) => ({ file, recording, scenario })),
);

// ── Step expectations that the decisions change on purpose ─────────────────────────
// Decisions 1 and 2 only add `aria-pressed` and Clear's accessible name. The recorder read selection from
// the highlight and found Clear by its text, and this harness reads selection from `aria-pressed`, so
// matching recordings already prove both are set where the old picker highlighted.

type StepExpectation = (recorded: RecordedStep, before: Snapshot) => Pick<RecordedStep, "calls" | "shown">;

/**
 * Decision 3: clicking the mode button that is already selected hands nothing over, so nothing changes
 * either: the picker shows what it showed before the click, with or without a caller that hands back.
 */
const selectedModeHandsNothing: StepExpectation = (_recorded, before) => ({ calls: [], shown: before });

/** Every intended difference, by scenario id and step index. Nothing else may differ. */
const INTENDED: Record<string, Record<number, StepExpectation>> = {
  // Gradient while already in gradient mode, after the caller emptied the value.
  "outside:empty-then-grad-btn": { 2: selectedModeHandsNothing },
  // Solid while already in solid mode (the old picker handed over the first stop, "#ff6b6b").
  "act:name:empty:solid-btn:back": { 1: selectedModeHandsNothing },
  "act:name:empty:solid-btn:ignore": { 1: selectedModeHandsNothing },
  "act:name:preset:solid-btn:back": { 1: selectedModeHandsNothing },
  "act:name:preset:solid-btn:ignore": { 1: selectedModeHandsNothing },
  "act:name:named:solid-btn:back": { 1: selectedModeHandsNothing },
  "act:name:named:solid-btn:ignore": { 1: selectedModeHandsNothing },
  "act:paint:empty:solid-btn:back": { 1: selectedModeHandsNothing },
  "act:paint:empty:solid-btn:ignore": { 1: selectedModeHandsNothing },
  "act:paint:preset:solid-btn:back": { 1: selectedModeHandsNothing },
  "act:paint:preset:solid-btn:ignore": { 1: selectedModeHandsNothing },
  // Gradient while already in gradient mode (the old picker rewrote the value in its own format).
  "act:name:grad2:gradient-btn:back": { 1: selectedModeHandsNothing },
  "act:name:grad2:gradient-btn:ignore": { 1: selectedModeHandsNothing },
  "act:name:grad3:gradient-btn:back": { 1: selectedModeHandsNothing },
  "act:name:grad3:gradient-btn:ignore": { 1: selectedModeHandsNothing },
  "act:name:toRight:gradient-btn:back": { 1: selectedModeHandsNothing },
  "act:name:toRight:gradient-btn:ignore": { 1: selectedModeHandsNothing },
  "act:name:noAngle:gradient-btn:back": { 1: selectedModeHandsNothing },
  "act:name:noAngle:gradient-btn:ignore": { 1: selectedModeHandsNothing },
  "act:name:rgbStops:gradient-btn:back": { 1: selectedModeHandsNothing },
  "act:name:rgbStops:gradient-btn:ignore": { 1: selectedModeHandsNothing },
  "act:paint:grad2:gradient-btn:back": { 1: selectedModeHandsNothing },
  "act:paint:grad2:gradient-btn:ignore": { 1: selectedModeHandsNothing },
};

function snapshotBefore(scenario: Scenario, index: number): Snapshot | undefined {
  return index === 0 ? scenario.start : scenario.steps[index - 1]!.shown;
}

function expectedStep(scenario: Scenario, index: number): Pick<RecordedStep, "calls" | "shown"> {
  const recorded = scenario.steps[index]!;
  const intended = INTENDED[scenario.id]?.[index];
  return intended
    ? intended(recorded, snapshotBefore(scenario, index)!)
    : { calls: recorded.calls, shown: recorded.shown };
}

/** A click on the mode button the recording shows as already selected. */
function isSelectedModeClick(scenario: Scenario, index: number): boolean {
  const { action } = scenario.steps[index]!;
  if (action.do !== "click" || !("text" in action)) return false;
  const mode = action.text === "Solid" ? "solid" : action.text === "Gradient" ? "gradient" : null;
  return mode !== null && snapshotBefore(scenario, index)?.switch?.[mode].selected === true;
}

describe("ColorPicker replays the recorded old picker", () => {
  it("covers every recorded scenario and step", () => {
    expect(scenarios).toHaveLength(568);
    expect(scenarios.reduce((sum, { scenario }) => sum + scenario.steps.length, 0)).toBe(1186);
  });

  it("lists only intended differences for steps that exist and really differ", () => {
    for (const [id, steps] of Object.entries(INTENDED)) {
      const found = scenarios.find(({ scenario }) => scenario.id === id);
      expect(found, id).toBeDefined();
      for (const key of Object.keys(steps)) {
        const index = Number(key);
        const recorded = found!.scenario.steps[index];
        expect(recorded, `${id} ${index}`).toBeDefined();
        expect(isSelectedModeClick(found!.scenario, index), `${id} ${index} is a selected-mode click`).toBe(true);
        const expected = expectedStep(found!.scenario, index);
        expect(expected, `${id} ${index} differs from the recording`).not.toEqual({
          calls: recorded!.calls,
          shown: recorded!.shown,
        });
      }
    }
  });

  it("names every recorded selected-mode click as a decision 3 difference", () => {
    let clicks = 0;
    for (const { scenario } of scenarios) {
      scenario.steps.forEach((_step, index) => {
        if (!isSelectedModeClick(scenario, index)) return;
        clicks += 1;
        expect(INTENDED[scenario.id]?.[index], `${scenario.id} ${index}`).toBeDefined();
      });
    }
    expect(clicks).toBe(Object.values(INTENDED).reduce((sum, steps) => sum + Object.keys(steps).length, 0));
  });

  it.each(scenarios.map(({ file, recording, scenario }) => [`${file} ${scenario.id}`, recording, scenario] as const))(
    "%s",
    (_name, recording: Recording, scenario: Scenario) => {
      const result = replayScenario(recording, scenario);
      if (scenario.start) expect(result.start, `${scenario.id} start`).toEqual(scenario.start);
      result.steps.forEach((actual, index) => {
        const label = `${scenario.id} step ${index} ${JSON.stringify(scenario.steps[index]!.action)}`;
        expect(actual, label).toEqual(expectedStep(scenario, index));
      });
    },
  );
});

describe("ColorPicker names its presets as recorded", () => {
  const names = (showJson as unknown as Recording).names!;

  it("names and titles every solid preset, and names every gradient preset", () => {
    const harness = new PickerHarness({ label: "Name Display Color", gradient: true }, "", true);
    try {
      harness.run({ do: "toggle" });
      const solid = [...harness.element.querySelectorAll("button[title]")].map((button) => [
        button.getAttribute("aria-label"),
        button.getAttribute("title"),
      ]);
      expect(solid).toEqual(names.solid);
      harness.run({ do: "click", text: "Gradient" });
      const gradient = [...harness.element.querySelectorAll("button[aria-label^='Use gradient preset']")].map(
        (button) => button.getAttribute("aria-label"),
      );
      expect(gradient).toEqual(names.gradient);
    } finally {
      harness.unmount();
    }
  });
});

describe("ColorPicker hands nothing over while disabled", () => {
  const disabledScenarios = scenarios.filter(
    ({ recording, scenario }) =>
      recording.props[scenario.props]!.disabled || scenario.id.startsWith("disable-while-open"),
  );

  it("has disabled scenarios to check", () => {
    expect(disabledScenarios.length).toBeGreaterThan(30);
  });

  it.each(disabledScenarios.map(({ recording, scenario }) => [scenario.id, recording, scenario] as const))(
    "%s",
    (_id, recording: Recording, scenario: Scenario) => {
      const result = replayScenario(recording, scenario);
      expect(result.steps.flatMap((step) => step.calls)).toEqual([]);
    },
  );
});
