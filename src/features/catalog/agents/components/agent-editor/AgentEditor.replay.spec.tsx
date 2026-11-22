import { describe, expect, it, vi } from "vitest";
import {
  replayScenario,
  resolveStep,
  type ButtonSnapshot,
  type FieldSnapshot,
  type Recording,
  type Scenario,
  type StepResult,
} from "./agent-editor-replay-harness";
import actionsFields from "./test-fixtures/recorded-actions-fields.json";
import actionsFlow from "./test-fixtures/recorded-actions-flow.json";
import actionsKnowledge from "./test-fixtures/recorded-actions-knowledge.json";
import actionsSave1 from "./test-fixtures/recorded-actions-save-1.json";
import actionsSave2 from "./test-fixtures/recorded-actions-save-2.json";
import actionsToggles1 from "./test-fixtures/recorded-actions-toggles-1.json";
import actionsToggles2 from "./test-fixtures/recorded-actions-toggles-2.json";
import saveUnchanged1 from "./test-fixtures/recorded-save-unchanged-1.json";
import saveUnchanged2 from "./test-fixtures/recorded-save-unchanged-2.json";
import show1 from "./test-fixtures/recorded-show-1.json";
import show2 from "./test-fixtures/recorded-show-2.json";

vi.mock("../../../../../shared/api/storage-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  storageApi: (await import("./fake-agent-editor-apis")).fakeStorageApi,
}));
vi.mock("../../../../../shared/api/connection-catalog-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  connectionCatalogApi: (await import("./fake-agent-editor-apis")).fakeConnectionCatalogApi,
}));
vi.mock("../../../../../shared/api/custom-tool-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  customToolApi: (await import("./fake-agent-editor-apis")).fakeCustomToolApi,
}));
vi.mock("../../../../../shared/api/integration-utility-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  knowledgeSourcesApi: (await import("./fake-agent-editor-apis")).fakeKnowledgeSourcesApi,
}));
vi.mock("../../../../../shared/lib/app-dialogs", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  showConfirmDialog: (await import("./fake-agent-editor-apis")).fakeConfirmDialog,
}));
vi.mock("../../../../../shared/api/file-save-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  saveTextFileToUserSelectedLocation: (await import("./fake-agent-editor-apis")).fakeSaveTextFile,
}));
vi.mock("sonner", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: (await import("./fake-agent-editor-apis")).fakeToast,
}));
// The real tooltip, wrapped only to note its text (the recorder's `help`).
vi.mock("../../../../../shared/components/ui/HelpTooltip", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../../../shared/components/ui/HelpTooltip")>();
  const { createElement } = await import("react");
  return {
    ...real,
    HelpTooltip: (props: Parameters<typeof real.HelpTooltip>[0]) =>
      createElement(
        "span",
        { "data-help-text": props.text, style: { display: "contents" } },
        createElement(real.HelpTooltip, props),
      ),
  };
});

const RECORDINGS: ReadonlyArray<[string, Recording]> = [
  ["recorded-show-1.json", show1 as unknown as Recording],
  ["recorded-show-2.json", show2 as unknown as Recording],
  ["recorded-save-unchanged-1.json", saveUnchanged1 as unknown as Recording],
  ["recorded-save-unchanged-2.json", saveUnchanged2 as unknown as Recording],
  ["recorded-actions-fields.json", actionsFields as unknown as Recording],
  ["recorded-actions-toggles-1.json", actionsToggles1 as unknown as Recording],
  ["recorded-actions-toggles-2.json", actionsToggles2 as unknown as Recording],
  ["recorded-actions-knowledge.json", actionsKnowledge as unknown as Recording],
  ["recorded-actions-save-1.json", actionsSave1 as unknown as Recording],
  ["recorded-actions-save-2.json", actionsSave2 as unknown as Recording],
  ["recorded-actions-flow.json", actionsFlow as unknown as Recording],
];

const scenarios = RECORDINGS.flatMap(([file, recording]) =>
  recording.scenarios.map((scenario) => ({ file, recording, scenario })),
);

// ── Decisions 1 to 3 ───────────────────────────────────────────────────────────
// The recorder saw no pressed state on the toggles, no names on the tool toggles, the header name input or the
// file trash button, and no `aria-expanded` on the tool headers (README, "What the decisions change"). The
// rebuild adds exactly those. Each one is set aside only on the controls its decision names, found by their
// recorded text and position, and only with the value the control's state calls for. `type="button"` and the
// label associations (`id`/`for`) are not recorded at all. Everything else must match.

