import { describe, expect, it, vi } from "vitest";
import {
  replayScenario,
  type ButtonSnapshot,
  type Recording,
  type Scenario,
  type Snapshot,
  type StepResult,
} from "./regex-editor-replay-harness";
import actionsJson from "./test-fixtures/recorded-actions.json";
import showJson from "./test-fixtures/recorded-show.json";

vi.mock("../../../../../shared/api/storage-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  storageApi: (await import("./fake-regex-storage")).fakeStorageApi,
}));
vi.mock("../../../../../shared/lib/app-dialogs", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  showConfirmDialog: (await import("./fake-regex-storage")).fakeConfirmDialog,
}));

const RECORDINGS: ReadonlyArray<[string, Recording]> = [
  ["recorded-show.json", showJson as unknown as Recording],
  ["recorded-actions.json", actionsJson as unknown as Recording],
];

const scenarios = RECORDINGS.flatMap(([file, recording]) =>
  recording.scenarios.map((scenario) => ({ file, recording, scenario })),
);

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

function snapshotOf(result: StepResult): Snapshot {
  if ("error" in result) throw new Error(`Step ${JSON.stringify(result.step)} failed: ${result.error}`);
  const { step: _step, ...snapshot } = result;
  return snapshot;
}

// ── Decision 5: toggles are announced ───────────────────────────────────────────
// The recorder saw no state attributes on these controls. The rebuild adds them on purpose, so each one
// is checked here against the state the recording shows and then set aside; every other field must match.
const FLAG_TEXTS = new Set(["g", "i", "m", "s", "u"]);
const PLACE_TEXTS = new Set([
  "AI OutputApplied to AI responses before they are displayed.",
  "User InputApplied to your messages before they are sent.",
]);

function setAsideDecision5(actual: ButtonSnapshot[], recorded: ButtonSnapshot[]): ButtonSnapshot[] {
  return actual.map((button, index) => {
    const before = recorded[index];
    const next = { ...button };
    const pressable =
      FLAG_TEXTS.has(button.text) || PLACE_TEXTS.has(button.text) || button.text === "Global" || "checked" in button;
    if (pressable && before && !("aria-pressed" in before)) {
      // D5: flag, Apply To, Global and character buttons get aria-pressed matching what they show.
      expect(button["aria-pressed"], `aria-pressed on "${button.text}"`).toBe(String(button.selected === true));
      delete next["aria-pressed"];
    }
    if (button.icon && before && !("aria-label" in before)) {
      // D5: the on/off switch is labelled "Enabled" (its role and aria-checked are tested separately).
      expect(button["aria-label"]).toBe("Enabled");
      delete next["aria-label"];
    }
    if (button["aria-label"] === "Remove trim string" && before && before.text === "" && !("aria-label" in before)) {
      // D5: the trim row's X is labelled.
      delete next["aria-label"];
    }
    return next;
  });
}

// ── Step expectations that decisions 1 to 4 change on purpose ──────────────────────

/** The recorded snapshot with the Live Test text and result still showing. */
function withLiveTest(recorded: Snapshot, liveText: string, result: string): Snapshot {
  const marker = "Live TestAbout Regex Scripts";
  expect(recorded.text).toContain(marker);
  return {
    ...recorded,
    text: collapse(recorded.text.replace(marker, () => `Live Test${liveText}Result:${result}About Regex Scripts`)),
    inputs: recorded.inputs.map((input) => (input.tag === "textarea" ? { ...input, value: liveText } : input)),
    result,
  };
}

/** A snapshot with the save error banner added under the header, and the header status it implies. */
function withErrorBanner(base: Snapshot, message: string, status: "Save failed" | null): Snapshot {
  const header = /^(?:Unsaved |Saved |Saving |Save failed )?((?:Delete )?Save)/;
  expect(base.text).toMatch(header);
  const saveIndex = base.buttons.findIndex((button) => button.text === "Save");
  return {
    ...base,
    text: base.text.replace(header, (_whole, buttons: string) => `${status ? `${status} ` : ""}${buttons}${message}`),
    buttons: [...base.buttons.slice(0, saveIndex + 1), { text: "" }, ...base.buttons.slice(saveIndex + 1)],
  };
}

/** The recorded banner showed the schema's raw JSON; the rebuild shows one plain sentence instead. */
function withPlainValidation(recorded: Snapshot, message: string): Snapshot {
  const raw = /\[ \{ "origin".*\} \](?=Find Pattern \(Regex\))/;
  expect(recorded.text).toMatch(raw);
  return { ...recorded, text: recorded.text.replace(raw, () => message) };
}

type StepExpectation = (recorded: Snapshot, steps: Snapshot[]) => Snapshot;

const NAME_MISSING = "Give the script a name.";
const NAME_TOO_LONG = "Keep the name to 200 characters or fewer.";
const PATTERN_MISSING = "Add a find pattern.";
const PLACE_MISSING = "Pick where it applies: AI Output, User Input or both.";

