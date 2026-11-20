import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useUIStore } from "../../../../../shared/stores/ui.store";
import { fakeRegexStorage, fakeStorageApi } from "./fake-regex-storage";
import { EditorHarness, FakeTrialWorker, setTrialWorkers, settle, type Recording } from "./regex-editor-replay-harness";
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

async function open(detailId: string | null, rows: Recording["rows"] = recording.rows) {
  harness = new EditorHarness({ rows }, { detailId, characters });
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

describe("Adversary fixes", () => {
  it("counts the name in code points like the storage schema, so 200 with emoji saves", async () => {
    const editor = await open("rx-1");
    await editor.type(editor.field(NAME), "a".repeat(195) + "😀".repeat(5));
    await editor.click(editor.button("Save"));
    expect(bannerText(editor)).toBeNull();
    expect(savesAndDeletes()).toHaveLength(1);

    await editor.type(editor.field(NAME), "a".repeat(196) + "😀".repeat(5));
    await editor.click(editor.button("Save"));
    expect(bannerText(editor)).toBe("Keep the name to 200 characters or fewer.");
    expect(savesAndDeletes()).toHaveLength(1);
  });

  it.each([
    ["name", { name: null }, "Give the script a name."],
    ["name", { name: undefined }, "Give the script a name."],
    ["findRegex", { findRegex: null }, "Add a find pattern."],
    ["findRegex", { findRegex: 7 }, "Add a find pattern."],
  ])("loads a row with a damaged %s as empty and explains instead of crashing", async (_field, damage, message) => {
    const damaged = { ...recording.rows[0]!, ...damage, id: "rx-damaged" };
    const editor = await open("rx-damaged", [...recording.rows, damaged]);
    const field = "name" in damage ? editor.field(NAME) : editor.field(FIND);
    expect(field.value).toBe("");
    await editor.click(editor.button("Save"));

    expect(bannerText(editor)).toBe(message);
    expect(savesAndDeletes()).toEqual([]);
    await editor.unmount();
    expect(editor.unhandled).toEqual([]);
    harness = null;
  });

  it("resets when another id opens that has no row, so the abandoned edits don't come back", async () => {
    const editor = await open("rx-1");
    await editor.type(editor.field(NAME), "Abandoned");
    await editor.type(editor.field(LIVE), "*hi*");
    await editor.run(["clickLabel", "Back to regex scripts"]);
    fakeRegexStorage.failNext("update", "nope");
    await editor.click(editor.button("Save"));
    expect(bannerText(editor)).toBe("nope");
    expect(useUIStore.getState().editorDirty).toBe(true);

    act(() => useUIStore.getState().openRegexDetail("gone"));
    await settle();
    expect(editor.element.textContent).toBe("Regex script not found.");
    expect(useUIStore.getState().editorDirty).toBe(false);

    act(() => useUIStore.getState().openRegexDetail("rx-1"));
    await settle();
    expect(editor.field(NAME).value).toBe("Strip asterisks");
    expect(editor.field(LIVE).value).toBe("");
    expect(bannerText(editor)).toBeNull();
    expect(editor.element.textContent).not.toContain("You have unsaved changes.");
    expect(useUIStore.getState().editorDirty).toBe(false);
  });

  it("doesn't bring a new script's draft back after a missing id", async () => {
    const editor = await open("__new__");
    await editor.type(editor.field(NAME), "Draft");
    await editor.type(editor.field(FIND), "x+");
    act(() => useUIStore.getState().openRegexDetail("gone"));
    await settle();
    expect(useUIStore.getState().editorDirty).toBe(false);

    act(() => useUIStore.getState().openRegexDetail("__new__"));
    await settle();
    expect(editor.field(NAME).value).toBe("New Regex Script");
    expect(editor.field(FIND).value).toBe("");
    expect(useUIStore.getState().editorDirty).toBe(false);
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

describe("Follow-ups after the rebuild", () => {
  function lastSave() {
    const call = savesAndDeletes().at(-1)!;
    return call[call.length - 1] as Record<string, unknown>;
  }

  it("cuts a decimal depth to a whole number instead of sending NaN", async () => {
    const editor = await open("rx-1");
    await editor.type(editor.field("Min"), ".5");
    await editor.type(editor.field("Max"), "2.9");
    expect(editor.field("Min").value).toBe("0");
    await editor.click(editor.button("Save"));

    expect(bannerText(editor)).toBeNull();
    expect(lastSave()).toMatchObject({ minDepth: 0, maxDepth: 2 });
  });

  it("Save & close won't send a pattern that doesn't compile", async () => {
    const editor = await open("rx-1");
    await editor.type(editor.field(FIND), "(");
    await editor.click(editor.buttonWith("aria-label", "Back to regex scripts"));
    await editor.click(editor.button("Save & close"));

    expect(useUIStore.getState()).toMatchObject({ regexDetailId: "rx-1", editorDirty: true });
    expect(bannerText(editor)).toMatch(/^Fix the find pattern first: Invalid regular expression/);
    expect(savesAndDeletes()).toEqual([]);
    expect(editor.field(FIND).value).toBe("(");
  });

  describe("Live Test tries every pattern in a background worker first", () => {
    const CATASTROPHIC = "(a+)+$";
    // The bundled Clean HTML script: nested repeats whose branches can't overlap, so it runs fast.
    const CLEAN_HTML = String.raw`[ \t]?<(?!--)(?!\/?(?:font|lie|filter)\b)(?:"[^"]*"|'[^']*'|[^'">])*>`;
    const REPLACE = "e.g. $1 or leave empty to remove";
    const wait = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

    afterEach(() => setTrialWorkers("run"));

    it("stops a pattern whose trial run takes too long, and says why", async () => {
      setTrialWorkers("hang");
      const editor = await open("rx-1");
      await editor.type(editor.field(FIND), CATASTROPHIC);
      await editor.type(editor.field(LIVE), "a".repeat(40) + "!");
      expect(editor.element.textContent).not.toContain("Live Test stopped");

      await wait(400);
      expect(editor.snapshot().result).toBeNull();
      expect(editor.element.textContent).toContain("Live Test stopped: this pattern took too long on this text");
      const last = FakeTrialWorker.made.at(-1)!;
      expect(last.jobs).toEqual([{ source: CATASTROPHIC, flags: "gi", text: "a".repeat(40) + "!" }]);
      expect(last.terminated).toBe(true);
      // Saving it is still the writer's call.
      await editor.click(editor.button("Save"));
      expect(lastSave()).toMatchObject({ findRegex: CATASTROPHIC });
    });

    it.each([String.raw`\*([^*]+)\*`, "[^](a+)+$|]", ".*.*.*.*.*.*.*.*=", String.raw`(\w|\d)+$`])(
      "never runs %s on the page before its trial answers",
      async (pattern) => {
        setTrialWorkers("hang");
        const editor = await open("rx-1");
        await editor.type(editor.field(FIND), pattern);
        await editor.type(editor.field(LIVE), "say *hi* " + "a".repeat(30));
        expect(editor.snapshot().result).toBeNull();
        await wait(400);
        expect(editor.snapshot().result).toBeNull();
        expect(editor.element.textContent).toContain("Live Test stopped");
      },
    );

    it("runs a nested pattern whose trial finishes quickly", async () => {
      const editor = await open("rx-1");
      await editor.type(editor.field(FIND), CLEAN_HTML);
      await editor.type(editor.field(REPLACE), "");
      await editor.type(editor.field(LIVE), 'a <b class="x">bold</b> <font>kept</font>');

      expect(editor.snapshot().result).toBe("abold <font>kept</font>");
      expect(editor.element.textContent).not.toContain("Live Test s");
    });

    it.each(["{{lastInput}}", "a{2,}", String.raw`\d{1,500}`, "(?:foo|bar)+", String.raw`(\s+)?$`])(
      "runs %s after its trial",
      async (pattern) => {
        const editor = await open("rx-1");
        await editor.type(editor.field(FIND), pattern);
        await editor.type(editor.field(LIVE), "aa foo 12 *x*");

        expect(editor.snapshot().result).not.toBeNull();
        expect(editor.element.textContent).not.toContain("Live Test s");
      },
    );

    it("tries and runs the very same pattern when a macro resolves differently each time", async () => {
      const editor = await open("rx-1");
      await editor.type(editor.field(REPLACE), "");
      for (let attempt = 0; attempt < 6; attempt += 1) {
        await editor.type(editor.field(FIND), `{{random::x::y}}${"+".repeat(attempt % 2)}`);
        await editor.type(editor.field(LIVE), `xy${attempt}`);
        const job = FakeTrialWorker.made.flatMap((worker) => worker.jobs).at(-1)!;
        expect(editor.snapshot().result).toBe(job.text.replace(new RegExp(job.source, job.flags), ""));
      }
    });

    it("keeps showing the last result while the next trial runs", async () => {
      const editor = await open("rx-1");
      await editor.type(editor.field(LIVE), "say *hi*");
      expect(editor.snapshot().result).toBe("say hi");

      setTrialWorkers("hang");
      await editor.type(editor.field(LIVE), "say *hi* " + "a".repeat(30));
      expect(editor.snapshot().result).toBe("say hi");
      await wait(400);
      expect(editor.snapshot().result).toBeNull();
      expect(editor.element.textContent).toContain("Live Test stopped");
    });

    it("says so where no background worker can run", async () => {
      setTrialWorkers("none");
      const editor = await open("rx-1");
      await editor.type(editor.field(LIVE), "say *hi*");

      expect(editor.snapshot().result).toBeNull();
      expect(editor.element.textContent).toContain("Live Test can't run here");
    });

    it("keeps one worker between quick trials and ends the rest", async () => {
      const editor = await open("rx-1");
      for (const text of ["a", "ab", "abc", "*abc*"]) await editor.type(editor.field(LIVE), text);
      expect(FakeTrialWorker.made.filter((worker) => !worker.terminated)).toHaveLength(1);
      await editor.unmount();
      harness = null;
      expect(FakeTrialWorker.made.filter((worker) => !worker.terminated).length).toBeLessThanOrEqual(1);
    });
  });

  it("keeps what was typed while a save was on its way, still unsaved", async () => {
    const editor = await open("rx-1");
    await editor.type(editor.field(NAME), "First");
    fakeRegexStorage.hold();
    await editor.click(editor.button("Save"));
    await editor.type(editor.field(NAME), "Second");
    act(() => fakeRegexStorage.release());
    await settle();

    expect(lastSave()).toMatchObject({ name: "First" });
    expect(editor.field(NAME).value).toBe("Second");
    expect(useUIStore.getState().editorDirty).toBe(true);

    await editor.click(editor.button("Save"));
    expect(lastSave()).toMatchObject({ name: "Second" });
    expect(editor.field(NAME).value).toBe("Second");
    expect(useUIStore.getState().editorDirty).toBe(false);
  });

  it("Save & close stays open when more was typed during the save", async () => {
    const editor = await open("rx-1");
    await editor.type(editor.field(NAME), "First");
    await editor.click(editor.buttonWith("aria-label", "Back to regex scripts"));
    fakeRegexStorage.hold();
    await editor.click(editor.button("Save & close"));
    await editor.type(editor.field(NAME), "Second");
    act(() => fakeRegexStorage.release());
    await settle();

    expect(useUIStore.getState()).toMatchObject({ regexDetailId: "rx-1", editorDirty: true });
    expect(editor.field(NAME).value).toBe("Second");
  });

  it("keeps what was typed during a new script's first save", async () => {
    const editor = await open("__new__");
    await editor.type(editor.field(FIND), "x+");
    await editor.type(editor.field(LIVE), "xxx y");
    fakeRegexStorage.hold();
    await editor.click(editor.button("Save"));
    await editor.type(editor.field(NAME), "Typed during");
    act(() => fakeRegexStorage.release());
    await settle();

    expect(useUIStore.getState()).toMatchObject({ regexDetailId: "created-1", editorDirty: true });
    expect(lastSave()).toMatchObject({ name: "New Regex Script", findRegex: "x+" });
    expect(editor.field(NAME).value).toBe("Typed during");
    expect(editor.field(FIND).value).toBe("x+");
    expect(editor.field(LIVE).value).toBe("xxx y");
  });

  /** Holds the list refresh until `releaseAll`, then lets later refreshes through. */
  function holdListRefresh() {
    const realList = fakeStorageApi.list.bind(fakeStorageApi);
    let waiting: Array<() => void> = [];
    let holding = true;
    const spy = vi.spyOn(fakeStorageApi, "list").mockImplementation(async (entity: string, options?: unknown) => {
      if (holding && entity === "regex-scripts") await new Promise<void>((resolve) => waiting.push(resolve));
      return realList(entity, options);
    });
    return {
      async releaseAll() {
        holding = false;
        const release = waiting;
        waiting = [];
        await act(async () => release.forEach((resolve) => resolve()));
        await settle();
      },
      restore: () => spy.mockRestore(),
    };
  }

  it("two saves in a row: the first one's refresh doesn't undo the second, or what was typed after it", async () => {
    const editor = await open("rx-1");
    await editor.type(editor.field(NAME), "First");
    const refresh = holdListRefresh();
    await editor.click(editor.button("Save"));
    await editor.type(editor.field(NAME), "Second");
    fakeRegexStorage.hold();
    await editor.click(editor.button("Save"));
    await editor.type(editor.field(NAME), "Third");
    await refresh.releaseAll();
    expect(editor.field(NAME).value).toBe("Third");

    act(() => fakeRegexStorage.release());
    await settle();
    expect(savesAndDeletes().map((call) => (call.at(-1) as { name: string }).name)).toEqual(["First", "Second"]);
    expect(editor.field(NAME).value).toBe("Third");
    expect(useUIStore.getState().editorDirty).toBe(true);
    refresh.restore();
  });

  it("two saves in a row, nothing typed after: the form stays on the second until it's saved", async () => {
    const editor = await open("rx-1");
    await editor.type(editor.field(NAME), "First");
    const refresh = holdListRefresh();
    await editor.click(editor.button("Save"));
    await editor.type(editor.field(NAME), "Second");
    fakeRegexStorage.hold();
    await editor.click(editor.button("Save"));
    await refresh.releaseAll();
    expect(editor.field(NAME).value).toBe("Second");
    expect(useUIStore.getState().editorDirty).toBe(true);

    act(() => fakeRegexStorage.release());
    await settle();
    expect(editor.field(NAME).value).toBe("Second");
    expect(useUIStore.getState().editorDirty).toBe(false);
    refresh.restore();
  });

  it("a save that finishes after another script opened leaves that script clean", async () => {
    const editor = await open("rx-1");
    await editor.type(editor.field(NAME), "First");
    fakeRegexStorage.hold();
    await editor.click(editor.button("Save"));
    await editor.type(editor.field(NAME), "Second");
    act(() => useUIStore.getState().openRegexDetail("rx-2"));
    await settle();
    act(() => fakeRegexStorage.release());
    await settle();

    expect(useUIStore.getState()).toMatchObject({ regexDetailId: "rx-2", editorDirty: false });
    expect(editor.element.textContent).not.toContain("Unsaved");
  });

  it("a save that stores nothing new still lets a later outside change reload the form", async () => {
    const editor = await open("rx-1");
    const toggle = () => editor.buttonWith("role", "switch");
    await editor.click(toggle());
    await editor.click(toggle());
    await editor.click(editor.button("Save"));
    await editor.type(editor.field(NAME), "Unsaved name");
    await act(() => fakeStorageUpdateElsewhere("rx-1", { name: "Changed elsewhere" }));
    await act(() => editor.queryClient.invalidateQueries({ queryKey: ["regex-scripts"] }));
    await settle();

    expect(editor.field(NAME).value).toBe("Changed elsewhere");
    expect(useUIStore.getState().editorDirty).toBe(false);
  });

  it("a save with nothing typed during it still reloads from the stored row", async () => {
    const editor = await open("rx-1");
    await editor.type(editor.field(NAME), "Renamed");
    fakeRegexStorage.hold();
    await editor.click(editor.button("Save"));
    act(() => fakeRegexStorage.release());
    await settle();

    expect(editor.field(NAME).value).toBe("Renamed");
    expect(useUIStore.getState().editorDirty).toBe(false);
    // A later change from elsewhere still reloads the form, as before.
    await act(() => fakeStorageUpdateElsewhere("rx-1", { name: "Changed elsewhere" }));
    await act(() => editor.queryClient.invalidateQueries({ queryKey: ["regex-scripts"] }));
    await settle();
    expect(editor.field(NAME).value).toBe("Changed elsewhere");
  });
});
