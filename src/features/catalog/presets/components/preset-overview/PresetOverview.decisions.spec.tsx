import { afterEach, describe, expect, it, vi } from "vitest";
import { PresetOverviewHarness, worldFor, type Recording } from "./preset-overview-replay-harness";
import show from "./test-fixtures/recorded-show.json";

// Spec decisions 1 to 3 (docs/provenance/preset-overview.md, "Decisions"), on the recorder's default world.

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

const buttonNamed = (root: HTMLElement, name: string) => root.querySelector(`button[aria-label="${name}"]`);
const railButtons = (root: HTMLElement) => [...root.querySelectorAll("nav button")];
const wrapButtons = (root: HTMLElement) =>
  [...root.querySelectorAll("button")].filter((button) => ["XML", "MARKDOWN", "NONE"].includes(button.textContent!));

describe("PresetEditorShell decisions", () => {
  it("1. names Back, Delete and the four inputs, and hides the icons", async () => {
    const root = await mountEditor();
    expect(buttonNamed(root, "Back")?.querySelector("svg.lucide-arrow-left")).not.toBeNull();
    expect(buttonNamed(root, "Delete preset")?.querySelector("svg.lucide-trash-2")).not.toBeNull();
    const names = [...root.querySelectorAll("input, textarea")].map((field) => [
      field.getAttribute("placeholder"),
      field.getAttribute("aria-label"),
    ]);
    expect(names).toEqual([
      ["Preset name…", "Preset name"],
      ["Preset name…", "Name"],
      ["What does this preset do?", "Description"],
      ["Your name (optional)", "Author"],
    ]);
    const expectIconsHidden = () => {
      const icons = [...root.querySelectorAll("svg")];
      expect(icons.length).toBeGreaterThan(10);
      for (const icon of icons) expect(icon.getAttribute("aria-hidden"), icon.outerHTML.slice(0, 80)).toBe("true");
    };
    expectIconsHidden();

    // With the unsaved bar and the save error bar showing (the warning icon and the dismiss X).
    await harness!.run(["type", "name", "Edited"]);
    await harness!.run(["back"]);
    await harness!.run(["fail", "prompts.update", "disk full"]);
    await harness!.run(["save"]);
    expect(root.textContent).toContain("You have unsaved changes.");
    expect(root.querySelector('[role="alert"] > svg')).not.toBeNull();
    expect(root.querySelector('button[aria-label="Dismiss save error"] svg.lucide-x')).not.toBeNull();
    expectIconsHidden();
  });

  it("2. marks the active tab, the pressed wrap format, the saved notice and the save error", async () => {
    const root = await mountEditor();
    const current = () => railButtons(root).map((button) => button.getAttribute("aria-current"));
    expect(current()).toEqual(["page", null, null]);
    await harness!.run(["tab", "Sections"]);
    expect(current()).toEqual([null, "page", null]);
    await harness!.run(["tab", "Overview"]);

    const pressed = () => wrapButtons(root).map((button) => button.getAttribute("aria-pressed"));
    expect(pressed()).toEqual(["true", "false", "false"]);
    await harness!.run(["wrap", "markdown"]);
    expect(pressed()).toEqual(["false", "true", "false"]);

    await harness!.run(["save"]);
    expect(root.querySelector('[role="status"]')?.textContent).toBe("Changes saved");
    await harness!.run(["wait", 1500]);
    expect(root.querySelector('[role="status"]')).toBeNull();

    await harness!.run(["fail", "prompts.update", "disk full"]);
    await harness!.run(["save"]);
    const alert = root.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe("Couldn't save preset. Try again.");
    expect(alert?.querySelector('button[aria-label="Dismiss save error"]')).not.toBeNull();
  });

  it("3. gives every button type=button", async () => {
    const root = await mountEditor();
    await harness!.run(["type", "name", "Edited"]);
    await harness!.run(["back"]);
    await harness!.run(["fail", "prompts.update", "disk full"]);
    await harness!.run(["save"]);
    const buttons = [...root.querySelectorAll("button")];
    // Header, the unsaved bar, the error bar, the rail, the help icons and the wrap buttons.
    expect(buttons.map((button) => button.textContent)).toEqual(
      expect.arrayContaining(["Save", "Keep editing", "Discard", "Save & close", "Overview", "XML"]),
    );
    for (const button of buttons) expect(button.getAttribute("type"), button.outerHTML.slice(0, 80)).toBe("button");
  });
});