const PHASE_LABELS = ["Pre-Generation", "Parallel", "Post-Processing"];
const RESULT_LABELS = ["Context Injection", "Text Rewrite"];
const TURN_DATA_TITLES = ["Pre-generation injections", "Parallel agent results"];
const CHAT_ACTIVE_LABEL = "Use this chat's active lorebooks:";

/** A tool card's toggle: an unnamed, textless button right before its ▼/▲ header. */
function isToolToggle(recorded: ButtonSnapshot[], index: number): boolean {
  const button = recorded[index]!;
  const next = recorded[index + 1];
  return button.text === "" && Object.keys(button).length === 1 && !!next && /[▼▲]$/.test(next.text);
}

/** Lorebook and file rows: the buttons after the chat-active toggle, up to its group's end. */
function knowledgeRow(recorded: ButtonSnapshot[], index: number): "lorebook" | "file" | null {
  const start = recorded.findIndex((button) => String(button["aria-label"] ?? "").startsWith(CHAT_ACTIVE_LABEL));
  if (start < 0 || index <= start) return null;
  for (let at = start + 1; at <= index; at += 1) {
    const button = recorded[at]!;
    if (
      String(button["aria-label"] ?? "").startsWith("Help:") ||
      ["Upload File", "Uploading..."].includes(button.text)
    ) {
      return null;
    }
  }
  const button = recorded[index]!;
  if (button.title === "Delete file") return null;
  return recorded[index + 1]?.title === "Delete file" ? "file" : "lorebook";
}

/**
 * Decision 1's buttons and the on/off state each must announce, from the recording where its text says so
 * (status, writer, section, Background, phases and result types via the About card), else from the state
 * the control shows (`shownOn`: turn data, tool toggles, lorebook and file rows). `undefined`: not a decision 1
 * button.
 */
function decisionOnePressed(
  recorded: ButtonSnapshot[],
  index: number,
  pageText: string,
  shown: boolean | null | undefined,
): boolean | null | undefined {
  const { text } = recorded[index]!;
  if (/^(Enabled|Disabled)This agent (can run|will not run)/.test(text)) return text.startsWith("Enabled");
  if (/^(Enabled|Disabled)The (agent can save|write tool)/.test(text)) return text.startsWith("Enabled");
  if (/^Enabled".*" appears as a section option in prompt presets$/s.test(text)) return true;
  if (text === "DisabledAgent output is not injected into prompts") return false;
  if (text.startsWith("Generate when missing")) return true;
  if (text.startsWith("Leave backgrounds unchanged")) return false;
  if (PHASE_LABELS.includes(text)) return pageText.includes(`Phase: ${text} —`);
  const result = RESULT_LABELS.find((resultLabel) => text.startsWith(resultLabel) && text !== resultLabel);
  if (result) return pageText.includes(`Result Type: ${result}`);
  if (TURN_DATA_TITLES.some((title) => text.startsWith(title))) return shown ?? null;
  if (isToolToggle(recorded, index) || knowledgeRow(recorded, index)) return shown ?? null;
  return undefined;
}

/** Decision 2's names: the tool's name on its toggle, `Delete file` on the trash button. */
function allowedName(recorded: ButtonSnapshot[], index: number, name: string): boolean {
  if (recorded[index]!.title === "Delete file") return name === "Delete file";
  if (!isToolToggle(recorded, index)) return false;
  const header = recorded[index + 1]!.text;
  const rest = header.slice(name.length);
  return header.startsWith(name) && (rest.startsWith("custom") || !/^[a-z0-9_]/.test(rest));
}

function setAsideDecisionButtons(
  actual: ButtonSnapshot[],
  recorded: ButtonSnapshot[],
  pageText: string,
  shownOn: Array<boolean | null> | undefined,
  label: string,
) {
  return actual.map((button, index) => {
    const before = recorded[index];
    if (!before) return button;
    const next = { ...button };
    const where = `${label} button ${index} ${JSON.stringify(before.text)}`;
    if ("aria-pressed" in button && !("aria-pressed" in before)) {
      // D1: the listed on/off and pick-one buttons say whether they are on.
      const pressed = decisionOnePressed(recorded, index, pageText, shownOn?.[index]);
      expect(pressed, `${where}: aria-pressed on a button decision 1 doesn't list`).not.toBeUndefined();
      expect(pressed, `${where}: no on/off state shown`).not.toBeNull();
      expect(button["aria-pressed"], `${where}: aria-pressed`).toBe(String(pressed));
      delete next["aria-pressed"];
    }
    if ("aria-expanded" in button && !("aria-expanded" in before)) {
      // D2: a tool card's header says whether its parameters are shown (▲ when they are).
      expect(before.text, `${where}: aria-expanded off a tool header`).toMatch(/[▼▲]$/);
      expect(button["aria-expanded"], `${where}: aria-expanded`).toBe(String(before.text.endsWith("▲")));
      delete next["aria-expanded"];
    }
    if ("aria-label" in button && !("aria-label" in before)) {
      // D2: only the tool toggles (named after their tool) and the file trash button are named.
      expect(allowedName(recorded, index, String(button["aria-label"])), `${where}: aria-label`).toBe(true);
      delete next["aria-label"];
    }
    return next;
  });
}

