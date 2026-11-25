import { describe, expect, it } from "vitest";
import {
  replayScenario,
  type Recording,
  type Scenario,
  type Shown,
  type StepRecord,
} from "./avatar-crop-replay-harness";
import dragLandscape from "./test-fixtures/recorded-drag-landscape.json";
import dragOdd from "./test-fixtures/recorded-drag-odd.json";
import dragPortrait from "./test-fixtures/recorded-drag-portrait.json";
import dragSmall from "./test-fixtures/recorded-drag-small.json";
import dragSquare from "./test-fixtures/recorded-drag-square.json";
import dragTiny from "./test-fixtures/recorded-drag-tiny.json";
import dragWide from "./test-fixtures/recorded-drag-wide.json";
import init1 from "./test-fixtures/recorded-init-1.json";
import init2 from "./test-fixtures/recorded-init-2.json";
import special from "./test-fixtures/recorded-special.json";

const RECORDINGS: ReadonlyArray<[string, unknown]> = [
  ["recorded-init-1.json", init1],
  ["recorded-init-2.json", init2],
  ["recorded-drag-landscape.json", dragLandscape],
  ["recorded-drag-odd.json", dragOdd],
  ["recorded-drag-portrait.json", dragPortrait],
  ["recorded-drag-small.json", dragSmall],
  ["recorded-drag-square.json", dragSquare],
  ["recorded-drag-tiny.json", dragTiny],
  ["recorded-drag-wide.json", dragWide],
  ["recorded-special.json", special],
];

const scenarios = RECORDINGS.flatMap(([file, recording]) =>
  (recording as Recording).scenarios.map((scenario) => ({ file, scenario })),
);

// ── Intended changes: decisions 1 and 2 only ────────────────────────────────────────────────────────────────

/** Decision 1: the full view's close button gets a type and a name. The old button had neither. */
const CLOSE_TYPE = "button";
const CLOSE_LABEL = "Close full image";

/** The old close button as the recordings show it (no text, title, type or label). */
const isOldCloseButton = (b: { text: string; title: string | null; type: string | null; label: string | null }) =>
  b.text === "" && b.title === null && b.type === null && b.label === null;

/** Applies decision 1 to a recorded snapshot with the full view open. Null when the view is closed. */
function nameCloseButton(shown: Shown): Shown | null {
  if (!shown.full) return null;
  const close = shown.full.close;
  expect(close, "recorded close button").toEqual({ text: "", type: null, label: null });
  const buttons = shown.buttons ?? [];
  expect(buttons.filter(isOldCloseButton), "one recorded close button").toHaveLength(1);
  return {
    ...shown,
    buttons: buttons.map((b) => (isOldCloseButton(b) ? { ...b, type: CLOSE_TYPE, label: CLOSE_LABEL } : b)),
    full: { ...shown.full, close: { text: "", type: CLOSE_TYPE, label: CLOSE_LABEL } },
  };
}

/** The snapshot with the full view closed: no close button, no full-view picture (the last one). */
function withoutFullView(shown: Shown): Shown {
  expect(shown.full, "the recorded full view is open").not.toBeNull();
  return {
    ...shown,
    buttons: (shown.buttons ?? []).filter((b) => !isOldCloseButton(b)),
    images: (shown.images ?? []).slice(0, -1),
    full: null,
  };
}

type StepChange = (recorded: StepRecord) => StepRecord;

/**
 * Decision 2: Escape closes the open full view (topmost overlay) and the key is marked handled. In `full:keys`
 * (open, Escape, Enter, open again) the old view stayed open through Escape and Enter.
 */
const ESCAPE_CLOSES: Record<string, Record<number, StepChange>> = {
  "full:keys": {
    1: (recorded) => ({
      ...recorded,
      events: [{ type: "keydown", prevented: true }],
      shown: withoutFullView(recorded.shown),
    }),
    2: (recorded) => ({ ...recorded, shown: withoutFullView(recorded.shown) }),
  },
};

const used = { closeNamed: 0, escape: 0 };
/** Recorded snapshots (start or step) with the full view open, outside the decision 2 steps. */
const CLOSE_NAMED_SNAPSHOTS = 18;

function expectedStart(scenario: Scenario): StepRecord {
  const named = nameCloseButton(scenario.start.shown);
  if (named) used.closeNamed += 1;
  return named ? { ...scenario.start, shown: named } : scenario.start;
}

function expectedStep(scenario: Scenario, index: number): StepRecord {
  const recorded = scenario.steps[index]!;
  const escape = ESCAPE_CLOSES[scenario.id]?.[index];
  if (escape) {
    used.escape += 1;
    const expected = escape(recorded);
    expect(expected, `${scenario.id} ${index}: the decision 2 change differs from the recording`).not.toEqual(recorded);
    return expected;
  }
  const named = nameCloseButton(recorded.shown);
  if (!named) return recorded;
  used.closeNamed += 1;
  return { ...recorded, shown: named };
}

/** Crashed steps compare by presence: the shown snapshot is `{ crashed: true }` either way. */
function comparable(step: StepRecord): StepRecord {
  return step.shown.crashed ? { ...step, shown: { crashed: true } } : step;
}

// ── Tests ───────────────────────────────────────────────────────────────────────────────────────────────────

describe("AvatarCropWidget replays the recorded old widget", () => {
  it("covers every recorded scenario and step", () => {
    expect(scenarios).toHaveLength(1073);
    expect(scenarios.reduce((sum, { scenario }) => sum + scenario.steps.length, 0)).toBe(4768);
  });

  it("lists decision 2 changes only for Escape steps that exist", () => {
    for (const [id, steps] of Object.entries(ESCAPE_CLOSES)) {
      const found = scenarios.find(({ scenario }) => scenario.id === id);
      expect(found, id).toBeDefined();
      const recorded = found!.scenario.steps;
      const firstEscape = recorded.findIndex((s) => s.action.do === "key" && s.action.key === "Escape");
      for (const key of Object.keys(steps)) {
        const index = Number(key);
        expect(recorded[index], `${id} ${index}`).toBeDefined();
        expect(index, `${id} ${index} is at or after the Escape`).toBeGreaterThanOrEqual(firstEscape);
        expect(firstEscape, id).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("uses every intended change, and each one really changes the recording", () => {
    used.closeNamed = 0;
    used.escape = 0;
    for (const { scenario } of scenarios) {
      expectedStart(scenario);
      scenario.steps.forEach((_step, index) => expectedStep(scenario, index));
    }
    const escapeEntries = Object.values(ESCAPE_CLOSES).reduce((sum, steps) => sum + Object.keys(steps).length, 0);
    expect(used.escape).toBe(escapeEntries);
    expect(used.closeNamed).toBe(CLOSE_NAMED_SNAPSHOTS);
  });

  it.each(scenarios.map(({ file, scenario }) => [`${file} ${scenario.id}`, scenario] as const))(
    "%s",
    async (_name, scenario: Scenario) => {
      const result = await replayScenario(scenario);
      expect(comparable(result.start), `${scenario.id} start`).toEqual(comparable(expectedStart(scenario)));
      expect(result.steps).toHaveLength(scenario.steps.length);
      result.steps.forEach((actual, index) => {
        const label = `${scenario.id} step ${index} ${JSON.stringify(scenario.steps[index]!.action)}`;
        expect(comparable(actual), label).toEqual(comparable(expectedStep(scenario, index)));
      });
    },
  );
});
