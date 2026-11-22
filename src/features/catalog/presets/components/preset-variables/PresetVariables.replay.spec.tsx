import { describe, expect, it, vi } from "vitest";
import {
  replayScenario,
  resolveStep,
  type ButtonSnapshot,
  type CardFlag,
  type FieldSnapshot,
  type LabelledSnapshot,
  type Recording,
  type Scenario,
  type ScopeSnapshot,
  type StepResult,
} from "./preset-variables-replay-harness";
import actionsEditor from "./test-fixtures/recorded-actions-editor.json";
import actionsFields from "./test-fixtures/recorded-actions-fields.json";
import actionsList from "./test-fixtures/recorded-actions-list.json";
import actionsOptions from "./test-fixtures/recorded-actions-options.json";
import show from "./test-fixtures/recorded-show.json";

vi.mock("../../../../../shared/api/storage-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  storageApi: (await import("./fake-preset-variables-apis")).fakeStorageApi,
}));
vi.mock("../../../../../shared/api/prompt-nested-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  promptNestedApi: (await import("./fake-preset-variables-apis")).fakePromptNestedApi,
}));
vi.mock("../../../../../shared/lib/app-dialogs", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  showConfirmDialog: (await import("./fake-preset-variables-apis")).fakeConfirmDialog,
}));
vi.mock("sonner", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: (await import("./fake-preset-variables-apis")).fakeToast,
}));

const RECORDINGS: ReadonlyArray<[string, Recording]> = [
  ["recorded-show.json", show as unknown as Recording],
  ["recorded-actions-fields.json", actionsFields as unknown as Recording],
  ["recorded-actions-options.json", actionsOptions as unknown as Recording],
  ["recorded-actions-editor.json", actionsEditor as unknown as Recording],
  ["recorded-actions-list.json", actionsList as unknown as Recording],
];

const scenarios = RECORDINGS.flatMap(([file, recording]) =>
  recording.scenarios.map((scenario) => ({ file, recording, scenario })),
);

// ── Decisions 1 to 3 ───────────────────────────────────────────────────────────
// The recorder saw the chevron, trash, switch, option and value editor X buttons without names, no
// `aria-expanded` / `aria-checked` / `role="switch"`, no `role="dialog"` and the grip without `aria-hidden`
// (README, "What the decisions change"). The rebuild adds exactly those. Each one is set aside only on the control
// its decision names, found by its recorded place, and only with the value the recorded state calls for. Label
// associations (`id` / `for`) and `type="button"` are not recorded at all. Everything else must match.

/** Per recorded item, the attributes a decision adds to it and their values. */
type Added = Array<Record<string, string>>;

const NOTHING: Record<string, string> = {};

const RANDOM_PICK_ON = "One of the user's selected options will be randomly picked each generation.";

const isBare = (button: ButtonSnapshot | undefined) =>
  !!button && button.text === "" && Object.keys(button).length === 1;

/** The attributes decisions 1 and 2 add to each recorded list button, by its place. */
function addedButtonAttributes(recorded: ButtonSnapshot[], cards: CardFlag[][], pageText: string): Added {
  const added: Added = [];
  let name = "";
  let card = -1;
  let chevronNext = false;
  let switches = 0;
  let expands = 0;
  let removes = 0;
  recorded.forEach((button, index) => {
    const title = button.title as string | undefined;
    if (title === "Move down") {
      name = String(button["aria-label"])
        .replace(/^Move /, "")
        .replace(/ down$/, "");
      card += 1;
      chevronNext = true;
      switches = expands = removes = 0;
      added.push({});
    } else if (isBare(button) && chevronNext) {
      chevronNext = false;
      const expanded = cards[card]?.includes("expanded") ?? false;
      added.push({ "aria-label": `${expanded ? "Collapse" : "Expand"} ${name}`, "aria-expanded": String(expanded) });
    } else if (isBare(button)) {
      switches += 1;
      const multiSelect = switches === 1;
      const on = multiSelect ? isBare(recorded[index + 1]) : pageText.includes(RANDOM_PICK_ON);
      added.push({
        role: "switch",
        "aria-checked": String(on),
        "aria-label": multiSelect ? "Multi-Select" : "Random Pick",
      });
    } else if (title === "Delete variable") {
      added.push({ "aria-label": `Delete ${name}` });
    } else if (title === "Expand value editor") {
      expands += 1;
      added.push({ "aria-label": `Edit value of option ${expands}` });
    } else if (title === "Remove option") {
      removes += 1;
      added.push({ "aria-label": `Remove option ${removes}` });
    } else {
      added.push({});
    }
  });
  return added;
}

