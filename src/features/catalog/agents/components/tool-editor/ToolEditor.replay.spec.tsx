import { describe, expect, it, vi } from "vitest";
import {
  replayScenario,
  type ButtonSnapshot,
  type FieldSnapshot,
  type Recording,
  type Scenario,
  type Snapshot,
  type StepResult,
} from "./tool-editor-replay-harness";
import { parameterRowNotes, type ToolParameter } from "./tool-form";
import actionsJson from "./test-fixtures/recorded-actions.json";
import showJson from "./test-fixtures/recorded-show.json";

vi.mock("../../../../../shared/api/storage-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  storageApi: (await import("./fake-tool-storage")).fakeStorageApi,
}));
vi.mock("../../../../../shared/lib/app-dialogs", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  showConfirmDialog: (await import("./fake-tool-storage")).fakeConfirmDialog,
}));

const RECORDINGS: ReadonlyArray<[string, Recording]> = [
  ["recorded-show.json", showJson as unknown as Recording],
  ["recorded-actions.json", actionsJson as unknown as Recording],
];

const scenarios = RECORDINGS.flatMap(([file, recording]) =>
  recording.scenarios.map((scenario) => ({ file, recording, scenario })),
);

function snapshotOf(result: StepResult): Snapshot {
  if ("error" in result) throw new Error(`Step ${JSON.stringify(result.step)} failed: ${result.error}`);
  const { step: _step, ...snapshot } = result;
  return snapshot;
}

// ── Decision 6: controls are announced ─────────────────────────────────────────────
// The recorder saw no names or pressed state on these controls. The rebuild adds them on purpose, so each
// one is checked here against what the step shows and then set aside; every other attribute must match.
const STATIC_NOTE = "Returns a fixed string when called.";
const FIELD_LABELS: Record<string, string> = {
  tool_name: "Tool name",
  param_name: "Parameter name",
  "Description of this parameter…": "Parameter description",
};

function setAsideDecision6Fields(actual: FieldSnapshot[], recorded: FieldSnapshot[]): FieldSnapshot[] {
  return actual.map((field, index) => {
    const before = recorded[index];
    if (!("aria-label" in field) || !before || "aria-label" in before) return field;
    const expected = field.tag === "select" ? "Parameter type" : FIELD_LABELS[field.placeholder ?? ""];
    expect(field["aria-label"], `aria-label on field ${index}`).toBe(expected);
    const { "aria-label": _label, ...rest } = field;
    return rest;
  });
}

function setAsideDecision6Buttons(actual: ButtonSnapshot[], recorded: ButtonSnapshot[], text: string) {
  const staticSelected = text.includes(`Webhook${STATIC_NOTE}`);
  return actual.map((button, index) => {
    const before = recorded[index];
    const next = { ...button };
    if ("aria-pressed" in button && before && !("aria-pressed" in before)) {
      // D6: Static Result and Webhook say which one is selected.
      const pressed = button.text === "Static Result" ? staticSelected : !staticSelected;
      expect(button["aria-pressed"], `aria-pressed on "${button.text}"`).toBe(String(pressed));
      delete next["aria-pressed"];
    }
    if (button["aria-label"] === "Remove parameter" && before && before.text === "" && !("aria-label" in before)) {
      // D6: the minus button is named.
      delete next["aria-label"];
    }
    return next;
  });
}

// ── Step expectations that decisions 1 to 5 change on purpose ──────────────────────

type StepExpectation = (recorded: Snapshot) => Snapshot;

const UNSAVED_BAR = "You have unsaved changes.Keep editingDiscardSave & close";
const BAR_BUTTONS = new Set(["Keep editing", "Discard", "Save & close"]);

/** D2: the unsaved bar is gone. */
function withoutUnsavedBar(recorded: Snapshot): Snapshot {
  expect(recorded.text).toContain(UNSAVED_BAR);
  return {
    ...recorded,
    text: recorded.text.replace(UNSAVED_BAR, ""),
    buttons: recorded.buttons.filter((button) => !BAR_BUTTONS.has(button.text)),
  };
}

/** D3: the error banner under the header, with its dismiss button; the header's status is unchanged. */
function withDeleteBanner(recorded: Snapshot, message: string): Snapshot {
  const header = "Delete Save";
  expect(recorded.text.startsWith(header)).toBe(true);
  const saveIndex = recorded.buttons.findIndex((button) => button.text === "Save");
  return {
    ...recorded,
    text: `${header}${message}${recorded.text.slice(header.length)}`,
    buttons: [...recorded.buttons.slice(0, saveIndex + 1), { text: "" }, ...recorded.buttons.slice(saveIndex + 1)],
  };
}

