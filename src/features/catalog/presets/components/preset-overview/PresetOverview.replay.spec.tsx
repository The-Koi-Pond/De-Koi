import { describe, expect, it, vi } from "vitest";
import {
  replayScenario,
  resolveStep,
  type ButtonSnapshot,
  type FieldSnapshot,
  type LabelledSnapshot,
  type Recording,
  type Scenario,
  type Snapshot,
  type StepResult,
} from "./preset-overview-replay-harness";
import actionsEdit from "./test-fixtures/recorded-actions-edit.json";
import actionsHeader from "./test-fixtures/recorded-actions-header.json";
import actionsSave from "./test-fixtures/recorded-actions-save.json";
import show from "./test-fixtures/recorded-show.json";

vi.mock("../../../../../shared/api/storage-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  storageApi: (await import("./fake-preset-overview-apis")).fakeStorageApi,
}));
vi.mock("../../../../../shared/api/export-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../../../shared/api/export-api")>();
  const { fakeExportPrompt } = await import("./fake-preset-overview-apis");
  return { ...original, exportApi: { ...original.exportApi, prompt: fakeExportPrompt } };
});
vi.mock("../../../../../shared/api/download-payload", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  triggerDownload: (await import("./fake-preset-overview-apis")).fakeTriggerDownload,
}));
vi.mock("../../../../../shared/api/integration-utility-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../../../shared/api/integration-utility-api")>();
  const { fakeConnectionsList } = await import("./fake-preset-overview-apis");
  return { ...original, connectionsUtilityApi: { ...original.connectionsUtilityApi, list: fakeConnectionsList } };
});
vi.mock("../../../../../engine/generation/prompt-reviewer", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  reviewPromptPreset: (await import("./fake-preset-overview-apis")).fakeReviewPromptPreset,
}));
vi.mock("../../../../../shared/lib/app-dialogs", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  showConfirmDialog: (await import("./fake-preset-overview-apis")).fakeConfirmDialog,
}));
vi.mock("sonner", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: (await import("./fake-preset-overview-apis")).fakeToast,
}));
vi.mock("../preset-sections", () =>
  import("./fake-preset-overview-apis").then(({ ProbeSectionsTab }) => ({
    PresetSectionsTab: ProbeSectionsTab,
  })),
);

const RECORDINGS: ReadonlyArray<[string, Recording]> = [
  ["recorded-show.json", show as unknown as Recording],
  ["recorded-actions-edit.json", actionsEdit as unknown as Recording],
  ["recorded-actions-save.json", actionsSave as unknown as Recording],
  ["recorded-actions-header.json", actionsHeader as unknown as Recording],
];

const scenarios = RECORDINGS.flatMap(([file, recording]) =>
  recording.scenarios.map((scenario) => ({ file, recording, scenario })),
);

// ── Decisions 1 to 3 ───────────────────────────────────────────────────────────
// The recorder saw Back, Delete and the four inputs without names, no `aria-current` on the active tab, no
// `aria-pressed` on the wrap buttons and no roles on the saved notice and the save error bar (README, "What the
// decisions change"). The rebuild adds exactly those; icons are svgs, which no snapshot lists, and `type="button"` is
// not recorded. Each attribute is set aside only on the control its decision names, found by its recorded place,
// and only with the value the recorded state calls for. Everything else must match.

type Added = Array<Record<string, string>>;

const RAIL = ["Overview", "Sections", "AI Review"];
const WRAP = ["XML", "MARKDOWN", "NONE"];

/** Decisions 1 and 2 on the recorded buttons: Back and Delete named, the active tab marked, the wrap buttons pressed. */
function addedButtonAttributes(expected: Snapshot): Added {
  const { buttons, rail, wrap } = expected;
  const added: Added = buttons.map(() => ({}));
  if (expected.shown !== "editor") return added;
  // The header: Back, Save, Export, Delete.
  expect(buttons.slice(0, 4).map((button) => button.text)).toEqual(["", "Save", "", ""]);
  added[0] = { "aria-label": "Back" };
  added[3] = { "aria-label": "Delete preset" };
  const railStart = buttons.findIndex(
    (button, index) =>
      button.text === RAIL[0] && buttons[index + 1]?.text === RAIL[1] && buttons[index + 2]?.text === RAIL[2],
  );
  expect(railStart, "rail buttons").toBeGreaterThan(3);
  rail!.forEach(([, active], index) => {
    if (active) added[railStart + index] = { "aria-current": "page" };
  });
  if (wrap) {
    buttons.forEach((button, index) => {
      if (WRAP.includes(button.text)) added[index] = { "aria-pressed": String(wrap.includes(button.text)) };
    });
  }
  return added;
}