/** Checks that `actual` has exactly the decision attributes `added` on top of `recorded`, and removes them. */
function setAside<T extends Record<string, unknown>>(actual: T[], recorded: T[], added: Added, label: string): T[] {
  return actual.map((item, index) => {
    const before = recorded[index];
    if (!before) return item;
    const next: Record<string, unknown> = { ...item };
    for (const [key, value] of Object.entries(added[index] ?? {})) {
      expect(item[key], `${label} #${index} ${key}`).toBe(value);
      delete next[key];
    }
    return next as T;
  });
}

function addedFieldAttributes(recorded: FieldSnapshot[]): Added {
  let labels = 0;
  let values = 0;
  return recorded.map<Record<string, string>>((field) => {
    if (field.placeholder === "Label…") return { "aria-label": `Option ${(labels += 1)} label` };
    if (field.placeholder === "Value…") return { "aria-label": `Option ${(values += 1)} value` };
    return NOTHING;
  });
}

/** Decision 1: the drag grips are hidden from assistive tech. */
function addedLabelledAttributes(recorded: LabelledSnapshot[]): Added {
  return recorded.map<Record<string, string>>((element) =>
    element.title === "Drag to reorder" ? { "aria-hidden": "true" } : NOTHING,
  );
}

/** Decision 3: the value editor is a modal dialog named by its title, with a named close button. */
function setAsideModal(actual: ScopeSnapshot | null, recorded: ScopeSnapshot | null, label: string) {
  if (!actual || !recorded) return actual;
  const dialogs = actual.labelled.filter((element) => element.role === "dialog");
  expect(dialogs, `${label} modal dialog element`).toHaveLength(1);
  expect(dialogs[0], `${label} modal dialog`).toMatchObject({ tag: "div", "aria-modal": "true" });
  expect(String(dialogs[0]!["aria-labelledby"] ?? ""), `${label} modal named by its title`).not.toBe("");
  const closeAdded: Added = recorded.buttons.map<Record<string, string>>((button, index) =>
    index === 0 && isBare(button) ? { "aria-label": "Close" } : NOTHING,
  );
  return {
    ...actual,
    labelled: actual.labelled.filter((element) => element.role !== "dialog"),
    buttons: setAside(actual.buttons, recorded.buttons, closeAdded, `${label} modal button`),
  };
}

function compareStep(actual: StepResult, expected: StepResult, label: string) {
  if ("error" in expected) {
    expect(actual, label).toEqual(expected);
    return;
  }
  expect("error" in actual ? actual.error : null, `${label} ran`).toBeNull();
  if ("error" in actual) return;
  const { calls, fields, buttons, labelled, modal, ...rest } = actual;
  const {
    calls: expectedCalls,
    fields: expectedFields,
    buttons: expectedButtons,
    labelled: expectedLabelled,
    modal: expectedModal,
    ...expectedRest
  } = expected;
  expect(rest, label).toEqual(expectedRest);
  expect(
    setAside(fields, expectedFields, addedFieldAttributes(expectedFields), `${label} field`),
    `${label} fields`,
  ).toEqual(expectedFields);
  const addedButtons = addedButtonAttributes(expectedButtons, expected.cards, expected.text);
  expect(setAside(buttons, expectedButtons, addedButtons, `${label} button`), `${label} buttons`).toEqual(
    expectedButtons,
  );
  expect(
    setAside(labelled, expectedLabelled, addedLabelledAttributes(expectedLabelled), `${label} labelled`),
    `${label} labelled`,
  ).toEqual(expectedLabelled);
  expect(setAsideModal(modal, expectedModal, label), `${label} modal`).toEqual(expectedModal);
  // Calls compared as JSON, so payload key order counts.
  expect(
    calls.map((call) => JSON.stringify(call)),
    `${label} calls`,
  ).toEqual(expectedCalls.map((call) => JSON.stringify(call)));
}

describe("PresetVariablesEditor replays the recorded old list", () => {
  it("covers every recorded scenario and step", () => {
    expect(scenarios).toHaveLength(194);
    expect(scenarios.reduce((sum, { scenario }) => sum + scenario.steps.length, 0)).toBe(1155);
  });

  it.each(scenarios.map(({ file, recording, scenario }) => [`${file} ${scenario.id}`, recording, scenario] as const))(
    "%s",
    async (_name, recording: Recording, scenario: Scenario) => {
      const { results, unhandledAfterUnmount } = await replayScenario(recording, scenario);
      expect(results).toHaveLength(scenario.steps.length);
      results.forEach((result, index) => {
        const recorded = scenario.steps[index]!;
        const { unhandledAfterUnmount: _after, ...expected } = resolveStep(recording, recorded) as StepResult & {
          unhandledAfterUnmount?: string[];
        };
        compareStep(result, expected as StepResult, `${scenario.id} step ${index} ${JSON.stringify(recorded.step)}`);
      });
      expect(unhandledAfterUnmount).toEqual(scenario.steps.at(-1)?.unhandledAfterUnmount ?? []);
    },
    30_000,
  );
});