/** D4: the recorded banner showed the schema's raw JSON; the rebuild shows one plain sentence instead. */
function withPlainValidation(recorded: Snapshot, message: string): Snapshot {
  const raw = /\[ \{ ".*\} \](?=Tool name must be lowercase)/;
  expect(recorded.text).toMatch(raw);
  return { ...recorded, text: recorded.text.replace(raw, () => message) };
}

/** D1 and D5: the update payload sent at this step. */
function withUpdatePayload(recorded: Snapshot, payload: Record<string, unknown>): Snapshot {
  const updates = recorded.calls.filter((call) => call[0] === "update");
  expect(updates).toHaveLength(1);
  return {
    ...recorded,
    calls: recorded.calls.map((call) => (call[0] === "update" ? [...call.slice(0, 3), payload] : call)),
  };
}

/** D1: the recorded update with `enabled` as the stored row has it. */
function withEnabled(recorded: Snapshot, enabled: boolean): Snapshot {
  const update = recorded.calls.find((call) => call[0] === "update")!;
  return withUpdatePayload(recorded, { ...(update[3] as Record<string, unknown>), enabled });
}

const TYPE_OPTIONS = "stringnumberbooleanarrayobject";

/** D5: the `intval` row (stored type `integer`) shows its type as a sixth option, selected. */
function withIntegerOption(recorded: Snapshot): Snapshot {
  const nameIndex = recorded.fields.findIndex(
    (field) => field.placeholder === "param_name" && field.value === "intval",
  );
  expect(nameIndex).toBeGreaterThan(-1);
  const select = recorded.fields[nameIndex + 1]!;
  // The old editor showed the unknown type as the first option.
  expect(select).toMatchObject({ tag: "select", value: "string", selectedIndex: 0 });
  const rowIndex = recorded.fields.slice(0, nameIndex).filter((field) => field.placeholder === "param_name").length;
  let seen = -1;
  const text = recorded.text.replace(new RegExp(`${TYPE_OPTIONS}Required`, "g"), (match) => {
    seen += 1;
    return seen === rowIndex ? `${TYPE_OPTIONS}integerRequired` : match;
  });
  return {
    ...recorded,
    text,
    fields: recorded.fields.map((field, index) =>
      index === nameIndex + 1
        ? { ...field, value: "integer", selectedIndex: 5, options: [...(field.options ?? []), "integer"] }
        : field,
    ),
  };
}

const EXTRAS_SCHEMA_PROPERTIES = {
  unit: { type: "string", description: "Unit", enum: ["c", "f"], default: "c" },
  tags: { type: "array", description: "", items: { type: "string" } },
  notype: { type: "string", description: "No type here" },
  nodesc: { type: "boolean", description: "" },
  intval: { type: "integer", description: "An integer" },
  nested: { type: "object", description: "", properties: { a: { type: "string" } } },
};

/** D5: tool-15 saved with every stored key kept, in stored order after the editor's own. */
function extrasPayload(properties: Record<string, unknown>) {
  return {
    name: "check_weather",
    description: "Looks up the weather for a city.",
    parametersSchema: {
      type: "object",
      properties,
      required: ["unit", "intval"],
      description: "top-level note",
      additionalProperties: false,
    },
    executionType: "static",
    webhookUrl: null,
    staticResult: '{"forecast": "sunny"}',
    enabled: true,
  };
}

const { notype: _removed, ...EXTRAS_WITHOUT_NOTYPE } = EXTRAS_SCHEMA_PROPERTIES;

// ── Follow-ups to the rebuild (inherited issues, decision 7) ───────────────────────

const PARAMETERS_INTRO = "Define the arguments the AI can pass when calling this tool.";

/**
 * Every step: a parameter row with no name says it won't be saved, and rows sharing a name say only the last
 * is saved. The note is the row's last text, right after its "Required" label.
 */
function withRowNotes(recorded: Snapshot): Snapshot {
  const names = recorded.fields.filter((field) => field.placeholder === "param_name").map((field) => field.value);
  const notes = parameterRowNotes(names.map((name) => ({ name: String(name) }) as ToolParameter));
  if (!notes.some(Boolean)) return recorded;
  const start = recorded.text.indexOf(PARAMETERS_INTRO);
  expect(start).toBeGreaterThan(-1);
  let row = -1;
  const rows = recorded.text.slice(start).replace(/Required/g, (match) => {
    row += 1;
    return `${match}${notes[row] ?? ""}`;
  });
  expect(row + 1, "one Required label per row").toBe(notes.length);
  return { ...recorded, text: recorded.text.slice(0, start) + rows };
}

/** A create that answered without an id opens the new row, as a create with an id does (`new:save-order`). */
function asCreateWithId(_recorded: Snapshot): Snapshot {
  const withId = scenarios.find(({ scenario }) => scenario.id === "new:save-order")!.scenario.steps[6]!;
  return snapshotOf(withId);
}

/** Every intended difference, by scenario id and step index. Nothing else may differ. */
const INTENDED: Record<string, Record<number, StepExpectation>> = {
  // D1: a stored tool keeps its on/off state, read as chats read it.
  "save:disabled": { 1: (recorded) => withEnabled(recorded, false) },
  "save:disabled-string": { 1: (recorded) => withEnabled(recorded, false) },
  // D2: the unsaved bar hides after a successful save and whenever the form resets.
  "back:bar-then-header-save": { 3: withoutUnsavedBar },
  "back:bar-then-switch": { 3: withoutUnsavedBar },
  // D3: a failed delete shows in the banner and the editor stays open.
  "delete:fails": { 3: (recorded) => withDeleteBanner(recorded, "Couldn't delete: locked") },
  // D4: plain validation messages, checked before anything is sent.
  "save:long-name": {
    1: (recorded) => withPlainValidation(recorded, "Keep the tool name to 100 characters or fewer."),
  },
  "save:long-desc": {
    1: (recorded) => withPlainValidation(recorded, "Keep the description to 500 characters or fewer."),
  },
  "save:bad-url": {
    1: (recorded) => withPlainValidation(recorded, "Enter a full webhook URL, like https://api.example.com/my-tool."),
  },
  "new:bad-url": {
    5: (recorded) => withPlainValidation(recorded, "Enter a full webhook URL, like https://api.example.com/my-tool."),
  },
  // D5: an imported tool keeps its other schema keys and shows its own type.
  "show:extrasSchema": { 0: withIntegerOption },
  "save:extras-schema": {
    0: withIntegerOption,
    1: (recorded) => withUpdatePayload(withIntegerOption(recorded), extrasPayload(EXTRAS_SCHEMA_PROPERTIES)),
  },
  "param:remove-middle-save": {
    0: withIntegerOption,
    1: withIntegerOption,
    2: (recorded) => withUpdatePayload(withIntegerOption(recorded), extrasPayload(EXTRAS_WITHOUT_NOTYPE)),
  },
  // Follow-up: the new tool is found in the refreshed list, so a second Save updates it instead of creating it again.
  "new:create-no-id": { 5: asCreateWithId },
};

// D3: the old editor left the failed delete as an unhandled rejection; the rebuild handles it.
const INTENDED_UNHANDLED: Record<string, string[]> = { "delete:fails": [] };

describe("ToolEditor replays the recorded old editor", () => {
  it("covers every recorded scenario and step", () => {
    expect(scenarios).toHaveLength(113);
    expect(scenarios.reduce((sum, { scenario }) => sum + scenario.steps.length, 0)).toBe(338);
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
        if ("text" in step && step.text.includes('"message"'))
          expect(INTENDED[scenario.id]?.[index], `${scenario.id} ${index}`).toBeDefined();
      });
    }
  });

  it.each(scenarios.map(({ file, recording, scenario }) => [`${file} ${scenario.id}`, recording, scenario] as const))(
    "%s",
    async (_name, recording: Recording, scenario: Scenario) => {
      const { results, unhandled } = await replayScenario(recording, scenario);
      results.forEach((result, index) => {
        const recorded = scenario.steps[index]!;
        const label = `${scenario.id} step ${index} ${JSON.stringify(recorded.step)}`;
        if ("error" in recorded) {
          expect("error" in result, label).toBe(true);
          return;
        }
        const recordedSnapshot = snapshotOf(recorded);
        const intended = INTENDED[scenario.id]?.[index];
        const expected = withRowNotes(intended ? intended(recordedSnapshot) : recordedSnapshot);
        const actual = snapshotOf(result);
        const { calls: actualCalls, ...actualRest } = actual;
        const { calls: expectedCalls, ...expectedRest } = expected;
        expect(
          {
            ...actualRest,
            fields: setAsideDecision6Fields(actual.fields, expected.fields),
            buttons: setAsideDecision6Buttons(actual.buttons, expected.buttons, actual.text),
          },
          label,
        ).toEqual(expectedRest);
        // Payloads compared as JSON, so key order counts.
        expect(
          actualCalls.map((call) => JSON.stringify(call)),
          `${label} calls`,
        ).toEqual(expectedCalls.map((call) => JSON.stringify(call)));
      });
      expect(unhandled).toEqual(INTENDED_UNHANDLED[scenario.id] ?? scenario.unhandled);
    },
    20_000,
  );
});
