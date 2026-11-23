import { describe, expect, it, vi } from "vitest";
import {
  replayScenario,
  resolveStep,
  type ButtonSnapshot,
  type CardFlag,
  type FieldSnapshot,
  type LabelledSnapshot,
  type OpenPart,
  type Recording,
  type Scenario,
  type ScopeSnapshot,
  type StepResult,
} from "./preset-sections-replay-harness";
import actionsBody from "./test-fixtures/recorded-actions-body.json";
import actionsCards from "./test-fixtures/recorded-actions-cards.json";
import actionsDialogs from "./test-fixtures/recorded-actions-dialogs.json";
import actionsToolbar from "./test-fixtures/recorded-actions-toolbar.json";
import show from "./test-fixtures/recorded-show.json";

vi.mock("../../../../../shared/api/storage-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  storageApi: (await import("./fake-preset-sections-apis")).fakeStorageApi,
}));
vi.mock("../../../../../shared/api/prompt-nested-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  promptNestedApi: (await import("./fake-preset-sections-apis")).fakePromptNestedApi,
}));
vi.mock("../../../../../shared/lib/app-dialogs", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  showConfirmDialog: (await import("./fake-preset-sections-apis")).fakeConfirmDialog,
}));
vi.mock("sonner", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: (await import("./fake-preset-sections-apis")).fakeToast,
}));

const RECORDINGS: ReadonlyArray<[string, Recording]> = [
  ["recorded-show.json", show as unknown as Recording],
  ["recorded-actions-toolbar.json", actionsToolbar as unknown as Recording],
  ["recorded-actions-cards.json", actionsCards as unknown as Recording],
  ["recorded-actions-body.json", actionsBody as unknown as Recording],
  ["recorded-actions-dialogs.json", actionsDialogs as unknown as Recording],
];

const scenarios = RECORDINGS.flatMap(([file, recording]) =>
  recording.scenarios.map((scenario) => ({ file, recording, scenario })),
);

// ── Decisions 1 to 3 ───────────────────────────────────────────────────────────
// The recorder saw the chevron, eye and trash buttons, the group trash, the content editor's buttons and the dialogs'
// X buttons without names, no `aria-expanded` / `aria-pressed`, Add Section and Groups without `aria-expanded`, no
// `role="dialog"` / `aria-modal`, the name input and role dropdown without names and the grips without
// `aria-hidden` (README, "What the decisions change"). The rebuild adds exactly those. Each one is set aside only on
// the control its decision names, found by its recorded place, and only with the value the recorded state calls for.
// Label associations (`id` / `for`) and `type="button"` are not recorded at all. Everything else must match.

/** Per recorded item, the attributes a decision adds to it and their values (a function checks a value itself). */
type Expected = string | ((value: unknown) => boolean);
type Added = Array<Record<string, Expected>>;

const NOTHING: Record<string, Expected> = {};

const isBare = (button: ButtonSnapshot | undefined) =>
  !!button && button.text === "" && Object.keys(button).length === 1;

/** The attributes decisions 1 and 2 add to each recorded tab button, by its place. */
function addedButtonAttributes(
  recorded: ButtonSnapshot[],
  cards: CardFlag[][],
  open: OpenPart[],
  labelled: LabelledSnapshot[],
): Added {
  const groupNames = labelled.filter((element) => element.title === "Click to rename").map((element) => element.text);
  const added: Added = [];
  let region: "toolbar" | "groups" | "cards" | "variables" = "toolbar";
  let name = "";
  let card = -1;
  let chevronNext = false;
  let groupRow = 0;
  for (const button of recorded) {
    const title = button.title as string | undefined;
    if (button.text === "Add Section") {
      added.push({ "aria-expanded": String(open.includes("addMenu")) });
    } else if (button.text.startsWith("Groups (") && region === "toolbar") {
      added.push({ "aria-expanded": String(open.includes("groupsPanel")) });
    } else if (button.text === "New Group") {
      region = "groups";
      added.push(NOTHING);
    } else if (button.text === "Add Variable") {
      region = "variables";
      added.push(NOTHING);
    } else if (region === "variables") {
      added.push(NOTHING);
    } else if (title === "Move up") {
      region = "cards";
      name = String(button["aria-label"])
        .replace(/^Move /, "")
        .replace(/ up$/, "");
      card += 1;
      added.push(NOTHING);
    } else if (title === "Move down") {
      chevronNext = true;
      added.push(NOTHING);
    } else if (region === "cards" && chevronNext && isBare(button)) {
      chevronNext = false;
      const expanded = cards[card]?.includes("expanded") ?? false;
      added.push({ "aria-label": `${expanded ? "Collapse" : "Expand"} ${name}`, "aria-expanded": String(expanded) });
    } else if (title === "Disable" || title === "Enable") {
      added.push({ "aria-label": `${title} ${name}`, "aria-pressed": String(title === "Disable") });
    } else if (title === "Delete") {
      added.push({ "aria-label": `Delete ${name}` });
    } else if (title === "Expand editor" || title === "Macros reference") {
      added.push({ "aria-label": title });
    } else if (region === "groups" && isBare(button)) {
      // The row being renamed shows an input instead of its name; its trash keeps the group's name.
      const rowName = groupNames[groupRow];
      groupRow += 1;
      added.push({
        "aria-label": (value) =>
          typeof value === "string" &&
          (value === `Delete group ${rowName}` || (value.startsWith("Delete group ") && open.includes("groupRename"))),
      });
    } else {
      added.push(NOTHING);
    }
  }
  return added;
}

