import { afterEach, describe, expect, it, vi } from "vitest";
import { worldFor, type Recording } from "../preset-overview/preset-overview-replay-harness";
import { fakePresetReviewApis } from "./fake-preset-review-apis";
import { PresetReviewHarness } from "./preset-review-replay-harness";
import show from "./test-fixtures/recorded-show.json";

// The follow-up fixes after the rebuild (docs/provenance/preset-review.md, "Follow-ups after the rebuild"), as new
// step sequences on the recorder's default world. Each failed on the rebuild as merged.

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
vi.mock("../../../../../shared/api/integration-utility-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../../../shared/api/integration-utility-api")>();
  const { fakeConnectionsList } = await import("../preset-overview/fake-preset-overview-apis");
  return { ...original, connectionsUtilityApi: { ...original.connectionsUtilityApi, list: fakeConnectionsList } };
});
vi.mock("../preset-sections", () =>
  import("../preset-overview/fake-preset-overview-apis").then(({ ProbeSectionsTab }) => ({
    PresetSectionsTab: ProbeSectionsTab,
  })),
);

const recording = show as unknown as Recording;
let harness: PresetReviewHarness | null = null;

/** Mounts the editor on the AI Review tab with a connection chosen. */
async function mountReviewTab(): Promise<HTMLElement> {
  harness = new PresetReviewHarness(worldFor(recording, { world: {} }), "preset-1");
  await harness.run(["mount"]);
  await harness.run(["tab", "AI Review"]);
  await harness.run(["choose", "c-1"]);
  return harness.element;
}

afterEach(async () => {
  await harness?.unmount();
  harness = null;
});

const stopButton = (root: HTMLElement) =>
  [...root.querySelectorAll("button")].find((button) => button.textContent === "Stop") ?? null;
const reviewSignal = () =>
  fakePresetReviewApis
    .signals()
    .filter((entry) => entry.to === "review")
    .at(-1)?.signal;

describe("PresetReviewTab follow-up fixes", () => {
  it("1. Stop aborts the running review, keeps the output so far and ignores later events", async () => {
    const root = await mountReviewTab();
    expect(stopButton(root)).toBeNull();
    await harness!.run(["start"]);
    const signal = reviewSignal();
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal!.aborted).toBe(false);
    await harness!.run(["emit", { type: "token", data: "So far" }]);
    const stop = stopButton(root)!;
    expect(stop.getAttribute("type")).toBe("button");
    await harness!.click(stop);
    expect(signal!.aborted).toBe(true);
    expect(stopButton(root)).toBeNull();
    expect(harness!.startButton().textContent).toContain("Start Review");
    expect(harness!.startButton().disabled).toBe(false);
    expect(root.querySelector("pre")?.textContent).toBe("So far");
    expect(root.querySelector('[role="alert"]')).toBeNull();

    await harness!.run(["emit", { type: "token", data: " and later" }]);
    await harness!.run(["emit", { type: "error", data: "late error" }]);
    expect(root.querySelector("pre")?.textContent).toBe("So far");
    expect(root.querySelector('[role="alert"]')).toBeNull();

    // A new review after a stop runs normally with its own signal.
    await harness!.run(["start"]);
    expect(reviewSignal()).not.toBe(signal);
    await harness!.run(["emit", { type: "token", data: "Fresh" }]);
    expect(root.querySelector("pre")?.textContent).toBe("Fresh");
    await harness!.run(["endReview"]);
    expect(harness!.startButton().textContent).toContain("Start Review");
    expect(reviewSignal()!.aborted).toBe(false);
  });

  it.each([
    ["leaving the tab", ["tab", "Overview"]],
    ["switching presets", ["switchPreset", "preset-2"]],
    ["closing the editor", ["switchPreset", null]],
  ] as const)("1. %s aborts the running review", async (_name, step) => {
    await mountReviewTab();
    await harness!.run(["start"]);
    const signal = reviewSignal()!;
    expect(signal.aborted).toBe(false);
    await harness!.run([...step]);
    expect(signal.aborted).toBe(true);
  });

  it("1. with the real reviewer, Stop aborts the model stream's request", async () => {
    const root = await mountReviewTab();
    await harness!.run(["realMode"]);
    await harness!.run(["start"]);
    const llm = fakePresetReviewApis.signals().find((entry) => entry.to === "llm.stream");
    expect(llm?.signal).toBeInstanceOf(AbortSignal);
    await harness!.run(["emit", { type: "token", text: "Partial review" }]);
    await harness!.click(stopButton(root)!);
    expect(llm!.signal!.aborted).toBe(true);
    expect(root.querySelector('[role="alert"]')).toBeNull();
  });
});
