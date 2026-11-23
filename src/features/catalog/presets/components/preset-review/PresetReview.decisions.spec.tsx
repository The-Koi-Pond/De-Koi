import { afterEach, describe, expect, it, vi } from "vitest";
import { worldFor, type Recording } from "../preset-overview/preset-overview-replay-harness";
import { PresetReviewHarness } from "./preset-review-replay-harness";
import show from "./test-fixtures/recorded-show.json";

// Spec decisions 1 to 3 (docs/provenance/preset-review.md, "Decisions"), on the recorder's default world.

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

describe("PresetReviewTab decisions", () => {
  it("1. names the connection dropdown and hides the sparkles icon", async () => {
    const root = await mountReviewTab();
    const select = root.querySelector("select");
    expect(select?.getAttribute("aria-label")).toBe("Connection");
    expect(select?.value).toBe("c-1");
    const icon = harness!.startButton().querySelector("svg.lucide-sparkles");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    await harness!.run(["start"]);
    expect(harness!.startButton().textContent).toContain("Reviewing…");
    expect(harness!.startButton().querySelector("svg.lucide-sparkles")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("2. announces the output politely and the error as an alert", async () => {
    const root = await mountReviewTab();
    expect(root.querySelector("[aria-live]")).toBeNull();
    expect(root.querySelector('[role="alert"]')).toBeNull();
    await harness!.run(["start"]);
    await harness!.run(["emit", { type: "token", data: "Looks clear." }]);
    const output = root.querySelector("[aria-live]");
    expect(output?.getAttribute("aria-live")).toBe("polite");
    expect(output?.querySelector("pre")?.textContent).toBe("Looks clear.");
    await harness!.run(["emit", { type: "error", data: "Prompt Reviewer stream failed." }]);
    const alert = root.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe("Prompt Reviewer stream failed.");
    // The error box comes before the output box, and output already shown stays.
    expect(alert?.nextElementSibling).toBe(output);
    await harness!.run(["throwReview", { error: "boom" }]);
    expect(root.querySelector('[role="alert"]')?.textContent).toBe("Review failed. Try again.");
  });

  it("3. gives the Start button type=button", async () => {
    await mountReviewTab();
    expect(harness!.startButton().getAttribute("type")).toBe("button");
    await harness!.run(["start"]);
    expect(harness!.startButton().getAttribute("type")).toBe("button");
    expect(harness!.startButton().disabled).toBe(true);
  });
});
