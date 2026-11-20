import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useUIStore } from "../../../../../shared/stores/ui.store";
import { fakeRegexStorage } from "./fake-regex-storage";
import { EditorHarness, settle, type Recording } from "./regex-editor-replay-harness";
import showJson from "./test-fixtures/recorded-show.json";

vi.mock("../../../../../shared/api/storage-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  storageApi: (await import("./fake-regex-storage")).fakeStorageApi,
}));
vi.mock("../../../../../shared/lib/app-dialogs", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  showConfirmDialog: (await import("./fake-regex-storage")).fakeConfirmDialog,
}));

// Starting data: the recorded rows and characters.
const recording = showJson as unknown as Recording;
const characters = recording.scenarios.find((scenario) => scenario.id === "show:plain")!.characters;
const FIND = "e.g. \\\\*([^*]+)\\\\*";
const LIVE = "Paste sample text to test…";
const NAME = "Script name…";

let harness: EditorHarness | null = null;

async function open(detailId: string | null) {
  harness = new EditorHarness(recording, { detailId, characters });
  await harness.mount();
  return harness;
}

afterEach(async () => {
  await harness?.unmount();
  harness = null;
});

function savesAndDeletes() {
  return fakeRegexStorage.calls.filter((call) => ["create", "update", "delete"].includes(call[0] as string));
}

function bannerText(editor: EditorHarness): string | null {
  return editor.element.querySelector(".bg-red-500\\/10 span")?.textContent ?? null;
}

describe("Decision 1: Save & close stays open when the save fails", () => {
  it("keeps the edits, shows the error and hides the unsaved bar", async () => {
    const editor = await open("rx-1");
    await editor.type(editor.field(NAME), "Edited");
    await editor.click(editor.buttonWith("aria-label", "Back to regex scripts"));
    expect(editor.element.textContent).toContain("You have unsaved changes.");
    fakeRegexStorage.failNext("update", "disk full");
    await editor.click(editor.button("Save & close"));

    expect(useUIStore.getState()).toMatchObject({ regexDetailId: "rx-1", editorDirty: true });
    expect(bannerText(editor)).toBe("disk full");
    expect(editor.element.textContent).not.toContain("You have unsaved changes.");
    expect(editor.field(NAME).value).toBe("Edited");
    expect(savesAndDeletes()).toHaveLength(1);
  });

  it("stays open when the form can't be sent", async () => {
    const editor = await open("rx-1");
    await editor.type(editor.field(NAME), "");
    await editor.click(editor.buttonWith("aria-label", "Back to regex scripts"));
    await editor.click(editor.button("Save & close"));

    expect(useUIStore.getState().regexDetailId).toBe("rx-1");
    expect(bannerText(editor)).toBe("Give the script a name.");
    expect(editor.element.textContent).not.toContain("You have unsaved changes.");
  });

  it("still closes after a successful save", async () => {
    const editor = await open("rx-1");
    await editor.type(editor.field(NAME), "Edited");
    await editor.click(editor.buttonWith("aria-label", "Back to regex scripts"));
    await editor.click(editor.button("Save & close"));

    expect(useUIStore.getState()).toMatchObject({ regexDetailId: null, editorDirty: false });
  });
});

describe("Decision 2: the Live Test text survives a reload of the same script only", () => {
  it("keeps the text and result after a save reloads the script", async () => {
    const editor = await open("rx-1");
    await editor.type(editor.field(LIVE), "*hi*");
    await editor.type(editor.field(NAME), "Renamed");
    await editor.click(editor.button("Save"));

    expect(editor.field(NAME).value).toBe("Renamed");
    expect(editor.field(LIVE).value).toBe("*hi*");
    expect(editor.snapshot().result).toBe("hi");
  });

  it("keeps the text when another part of the app changes the stored row", async () => {
    const editor = await open("rx-1");
    await editor.type(editor.field(LIVE), "*hi*");
    await editor.type(editor.field(NAME), "Unsaved name");
    await act(() => fakeStorageUpdateElsewhere("rx-1", { name: "Changed elsewhere" }));
    await act(() => editor.queryClient.invalidateQueries({ queryKey: ["regex-scripts"] }));
    await settle();

    // The form reloads from the new copy of the row, but the sample text stays.
    expect(editor.field(NAME).value).toBe("Changed elsewhere");
    expect(useUIStore.getState().editorDirty).toBe(false);
    expect(editor.field(LIVE).value).toBe("*hi*");
  });

  it("keeps the text when a new script is created and opens as the stored script", async () => {
    const editor = await open("__new__");
    await editor.type(editor.field(FIND), "x+");
    await editor.type(editor.field(LIVE), "xxx y");
    await editor.click(editor.button("Save"));

    expect(useUIStore.getState().regexDetailId).toBe("created-1");
    expect(editor.field(LIVE).value).toBe("xxx y");
    expect(editor.snapshot().result).toBe(" y");
  });

  it("clears the text when another script opens", async () => {
    const editor = await open("rx-1");
    await editor.type(editor.field(LIVE), "*hi*");
    act(() => useUIStore.getState().openRegexDetail("rx-2"));
    await settle();

    expect(editor.field(LIVE).value).toBe("");
    expect(editor.snapshot().result).toBeNull();
  });

  it("clears the text when a new script opens", async () => {
    const editor = await open("rx-1");
    await editor.type(editor.field(LIVE), "*hi*");
    act(() => useUIStore.getState().openRegexDetail("__new__"));
    await settle();

    expect(editor.field(NAME).value).toBe("New Regex Script");
    expect(editor.field(LIVE).value).toBe("");
  });
});

