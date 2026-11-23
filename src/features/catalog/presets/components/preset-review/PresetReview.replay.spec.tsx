import { describe, expect, it, vi } from "vitest";
import type {
  LabelledSnapshot,
  Recording,
  Scenario,
  Snapshot,
  StepResult,
} from "../preset-overview/preset-overview-replay-harness";
import { resolveStep } from "../preset-overview/preset-overview-replay-harness";
import { replayReviewScenario } from "./preset-review-replay-harness";
import actionsPick from "./test-fixtures/recorded-actions-pick.json";
import actionsReal from "./test-fixtures/recorded-actions-real.json";
import actionsReview from "./test-fixtures/recorded-actions-review.json";
import show from "./test-fixtures/recorded-show.json";

vi.mock("../../../../../shared/api/storage-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  storageApi: (await import("./fake-preset-review-apis")).fakeReviewStorageApi,
}));
vi.mock("../../../../../shared/api/llm-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  llmApi: (await import("./fake-preset-review-apis")).fakeLlmApi,
}));
vi.mock("../../../../../engine/generation/prompt-reviewer", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../../../engine/generation/prompt-reviewer")>();
  const { fakePresetReviewApis, fakeReviewPromptPreset } = await import("./fake-preset-review-apis");
  fakePresetReviewApis.setRealReviewer(original.reviewPromptPreset as (...args: unknown[]) => AsyncIterable<unknown>);
  return { ...original, reviewPromptPreset: fakeReviewPromptPreset };
});
vi.mock("../../../../../shared/api/prompt-nested-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  promptNestedApi: (await import("../preset-overview/fake-preset-overview-apis")).fakePromptNestedApi,
}));
vi.mock("../../../../../shared/api/export-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../../../shared/api/export-api")>();
  const { fakeExportPrompt } = await import("../preset-overview/fake-preset-overview-apis");
  return { ...original, exportApi: { ...original.exportApi, prompt: fakeExportPrompt } };
});
vi.mock("../../../../../shared/api/download-payload", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  triggerDownload: (await import("../preset-overview/fake-preset-overview-apis")).fakeTriggerDownload,
}));
vi.mock("../../../../../shared/api/integration-utility-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../../../shared/api/integration-utility-api")>();
  const { fakeConnectionsList } = await import("../preset-overview/fake-preset-overview-apis");
  return { ...original, connectionsUtilityApi: { ...original.connectionsUtilityApi, list: fakeConnectionsList } };
});
vi.mock("../../../../../shared/lib/app-dialogs", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  showConfirmDialog: (await import("../preset-overview/fake-preset-overview-apis")).fakeConfirmDialog,
}));
vi.mock("sonner", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: (await import("../preset-overview/fake-preset-overview-apis")).fakeToast,
}));
vi.mock("../preset-sections", () =>
  import("../preset-overview/fake-preset-overview-apis").then(({ ProbeSectionsTab }) => ({
    PresetSectionsTab: ProbeSectionsTab,
  })),
);

const RECORDINGS: ReadonlyArray<[string, Recording]> = [
  ["recorded-show.json", show as unknown as Recording],
  ["recorded-actions-pick.json", actionsPick as unknown as Recording],
  ["recorded-actions-review.json", actionsReview as unknown as Recording],
  ["recorded-actions-real.json", actionsReal as unknown as Recording],
];

const scenarios = RECORDINGS.flatMap(([file, recording]) =>
  recording.scenarios.map((scenario) => ({ file, recording, scenario })),
);

// ── Decisions 1 to 3 ───────────────────────────────────────────────────────────
// The recorder saw the connection select without a name, no live region on the output box and no role on the error
// box (README, "What the decisions change"). The rebuild adds exactly those; the sparkles icon is an svg, which no
// snapshot lists, and `type="button"` is not recorded. Each attribute is checked for its value on the element its
// decision names, then set aside. Everything else must match.

/** Decision 1 on the recorded fields: every select (the connection picker) is named `Connection`. */
function setAsideFieldNames(actual: Snapshot["fields"], expected: Snapshot["fields"], label: string) {
  expect(actual.length, `${label} field count`).toBe(expected.length);
  return actual.map((field, index) => {
    if (field.tag !== "select") return field;
    expect(expected[index]?.tag, `${label} field #${index}`).toBe("select");
    expect(field["aria-label"], `${label} select name`).toBe("Connection");
    const { "aria-label": _name, ...rest } = field;
    return rest;
  });
}