/** Checks that `actual` has exactly the decision attributes `added` on top of `recorded`, and removes them. */
function setAside<T extends Record<string, unknown>>(actual: T[], recorded: T[], added: Added, label: string): T[] {
  return actual.map((item, index) => {
    const before = recorded[index];
    if (!before) return item;
    const next: Record<string, unknown> = { ...item };
    for (const [key, expected] of Object.entries(added[index] ?? {})) {
      if (typeof expected === "function")
        expect(expected(item[key]), `${label} #${index} ${key}: ${String(item[key])}`).toBe(true);
      else expect(item[key], `${label} #${index} ${key}`).toBe(expected);
      delete next[key];
    }
    return next as T;
  });
}

const ROLE_OPTIONS = JSON.stringify([
  ["system", "System"],
  ["user", "User"],
  ["assistant", "Assistant"],
]);

/** Decision 1: the name input and the role dropdown are named. */
function addedFieldAttributes(recorded: FieldSnapshot[]): Added {
  return recorded.map((field) => {
    if (field.placeholder === "Section name") return { "aria-label": "Section name" };
    if (field.tag === "select" && JSON.stringify(field.options) === ROLE_OPTIONS) return { "aria-label": "Role" };
    return NOTHING;
  });
}

/** Decision 1: the section grips are hidden from assistive tech (the variables' grips already were). */
function addedLabelledAttributes(recorded: LabelledSnapshot[]): Added {
  return recorded.map((element) =>
    element.title === "Drag to reorder" && !("aria-hidden" in element) ? { "aria-hidden": "true" } : NOTHING,
  );
}

/** Decision 3: each dialog is a modal dialog named by its title, with a named close button. */
function setAsideModal(actual: ScopeSnapshot, recorded: ScopeSnapshot | undefined, label: string): ScopeSnapshot {
  if (!recorded) return actual;
  const dialogs = actual.labelled.filter((element) => element.role === "dialog");
  expect(dialogs, `${label} dialog element`).toHaveLength(1);
  expect(dialogs[0], `${label} dialog`).toMatchObject({ tag: "div", "aria-modal": "true" });
  expect(String(dialogs[0]!["aria-labelledby"] ?? ""), `${label} dialog named by its title`).not.toBe("");
  const closeAdded: Added = recorded.buttons.map((button, index) =>
    index === 0 && isBare(button) ? { "aria-label": "Close" } : NOTHING,
  );
  return {
    ...actual,
    labelled: actual.labelled.filter((element) => element.role !== "dialog"),
    buttons: setAside(actual.buttons, recorded.buttons, closeAdded, `${label} button`),
  };
}

function compareStep(actual: StepResult, expected: StepResult, label: string) {
  if ("error" in expected) {
    expect(actual, label).toEqual(expected);
    return;
  }
  expect("error" in actual ? actual.error : null, `${label} ran`).toBeNull();
  if ("error" in actual) return;
  const { calls, fields, buttons, labelled, modals, ...rest } = actual;
  const {
    calls: expectedCalls,
    fields: expectedFields,
    buttons: expectedButtons,
    labelled: expectedLabelled,
    modals: expectedModals,
    ...expectedRest
  } = expected;
  expect(rest, label).toEqual(expectedRest);
  expect(
    setAside(fields, expectedFields, addedFieldAttributes(expectedFields), `${label} field`),
    `${label} fields`,
  ).toEqual(expectedFields);
  const addedButtons = addedButtonAttributes(expectedButtons, expected.cards, expected.open, expectedLabelled);
  expect(setAside(buttons, expectedButtons, addedButtons, `${label} button`), `${label} buttons`).toEqual(
    expectedButtons,
  );
  expect(
    setAside(labelled, expectedLabelled, addedLabelledAttributes(expectedLabelled), `${label} labelled`),
    `${label} labelled`,
  ).toEqual(expectedLabelled);
  expect(
    modals.map((modal, index) => setAsideModal(modal, expectedModals[index], `${label} dialog ${index}`)),
    `${label} dialogs`,
  ).toEqual(expectedModals);
  // Calls compared as JSON, so payload key order counts.
  expect(
    calls.map((call) => JSON.stringify(call)),
    `${label} calls`,
  ).toEqual(expectedCalls.map((call) => JSON.stringify(call)));
}

describe("PresetSectionsTab replays the recorded old tab", () => {
  it("covers every recorded scenario and step", () => {
    expect(scenarios).toHaveLength(254);
    expect(scenarios.reduce((sum, { scenario }) => sum + scenario.steps.length, 0)).toBe(1418);
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