/** Another tab or the list's own toggle writing the stored row, outside this editor. */
async function fakeStorageUpdateElsewhere(id: string, patch: Record<string, unknown>) {
  const { fakeStorageApi } = await import("./fake-regex-storage");
  await fakeStorageApi.update("regex-scripts", id, patch);
}

describe("Decision 3: a failed delete is shown", () => {
  it("shows the error in the banner, stays open and leaves no unhandled rejection", async () => {
    const editor = await open("rx-1");
    fakeRegexStorage.answerConfirm(true);
    fakeRegexStorage.failNext("delete", "locked");
    await editor.click(editor.button("Delete"));

    expect(bannerText(editor)).toBe("Couldn't delete: locked");
    expect(useUIStore.getState().regexDetailId).toBe("rx-1");
    // It was a delete, not a save, so the header doesn't say "Save failed".
    expect(editor.element.textContent).not.toContain("Save failed");
    await editor.run(["dismissError"]);
    expect(bannerText(editor)).toBeNull();
    await editor.unmount();
    expect(editor.unhandled).toEqual([]);
    harness = null;
  });

  it("still closes after a confirmed delete that succeeds", async () => {
    const editor = await open("rx-1");
    fakeRegexStorage.answerConfirm(true);
    await editor.click(editor.button("Delete"));

    expect(useUIStore.getState().regexDetailId).toBeNull();
    expect(fakeRegexStorage.rows.some((row) => row.id === "rx-1")).toBe(false);
  });
});

describe("Decision 4: plain validation messages before sending", () => {
  it("shows one message at a time, in the spec's order, and sends nothing", async () => {
    const editor = await open("rx-13"); // stored with no place to apply
    await editor.type(editor.field(NAME), "");
    await editor.type(editor.field(FIND), "");
    const save = async () => {
      await editor.click(editor.button("Save"));
      return bannerText(editor);
    };

    expect(await save()).toBe("Give the script a name.");
    await editor.type(editor.field(NAME), "N".repeat(201));
    expect(await save()).toBe("Keep the name to 200 characters or fewer.");
    await editor.type(editor.field(NAME), "N".repeat(200));
    expect(await save()).toBe("Add a find pattern.");
    await editor.type(editor.field(FIND), "a");
    expect(await save()).toBe("Pick where it applies: AI Output, User Input or both.");
    expect(savesAndDeletes()).toEqual([]);
    expect(editor.element.textContent).toContain("Save failed");

    await editor.click(editor.button("User InputApplied to your messages before they are sent."));
    expect(await save()).toBeNull();
    expect(savesAndDeletes()).toHaveLength(1);
  });
});

describe("Decision 5: toggles are announced", () => {
  it("gives the on/off switch a switch role, its state and a label", async () => {
    const editor = await open("rx-1");
    const toggle = () => editor.buttonWith("role", "switch");
    expect(toggle().getAttribute("aria-label")).toBe("Enabled");
    expect(toggle().getAttribute("aria-checked")).toBe("true");
    await editor.click(toggle());
    expect(toggle().getAttribute("aria-checked")).toBe("false");
    expect(toggle().getAttribute("title")).toBe("Disabled");
    expect(toggle().getAttribute("aria-label")).toBe("Enabled");
  });

  it("marks flag, Apply To, Global and character buttons with aria-pressed", async () => {
    const editor = await open("rx-17"); // gi, AI Output, characters zelda and Ada
    const pressed = (text: string) => editor.button(text).getAttribute("aria-pressed");
    expect(["g", "i", "m", "s", "u"].map(pressed)).toEqual(["true", "true", "false", "false", "false"]);
    expect(pressed("AI OutputApplied to AI responses before they are displayed.")).toBe("true");
    expect(pressed("User InputApplied to your messages before they are sent.")).toBe("false");
    expect(pressed("Global")).toBe("false");
    expect(editor.characterRows().map((row) => [row.textContent, row.getAttribute("aria-pressed")])).toEqual([
      ["Ada", "true"],
      ["Bram", "false"],
      ["char-empty", "false"],
      ["Ünal", "false"],
      ["zelda", "true"],
    ]);

    await editor.click(editor.button("Global"));
    expect(pressed("Global")).toBe("true");
    expect(editor.characterRows().every((row) => row.getAttribute("aria-pressed") === "false")).toBe(true);
    await editor.click(editor.button("m"));
    expect(pressed("m")).toBe("true");
  });

  it("labels the trim row's remove button", async () => {
    const editor = await open("rx-23"); // three trim strings
    const removers = editor.buttons().filter((button) => button.getAttribute("aria-label") === "Remove trim string");
    expect(removers).toHaveLength(3);
    await editor.click(removers[0]!);
    expect(
      editor.buttons().filter((button) => button.getAttribute("aria-label") === "Remove trim string"),
    ).toHaveLength(2);
  });
});
