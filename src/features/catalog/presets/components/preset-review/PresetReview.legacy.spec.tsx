import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { worldFor, type Recording } from "../preset-overview/preset-overview-replay-harness";
import { fakePresetReviewApis } from "./fake-preset-review-apis";
import { PresetReviewHarness } from "./preset-review-replay-harness";
import show from "./test-fixtures/recorded-show.json";

// How the old tab read each review event, seen black-box through getter events: `type` first, `data` only for
// tokens and errors, and a token's `data` only when the output updates. The rebuild keeps both.

vi.mock("../../../../../shared/api/storage-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  storageApi: (await import("./fake-preset-review-apis")).fakeReviewStorageApi,
}));
vi.mock("../../../../../shared/api/llm-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  llmApi: (await import("./fake-preset-review-apis")).fakeLlmApi,
}));
vi.mock("../../../../../engine/generation/prompt-reviewer", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  reviewPromptPreset: (await import("./fake-preset-review-apis")).fakeReviewPromptPreset,
}));
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

/** Mounts the editor on the AI Review tab and starts a scripted review. */
async function startReview(): Promise<HTMLElement> {
  harness = new PresetReviewHarness(worldFor(recording, { world: {} }), "preset-1");
  await harness.run(["mount"]);
  await harness.run(["tab", "AI Review"]);
  await harness.run(["choose", "c-1"]);
  await harness.run(["start"]);
  return harness.element;
}

afterEach(async () => {
  await harness?.unmount();
  harness = null;
});

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("PresetReviewTab reads events like the recorded tab", () => {
  it("never reads the data of a done event, so a throwing getter leaves the review running", async () => {
    const root = await startReview();
    const reads: string[] = [];
    const done = {
      get type() {
        reads.push("type");
        return "done";
      },
      get data(): string {
        reads.push("data");
        throw new Error("data read");
      },
    };
    // Given to the stream as is (an `emit` step would decode it, reading the getters).
    await act(async () => {
      fakePresetReviewApis.emit(done);
    });
    await harness!.settle();
    expect(reads).toEqual(["type", "type"]);
    expect(harness!.startButton().textContent).toContain("Reviewing…");
    expect(root.querySelector('[role="alert"]')).toBeNull();

    await harness!.run(["emit", { type: "token", data: "still streaming" }]);
    expect(root.querySelector("pre")?.textContent).toBe("still streaming");
  });

  it("reads a token's data when the output updates, so a change after the yield shows", async () => {
    const root = await startReview();
    const token = { type: "token", data: "as yielded" };
    await act(async () => {
      fakePresetReviewApis.emit(token);
      // The tab takes the event before React renders the update; then the token changes.
      await tick();
      token.data = "changed before render";
    });
    await harness!.settle();
    expect(root.querySelector("pre")?.textContent).toBe("changed before render");
  });
});
