import { afterEach, describe, expect, it, vi } from "vitest";
import { fakePresetSectionsApis } from "./fake-preset-sections-apis";
import { SectionsHarness, worldFor, type Recording, type Step } from "./preset-sections-replay-harness";
import show from "./test-fixtures/recorded-show.json";

// Follow-ups 10 and 8 after the rebuild (docs/provenance/preset-sections.md, "Follow-ups after the rebuild"): content
// typed but not saved yet is saved when the content editor goes away, closing the expanded editor saves once, and
// Enter in the name input saves once. New step sequences on the recorder's default world; each failed on the rebuild
// as merged except the guard that a deleted section gets no save.

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

const recording = show as unknown as Recording;
let harness: SectionsHarness | null = null;

async function mount(steps: Step[] = []) {
  harness = new SectionsHarness(worldFor(recording, { world: {} }), recording.worlds);
  await harness.run(["mount"]);
  for (const step of steps) await harness.run(step);
  return harness;
}

afterEach(async () => {
  await harness?.unmount();
  harness = null;
});

/** The content saves sent so far, as `[sectionId, content]`. */
const contentSaves = () =>
  fakePresetSectionsApis.calls
    .filter((call) => call[0] === "mutate" && call[1] === "updateSection")
    .map((call) => call[2] as { sectionId: string; content?: unknown })
    .filter((data) => "content" in data)
    .map((data) => [data.sectionId, data.content]);

describe("PresetSectionsTab follow-up 10", () => {
  it("saves inline typing still waiting for its timer when the card collapses", async () => {
    await mount([
      ["toggle", 0],
      ["focus", "content:0"],
      ["type", "content:0", "Typed inline"],
      ["toggle", 0],
    ]);
    expect(contentSaves()).toEqual([["s-main", "Typed inline"]]);
    await harness!.run(["wait", 2000]);
    expect(contentSaves()).toEqual([["s-main", "Typed inline"]]);
  });

  it("saves the expanded editor's closing text when the card collapses right after Done", async () => {
    await mount([["toggle", 0], ["expandEditor", 0], ["type", "editor", "Typed big"], ["done"], ["toggle", 0]]);
    expect(contentSaves()).toEqual([["s-main", "Typed big"]]);
    await harness!.run(["wait", 2000]);
    expect(contentSaves()).toEqual([["s-main", "Typed big"]]);
  });

  it("saves the expanded editor's closing text when the tab goes away right after Done", async () => {
    await mount([
      ["toggle", 0],
      ["expandEditor", 0],
      ["type", "editor", "Then left"],
      ["key", "body", "Escape"],
    ]);
    expect(contentSaves()).toEqual([]);
    await harness!.unmount();
    harness = null;
    expect(contentSaves()).toEqual([["s-main", "Then left"]]);
  });

  it("saves the open expanded editor's text when the tab goes away", async () => {
    await mount([
      ["toggle", 0],
      ["expandEditor", 0],
      ["type", "editor", "Still open"],
    ]);
    await harness!.unmount();
    harness = null;
    expect(contentSaves()).toEqual([["s-main", "Still open"]]);
  });

  it("closing the expanded editor after a hand-over saves the text once", async () => {
    await mount([["toggle", 0], ["expandEditor", 0], ["type", "editor", "one"], ["wait", 600], ["done"]]);
    await harness!.run(["wait", 2000]);
    expect(contentSaves()).toEqual([["s-main", "one"]]);
  });

  it("sends nothing for a deleted section, and a failed delete leaves the section editable", async () => {
    await mount([
      ["toggle", 0],
      ["expandEditor", 0],
      ["type", "editor", "gone"],
      ["deleteSection", 0],
      ["wait", 1400],
    ]);
    expect(contentSaves()).toEqual([]);

    await harness!.unmount();
    await mount([
      ["fail", "sections.delete", "in use"],
      ["deleteSection", 0],
      ["toggle", 0],
    ]);
    await harness!.run(["focus", "content:0"]);
    await harness!.run(["type", "content:0", "after failed delete"]);
    await harness!.run(["blur", "content:0"]);
    expect(contentSaves()).toEqual([["s-main", "after failed delete"]]);
  });
});

describe("PresetSectionsTab follow-up 8", () => {
  it("Enter in the name input saves once", async () => {
    await mount([
      ["toggle", 0],
      ["focus", "name:0"],
      ["type", "name:0", "Renamed once"],
      ["key", "name:0", "Enter"],
    ]);
    const nameSaves = fakePresetSectionsApis.calls.filter(
      (call) => call[0] === "mutate" && call[1] === "updateSection" && "name" in (call[2] as object),
    );
    expect(nameSaves).toEqual([
      ["mutate", "updateSection", { presetId: "preset-1", sectionId: "s-main", name: "Renamed once" }],
    ]);
  });
});