/** Every intended difference, by scenario id and step index. Nothing else may differ. */
const INTENDED: Record<string, Record<number, StepExpectation>> = {
  // D1: Save & close stays open after a failed save, with the error banner and without the unsaved bar.
  "back:save-close-fails": {
    4: (recorded, steps) => ({
      ...withErrorBanner(steps[1]!, "nope", "Save failed"),
      store: { regexDetailId: "rx-1", editorDirty: true },
      calls: recorded.calls,
    }),
  },
  // D2: a save reloads the same script, which keeps the Live Test text and its result.
  "edit:all-controls": {
    41: (recorded) => withLiveTest(recorded, "foobar foo FOO", "<foo> <foo> FOO"),
    42: (recorded) => withLiveTest(recorded, "foobar foo FOO", "<foo> <foo> FOO"),
  },
  "save:clears-live-test": {
    3: (recorded) => withLiveTest(recorded, "*hi*", "hi"),
  },
  // D2: creating the script opens it as the stored script, the same one being edited, so the text stays.
  "new:create-then-update": {
    3: (recorded) => withLiveTest(recorded, "xxx y", " y"),
    4: (recorded) => withLiveTest(recorded, "xxx y", " y"),
    5: (recorded) => withLiveTest(recorded, "xxx y", " y"),
  },
  // D3: a failed delete shows in the error banner (not as "Save failed") and the editor stays open.
  "delete:fails": {
    3: (recorded) => withErrorBanner(recorded, "Couldn't delete: locked", null),
  },
  // D4: plain validation messages, checked before anything is sent, in the spec's order.
  "new:save-empty-pattern": {
    1: (recorded) => withPlainValidation(recorded, PATTERN_MISSING),
    2: (recorded) => withPlainValidation(recorded, PATTERN_MISSING),
    3: (recorded) => withPlainValidation(recorded, NAME_MISSING),
  },
  "new:save-empty-name": {
    3: (recorded) => withPlainValidation(recorded, NAME_MISSING),
  },
  "new:save-long-name": {
    3: (recorded) => withPlainValidation(recorded, NAME_TOO_LONG),
  },
  "save:empty-placement-row": {
    1: (recorded) => withPlainValidation(recorded, PLACE_MISSING),
    2: (recorded) => withPlainValidation(recorded, PLACE_MISSING),
  },
};

// D3: the old editor left the failed delete as an unhandled rejection; the rebuild handles it.
const INTENDED_UNHANDLED: Record<string, string[]> = { "delete:fails": [] };

describe("RegexScriptEditor replays the recorded old editor", () => {
  it("covers every recorded scenario and step", () => {
    expect(scenarios).toHaveLength(107);
    expect(scenarios.reduce((sum, { scenario }) => sum + scenario.steps.length, 0)).toBe(304);
  });

  it("lists only intended differences for steps that exist", () => {
    for (const [id, steps] of Object.entries(INTENDED)) {
      const found = scenarios.find(({ scenario }) => scenario.id === id);
      expect(found, id).toBeDefined();
      for (const index of Object.keys(steps))
        expect(found!.scenario.steps[Number(index)], `${id} ${index}`).toBeDefined();
    }
  });

  it("names every recorded raw schema message as a decision 4 difference", () => {
    for (const { scenario } of scenarios) {
      scenario.steps.forEach((step, index) => {
        if ("text" in step && step.text.includes('"origin"'))
          expect(INTENDED[scenario.id]?.[index], `${scenario.id} ${index}`).toBeDefined();
      });
    }
  });

  it.each(scenarios.map(({ file, recording, scenario }) => [`${file} ${scenario.id}`, recording, scenario] as const))(
    "%s",
    async (_name, recording: Recording, scenario: Scenario) => {
      const { results, unhandled } = await replayScenario(recording, scenario);
      const recordedSnapshots = scenario.steps.map((step) => ("error" in step ? null : snapshotOf(step)));
      results.forEach((result, index) => {
        const recorded = scenario.steps[index]!;
        const label = `${scenario.id} step ${index} ${JSON.stringify(recorded.step)}`;
        if ("error" in recorded) {
          expect("error" in result, label).toBe(true);
          return;
        }
        const recordedSnapshot = snapshotOf(recorded);
        const intended = INTENDED[scenario.id]?.[index];
        const expected = intended ? intended(recordedSnapshot, recordedSnapshots as Snapshot[]) : recordedSnapshot;
        const actual = snapshotOf(result);
        expect({ ...actual, buttons: setAsideDecision5(actual.buttons, expected.buttons) }, label).toEqual(expected);
      });
      expect(unhandled).toEqual(INTENDED_UNHANDLED[scenario.id] ?? scenario.unhandled);
    },
    20_000,
  );
});

// ── The data contract: what reaches storage ───────────────────────────────────────

function saves(calls: unknown[][]) {
  return calls.filter((call) => call[0] === "create" || call[0] === "update" || call[0] === "delete");
}

const scenariosWithSaves = scenarios.filter(({ scenario }) =>
  scenario.steps.some((step) => "calls" in step && saves(step.calls).length > 0),
);

describe("RegexScriptEditor sends exactly the recorded rows", () => {
  it("has saves to check", () => {
    expect(scenariosWithSaves.length).toBeGreaterThan(20);
  });

  it.each(scenariosWithSaves.map(({ recording, scenario }) => [scenario.id, recording, scenario] as const))(
    "%s: every create, update and delete payload, field for field and in order",
    async (_id, recording: Recording, scenario: Scenario) => {
      const { results } = await replayScenario(recording, scenario);
      const recordedSaves = scenario.steps.flatMap((step) => ("calls" in step ? saves(step.calls) : []));
      const actualSaves = results.flatMap((step) => ("calls" in step ? saves(step.calls) : []));
      expect(actualSaves.map((call) => JSON.stringify(call))).toEqual(
        recordedSaves.map((call) => JSON.stringify(call)),
      );
    },
    20_000,
  );
});