function setAsideDecisionFields(actual: FieldSnapshot[], recorded: FieldSnapshot[], label: string) {
  return actual.map((field, index) => {
    const before = recorded[index];
    if (!before || !("aria-label" in field) || "aria-label" in before) return field;
    // D2: the header name input is named.
    expect(field, `${label} aria-label on field ${index}`).toMatchObject({
      placeholder: "Agent name…",
      "aria-label": "Agent name",
    });
    const { "aria-label": _named, ...rest } = field;
    return rest;
  });
}

function compareStep(actual: StepResult, expected: StepResult, label: string) {
  if ("error" in expected) {
    expect(actual, label).toEqual(expected);
    return;
  }
  expect("error" in actual ? actual.error : null, `${label} ran`).toBeNull();
  if ("error" in actual) return;
  const { calls: actualCalls, fields, buttons, shownOn, ...actualRest } = actual;
  const { calls: expectedCalls, fields: expectedFields, buttons: expectedButtons, ...expectedRest } = expected;
  expect(actualRest, label).toEqual(expectedRest);
  expect(setAsideDecisionFields(fields, expectedFields, label), `${label} fields`).toEqual(expectedFields);
  expect(setAsideDecisionButtons(buttons, expectedButtons, expected.text, shownOn, label), `${label} buttons`).toEqual(
    expectedButtons,
  );
  // Calls compared as JSON, so payload key order counts.
  expect(
    actualCalls.map((call) => JSON.stringify(call)),
    `${label} calls`,
  ).toEqual(expectedCalls.map((call) => JSON.stringify(call)));
}

// ── Follow-ups ──────────────────────────────────────────────────────────────────
// Recorded steps a later follow-up changes on purpose, by scenario id: the index of the first changed step. Steps
// before it still replay exactly; it and the steps after it are checked in `AgentEditor.follow-ups.spec.tsx`.
const FOLLOW_UP_CHANGES: Readonly<Record<string, number>> = {
  // Follow-up 9: a bad custom tool schema shows no parameters instead of crashing.
  "show:tools-null-schema": 0,
  "show:tools-null-schema-appears": 2,
  "show:tools-odd-schema": 1,
};

describe("AgentEditor replays the recorded old editor", () => {
  it("sets aside only recorded steps that exist", () => {
    for (const [id, from] of Object.entries(FOLLOW_UP_CHANGES)) {
      const found = scenarios.find(({ scenario }) => scenario.id === id);
      expect(found, id).toBeDefined();
      expect(from, id).toBeLessThan(found!.scenario.steps.length);
    }
  });

  it("covers every recorded scenario and step", () => {
    expect(scenarios).toHaveLength(553);
    expect(scenarios.reduce((sum, { scenario }) => sum + scenario.steps.length, 0)).toBe(1818);
  });

  it.each(scenarios.map(({ file, recording, scenario }) => [`${file} ${scenario.id}`, recording, scenario] as const))(
    "%s",
    async (_name, recording: Recording, scenario: Scenario) => {
      const { results, unhandledAfterUnmount } = await replayScenario(recording, scenario);
      expect(results).toHaveLength(scenario.steps.length);
      const changedFrom = FOLLOW_UP_CHANGES[scenario.id] ?? scenario.steps.length;
      results.forEach((result, index) => {
        if (index >= changedFrom) return;
        const recorded = scenario.steps[index]!;
        const expected = resolveStep(recording, recorded);
        const { unhandledAfterUnmount: _after, ...expectedStep } = expected as StepResult & {
          unhandledAfterUnmount?: string[];
        };
        compareStep(
          result,
          expectedStep as StepResult,
          `${scenario.id} step ${index} ${JSON.stringify(recorded.step)}`,
        );
      });
      if (changedFrom === scenario.steps.length) {
        expect(unhandledAfterUnmount).toEqual(scenario.steps.at(-1)?.unhandledAfterUnmount ?? []);
      }
    },
    30_000,
  );
});
