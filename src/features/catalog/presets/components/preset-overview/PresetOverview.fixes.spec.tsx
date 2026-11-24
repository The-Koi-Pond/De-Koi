import { afterEach, describe, expect, it, vi } from "vitest";
import { useUIStore } from "../../../../../shared/stores/ui.store";
import { PresetOverviewHarness, worldFor, type Recording, type Step } from "./preset-overview-replay-harness";
import show from "./test-fixtures/recorded-show.json";

// The follow-up fixes after the rebuild (docs/provenance/preset-overview.md, "Follow-ups after the rebuild"), as new
// step sequences on the recorder's default world. Each failed on the rebuild as merged.

vi.mock("../../../../../shared/api/storage-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  storageApi: (await import("./fake-preset-overview-apis")).fakeStorageApi,
}));
vi.mock("../../../../../shared/api/prompt-nested-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  promptNestedApi: (await import("./fake-preset-overview-apis")).fakePromptNestedApi,
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
  import("./fake-preset-overview-apis").then(({ ProbeSectionsTab }) => ({ PresetSectionsTab: ProbeSectionsTab })),
);

const recording = show as unknown as Recording;
let harness: PresetOverviewHarness | null = null;

async function mountEditor(): Promise<HTMLElement> {
  harness = new PresetOverviewHarness(worldFor(recording, { world: {} }), "preset-1");
  await harness.run(["mount"]);
  return harness.element;
}

afterEach(async () => {
  await harness?.unmount();
  harness = null;
});

/** Runs a step and returns the calls it made, as the recorder writes them. */
async function run(...step: Step) {
  const result = await harness!.record(step);
  return result.calls as unknown[][];
}

const field = (root: HTMLElement, name: string) =>
  root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${name}"]`)!.value;
const updates = (calls: unknown[][]) => calls.filter((call) => call[0] === "storage.update" && call[1] === "prompts");
const dirty = () => useUIStore.getState().editorDirty;
/** The confirm and delete calls among `calls` (a delete also refreshes the preset list). */
const deleteFlow = (calls: unknown[][]) =>
  calls.map((call) => call[0]).filter((name) => name === "confirm" || name === "storage.delete");

describe("PresetEditorShell follow-up fixes", () => {
  it("1. a refresh keeps unsaved Overview edits, takes new stored values for the rest, and Save sends both", async () => {
    const root = await mountEditor();
    await run("type", "name", "Typed name");
    await run("refresh", { description: "Changed elsewhere", author: "Someone else" });
    expect(field(root, "Name")).toBe("Typed name");
    expect(field(root, "Preset name")).toBe("Typed name");
    expect(field(root, "Description")).toBe("Changed elsewhere");
    expect(field(root, "Author")).toBe("Someone else");
    expect(dirty()).toBe(true);

    // A Sections tab save refreshes the preset too.
    await run("wrap", "markdown");
    await run("tab", "Sections");
    await run("sectionsMutate", "onUpdateSection", { presetId: "preset-1", sectionId: "s-main", enabled: false });
    await run("tab", "Overview");
    expect(field(root, "Name")).toBe("Typed name");
    expect(root.querySelector('button[aria-pressed="true"]')?.textContent).toBe("MARKDOWN");

    const [update] = updates(await run("save"));
    expect(update?.[3]).toMatchObject({
      name: "Typed name",
      description: "Changed elsewhere",
      wrapFormat: "markdown",
      author: "Someone else",
    });
    expect(dirty()).toBe(false);
  });

  it("1. a refresh while clean still shows the new stored values", async () => {
    const root = await mountEditor();
    await run("refresh", { name: "Renamed elsewhere" });
    expect(field(root, "Name")).toBe("Renamed elsewhere");
    expect(dirty()).toBe(false);
  });

  it("2. typing during a running save survives the save landing and stays unsaved until saved", async () => {
    const root = await mountEditor();
    await run("type", "name", "First");
    await run("hold", "prompts.update");
    const [held] = updates(await run("save"));
    expect(held?.[3]).toMatchObject({ name: "First" });
    await run("type", "name", "Second");
    await run("type", "author", "New author");
    await run("release", "prompts.update");
    expect(field(root, "Name")).toBe("Second");
    expect(field(root, "Author")).toBe("New author");
    expect(dirty()).toBe(true);
    expect(root.textContent).toContain("Changes saved");

    // Back asks before leaving, and a second save stores the later typing.
    await run("back");
    expect(root.textContent).toContain("You have unsaved changes.");
    const [second] = updates(await run("save"));
    expect(second?.[3]).toMatchObject({ name: "Second", author: "New author" });
    expect(dirty()).toBe(false);
    expect(root.textContent).not.toContain("You have unsaved changes.");
  });

  it("5. opening another preset starts it clean", async () => {
    await mountEditor();
    await run("type", "name", "Unsaved");
    expect(dirty()).toBe(true);
    await run("switchPreset", "preset-2");
    expect(useUIStore.getState().presetDetailId).toBe("preset-2");
    expect(dirty()).toBe(false);
  });

  it("6. a header Save that leaves the draft clean takes the unsaved bar away", async () => {
    const root = await mountEditor();
    await run("type", "name", "Edited");
    await run("back");
    expect(root.textContent).toContain("You have unsaved changes.");
    await run("save");
    expect(root.textContent).not.toContain("You have unsaved changes.");
    expect(root.textContent).toContain("Changes saved");
  });

  it("7. a second Delete while the first runs neither asks again nor deletes twice; a failed delete can be retried", async () => {
    await mountEditor();
    await run("hold", "prompts.delete");
    const first = await run("delete");
    expect(deleteFlow(first)).toEqual(["confirm", "storage.delete"]);
    expect(await run("delete")).toEqual([]);
    await run("fail", "prompts.delete", "disk full");
    await run("release", "prompts.delete");
    const retry = await run("delete");
    expect(deleteFlow(retry)).toEqual(["confirm", "storage.delete"]);
  });

  it("9. the saved notice shows for 1.5 s after the latest save", async () => {
    const root = await mountEditor();
    await run("save");
    await run("wait", 1000);
    await run("save");
    await run("wait", 1000);
    expect(root.querySelector('[role="status"]')?.textContent).toBe("Changes saved");
    await run("wait", 500);
    expect(root.querySelector('[role="status"]')).toBeNull();
  });
});