/** Decision 1 on the recorded fields: the header name and the three Overview inputs are named. */
function addedFieldAttributes(fields: FieldSnapshot[]): Added {
  let names = 0;
  return fields.map((field): Record<string, string> => {
    if (field.placeholder === "Preset name…") {
      names += 1;
      return { "aria-label": names === 1 ? "Preset name" : "Name" };
    }
    if (field.placeholder === "What does this preset do?") return { "aria-label": "Description" };
    if (field.placeholder === "Your name (optional)") return { "aria-label": "Author" };
    return {};
  });
}

/** Checks that `actual` has exactly the decision attributes `added` on top of `recorded`, and removes them. */
function setAside<T extends Record<string, unknown>>(actual: T[], recorded: T[], added: Added, label: string): T[] {
  return actual.map((item, index) => {
    if (!recorded[index]) return item;
    const next: Record<string, unknown> = { ...item };
    for (const [key, value] of Object.entries(added[index] ?? {})) {
      expect(item[key], `${label} #${index} ${key}`).toBe(value);
      delete next[key];
    }
    return next as T;
  });
}

/** Decision 2 on the labelled elements: the saved notice and the save error bar gain their roles. */
function setAsideLabelled(actual: LabelledSnapshot[], expected: Snapshot, label: string): LabelledSnapshot[] {
  const notice = actual.filter((element) => element.role === "status");
  const alert = actual.filter((element) => element.role === "alert");
  const noticeShown = expected.text.includes("Changes saved");
  expect(notice, `${label} saved notice`).toEqual(
    noticeShown ? [{ tag: "div", text: "Changes saved", role: "status" }] : [],
  );
  const errorButton = expected.buttons.some((button) => button["aria-label"] === "Dismiss save error");
  expect(alert.length, `${label} save error bar`).toBe(errorButton ? 1 : 0);
  if (alert[0]) expect(expected.text, `${label} save error text`).toContain(alert[0].text);
  return actual.filter((element) => element.role !== "status" && element.role !== "alert");
}

function compareStep(actual: StepResult, expected: StepResult, label: string) {
  if ("error" in expected) {
    expect(actual, label).toEqual(expected);
    return;
  }
  expect("error" in actual ? actual.error : null, `${label} ran`).toBeNull();
  if ("error" in actual) return;
  const { calls, fields, buttons, labelled, ...rest } = actual;
  const {
    calls: expectedCalls,
    fields: expectedFields,
    buttons: expectedButtons,
    labelled: expectedLabelled,
    ...expectedRest
  } = expected;
  expect(rest, label).toEqual(expectedRest);
  expect(
    setAside(fields, expectedFields, addedFieldAttributes(expectedFields), `${label} field`),
    `${label} fields`,
  ).toEqual(expectedFields);
  expect(
    setAside(buttons, expectedButtons, addedButtonAttributes(expected), `${label} button`) as ButtonSnapshot[],
    `${label} buttons`,
  ).toEqual(expectedButtons);
  expect(setAsideLabelled(labelled, expected, label), `${label} labelled`).toEqual(expectedLabelled);
  // Calls compared as JSON, so payload key order counts.
  expect(
    calls.map((call) => JSON.stringify(call)),
    `${label} calls`,
  ).toEqual(expectedCalls.map((call) => JSON.stringify(call)));
}

describe("PresetEditorShell replays the recorded old editor", () => {
  it("covers every recorded scenario and step", () => {
    expect(scenarios).toHaveLength(164);
    expect(scenarios.reduce((sum, { scenario }) => sum + scenario.steps.length, 0)).toBe(564);
  });

  it.each(scenarios.map(({ file, recording, scenario }) => [`${file} ${scenario.id}`, recording, scenario] as const))(
    "%s",
    async (_name, recording: Recording, scenario: Scenario) => {
      const { results, unhandledAfterUnmount } = await replayScenario(recording, scenario);
      expect(results).toHaveLength(scenario.steps.length);
      results.forEach((result, index) => {
        const recorded = scenario.steps[index]!;
        compareStep(
          result,
          resolveStep(recording, recorded),
          `${scenario.id} step ${index} ${JSON.stringify(recorded.step)}`,
        );
      });
      expect(unhandledAfterUnmount).toEqual(scenario.steps.at(-1)?.unhandledAfterUnmount ?? []);
    },
    30_000,
  );
});
