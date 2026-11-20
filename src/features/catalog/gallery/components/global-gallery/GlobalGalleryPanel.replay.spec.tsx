import { describe, expect, it, vi } from "vitest";
import {
  replayScenario,
  type ButtonSnapshot,
  type Recording,
  type Scenario,
  type Snapshot,
  type StepResult,
} from "./gallery-replay-harness";
import actionsJson from "./test-fixtures/recorded-actions.json";
import showJson from "./test-fixtures/recorded-show.json";

vi.mock("../../../../../shared/api/storage-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  storageApi: (await import("./fake-gallery-storage")).fakeStorageApi,
}));
vi.mock("../../../../../shared/api/image-generation-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  galleryApi: (await import("./fake-gallery-storage")).fakeGalleryApi,
}));
vi.mock("../../../../../shared/api/local-file-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import("./fake-gallery-storage")).fakeFileUrls,
}));
vi.mock("../../../../../shared/lib/app-dialogs", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  showConfirmDialog: (await import("./fake-gallery-storage")).fakeConfirmDialog,
  showPromptDialog: (await import("./fake-gallery-storage")).fakePromptDialog,
}));
vi.mock("sonner", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: (await import("./fake-gallery-storage")).fakeToast,
}));
vi.mock("../../../../../shared/components/ui/CustomEmojiTagButton", async () => ({
  CustomEmojiTagButton: (await import("./fake-gallery-storage")).FakeTagButton,
}));
vi.mock("@tanstack/react-virtual", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useVirtualizer: (await import("./fake-gallery-storage")).fakeUseVirtualizer,
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

// ── Decision 1: the chips say which one is selected ─────────────────────────────────
// The recorder saw no pressed state. The rebuild adds `aria-pressed` on All, Unfiled and the folder chips:
// each value is checked against what the step shows, then set aside; every other attribute must match.
function setAsideDecision1(actual: ButtonSnapshot[], recorded: ButtonSnapshot[], recordedText: string) {
  const chips = actual.filter((button, index) => "aria-pressed" in button && !("aria-pressed" in recorded[index]!));
  if (chips.length > 0) {
    const pressed = chips.filter((chip) => chip["aria-pressed"] === "true");
    expect(pressed, "exactly one chip is pressed").toHaveLength(1);
    expect(
      chips.every((chip) => chip["aria-pressed"] === "true" || chip["aria-pressed"] === "false"),
      "aria-pressed is true or false",
    ).toBe(true);
    const into = /Upload to "(.*?)"/.exec(recordedText)?.[1];
    if (into !== undefined) expect(pressed[0]!.text.startsWith(into), `pressed chip is "${into}"`).toBe(true);
    else if (recordedText.includes("No images yet")) expect(pressed[0]!.text).toMatch(/^All\d+$/);
    else expect(pressed[0]!.text).toMatch(/^(All|Unfiled)\d+$/);
  }
  return actual.map((button, index) => {
    if (!("aria-pressed" in button) || "aria-pressed" in recorded[index]!) return button;
    const { "aria-pressed": _pressed, ...rest } = button;
    return rest;
  });
}

// ── Step expectations that decisions 1 to 5 change on purpose ──────────────────────

type StepExpectation = (recorded: Snapshot) => Snapshot;

const EMPTY_BOX = "No images yetUpload images to build a reusable, profile-wide library.";

/** D3: a first page that failed to load shows the error box with Retry instead of the empty box. */
function withLoadError(recorded: Snapshot): Snapshot {
  expect(recorded.text.endsWith(EMPTY_BOX)).toBe(true);
  expect(recorded.buttons.at(-1)?.text).toBe("Upload Images");
  return {
    ...recorded,
    text: `${recorded.text.slice(0, -EMPTY_BOX.length)}Couldn't load the gallery.Retry`,
    buttons: [...recorded.buttons, { text: "Retry" }],
  };
}

/**
 * Every intended difference, by scenario id and step index. Nothing else may differ. Decisions 2 (strip on
 * keyboard focus: a class), 4 (Escape through the overlay stack: no panel behind the lightbox here) and 5 (the
 * component recordings' folder list answers at once) don't show in these snapshots; the decisions spec tests them.
 */
const INTENDED: Record<string, Record<number, StepExpectation>> = {
  "show:list-fails": { 0: withLoadError },
};

describe("GlobalGalleryPanel replays the recorded old panel", () => {
  it("covers every recorded scenario and step", () => {
    expect(scenarios).toHaveLength(66);
    expect(scenarios.reduce((sum, { scenario }) => sum + scenario.steps.length, 0)).toBe(235);
  });

  it("lists only intended differences for steps that exist", () => {
    for (const [id, steps] of Object.entries(INTENDED)) {
      const found = scenarios.find(({ scenario }) => scenario.id === id);
      expect(found, id).toBeDefined();
      for (const index of Object.keys(steps)) {
        const step = found!.scenario.steps[Number(index)];
        expect(step, `${id} ${index}`).toBeDefined();
        expect("error" in step!, `${id} ${index} recorded a snapshot`).toBe(false);
      }
    }
  });

  it.each(scenarios.map(({ file, recording, scenario }) => [`${file} ${scenario.id}`, recording, scenario] as const))(
    "%s",
    async (_name, recording: Recording, scenario: Scenario) => {
      const { results, unhandled } = await replayScenario(recording, scenario);
      expect(results).toHaveLength(scenario.steps.length);
      results.forEach((result, index) => {
        const recorded = scenario.steps[index]!;
        const label = `${scenario.id} step ${index} ${JSON.stringify(recorded.step)}`;
        if ("error" in recorded) {
          expect("error" in result, label).toBe(true);
          return;
        }
        const recordedSnapshot = snapshotOf(recorded);
        const intended = INTENDED[scenario.id]?.[index];
        const expected = intended ? intended(recordedSnapshot) : recordedSnapshot;
        const actual = snapshotOf(result);
        const { calls: actualCalls, ...actualRest } = actual;
        const { calls: expectedCalls, ...expectedRest } = expected;
        expect(
          { ...actualRest, buttons: setAsideDecision1(actual.buttons, expected.buttons, expected.text) },
          label,
        ).toEqual(expectedRest);
        // Calls compared as JSON, so order, arguments and key order all count.
        expect(
          actualCalls.map((call) => JSON.stringify(call)),
          `${label} calls`,
        ).toEqual(expectedCalls.map((call) => JSON.stringify(call)));
      });
      expect(unhandled).toEqual(scenario.unhandled);
    },
    20_000,
  );
});