const BUTTON_LABELS = ["Start Review", "Reviewing…"];
const noSpace = (text: string) => text.replace(/\s+/g, "");

/** The recorded page text after the Start button: the error box's text, then the output's. */
function textAfterStart(text: string): string {
  const at = Math.max(...BUTTON_LABELS.map((label) => text.lastIndexOf(label)));
  if (at < 0) return "";
  const label = BUTTON_LABELS.find((candidate) => text.startsWith(candidate, at))!;
  return text.slice(at + label.length);
}

/**
 * Decision 2 on the labelled elements: the error box gains `role="alert"` and the output box `aria-live="polite"`,
 * so each is listed while shown. Together they hold exactly the recorded text after the Start button.
 */
function setAsideLiveRegions(actual: LabelledSnapshot[], expected: Snapshot, label: string): LabelledSnapshot[] {
  const alerts = actual.filter((element) => element.role === "alert");
  const live = actual.filter((element) => "aria-live" in element);
  expect(alerts.length, `${label} error boxes`).toBeLessThanOrEqual(1);
  expect(live.length, `${label} output boxes`).toBeLessThanOrEqual(1);
  for (const alert of alerts) expect(Object.keys(alert).sort(), `${label} error box`).toEqual(["role", "tag", "text"]);
  for (const box of live) {
    expect(Object.keys(box).sort(), `${label} output box`).toEqual(["aria-live", "tag", "text"]);
    expect(box["aria-live"], `${label} output box`).toBe("polite");
  }
  for (const box of [...alerts, ...live]) expect(box.tag, `${label} live region tag`).toBe("div");
  const shown = [...alerts, ...live].map((box) => box.text).join("");
  expect(noSpace(shown), `${label} error and output text`).toBe(noSpace(textAfterStart(expected.text)));
  return actual.filter((element) => element.role !== "alert" && !("aria-live" in element));
}

/** Render errors match by count and by the property being read (README, "Render errors"). */
function renderErrorShape(errors: string[] | undefined) {
  return (errors ?? []).map((message) => ({
    typeError: message.startsWith("TypeError:"),
    map: /\bmap\b/.test(message),
  }));
}

function compareStep(actual: StepResult, expected: StepResult, label: string) {
  if ("error" in expected) {
    expect(actual, label).toEqual(expected);
    return;
  }
  expect("error" in actual ? actual.error : null, `${label} ran`).toBeNull();
  if ("error" in actual) return;
  const { calls, fields, labelled, renderError, ...rest } = actual;
  const {
    calls: expectedCalls,
    fields: expectedFields,
    labelled: expectedLabelled,
    renderError: expectedRenderError,
    ...expectedRest
  } = expected;
  expect(rest, label).toEqual(expectedRest);
  expect(renderErrorShape(renderError), `${label} render errors`).toEqual(renderErrorShape(expectedRenderError));
  expect(setAsideFieldNames(fields, expectedFields, label), `${label} fields`).toEqual(expectedFields);
  expect(setAsideLiveRegions(labelled, expected, label), `${label} labelled`).toEqual(expectedLabelled);
  // Calls compared as JSON, so payload key order counts.
  expect(
    calls.map((call) => JSON.stringify(call)),
    `${label} calls`,
  ).toEqual(expectedCalls.map((call) => JSON.stringify(call)));
}

describe("PresetReviewTab replays the recorded old tab", () => {
  it("covers every recorded scenario and step", () => {
    expect(scenarios).toHaveLength(54);
    expect(scenarios.reduce((sum, { scenario }) => sum + scenario.steps.length, 0)).toBe(326);
  });

  it.each(scenarios.map(({ file, recording, scenario }) => [`${file} ${scenario.id}`, recording, scenario] as const))(
    "%s",
    async (_name, recording: Recording, scenario: Scenario) => {
      const { results, unhandledAfterUnmount } = await replayReviewScenario(recording, scenario);
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
