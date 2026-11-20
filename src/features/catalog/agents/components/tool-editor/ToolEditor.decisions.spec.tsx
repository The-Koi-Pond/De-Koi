import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useUIStore } from "../../../../../shared/stores/ui.store";
import { fakeToolStorage } from "./fake-tool-storage";
import { DUPLICATE_PARAMETER_NOTE, UNNAMED_PARAMETER_NOTE } from "./tool-form";
import { EditorHarness, settle, type Recording } from "./tool-editor-replay-harness";
import showJson from "./test-fixtures/recorded-show.json";

vi.mock("../../../../../shared/api/storage-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  storageApi: (await import("./fake-tool-storage")).fakeStorageApi,
}));
vi.mock("../../../../../shared/lib/app-dialogs", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  showConfirmDialog: (await import("./fake-tool-storage")).fakeConfirmDialog,
}));

// Starting data: the recorded rows (tool-1 is a plain static tool, tool-2 a webhook tool, tool-5 is
// switched off, tool-6 has enabled "false", tool-7 has enabled 1, tool-15 is an imported tool with extra
// schema keys and an `integer` parameter).
const recording = showJson as unknown as Recording;
const NAME = "tool_name";
const DESCRIPTION = "Describe what this tool does — the AI reads this to decide when to call it…";
const STATIC = '{"result": "OK"}';
const URL_FIELD = "https://api.example.com/my-tool";
const UNSAVED_BAR = "You have unsaved changes.";

let harness: EditorHarness | null = null;

async function open(detailId: string | null) {
  harness = new EditorHarness({ rows: recording.rows }, { detailId });
  await harness.mount();
  return harness;
}

afterEach(async () => {
  await harness?.unmount();
  harness = null;
});

function writes() {
  return fakeToolStorage.calls.filter((call) => ["create", "update", "delete"].includes(call[0] as string));
}

function lastPayload(): Record<string, unknown> {
  const write = writes().at(-1)!;
  return write[write.length - 1] as Record<string, unknown>;
}

function bannerText(editor: EditorHarness): string | null {
  return editor.element.querySelector(".bg-red-500\\/10 span")?.textContent ?? null;
}

function text(editor: EditorHarness): string {
  return editor.element.textContent ?? "";
}

async function openTool(id: string) {
  act(() => useUIStore.getState().openToolDetail(id));
  await settle();
}

describe("Decision 1: Save keeps a stored tool's on/off state", () => {
  it.each([
    ["tool-5", false], // enabled: false
    ["tool-6", false], // enabled: "false"
    ["tool-7", true], // enabled: 1
    ["tool-1", true], // enabled: true
  ])("%s saves enabled %s", async (id, enabled) => {
    const editor = await open(id);
    await editor.click(editor.button("Save"));

    expect(writes()).toHaveLength(1);
    expect(lastPayload().enabled).toBe(enabled);
    expect(fakeToolStorage.rows.find((row) => row.id === id)!.enabled).toBe(enabled);
  });

  it("reads enabled the way chats do, for values the recordings don't cover", async () => {
    const rows = [
      { ...recording.rows[0]!, id: "yes", enabled: "yes" },
      { ...recording.rows[0]!, id: "blank", enabled: "" },
    ];
    harness = new EditorHarness({ rows }, { detailId: "yes" });
    await harness.mount();
    await harness.click(harness.button("Save"));
    expect(lastPayload().enabled).toBe(true);
    await openTool("blank");
    await harness.click(harness.button("Save"));
    expect(lastPayload().enabled).toBe(false);
  });

  it("turns a new tool on", async () => {
    const editor = await open("__new__");
    await editor.type(editor.field(NAME), "new_tool");
    await editor.type(editor.field(DESCRIPTION), "Does a thing");
    await editor.type(editor.field(STATIC), "done");
    await editor.click(editor.button("Save"));

    expect(writes()[0]![0]).toBe("create");
    expect(lastPayload().enabled).toBe(true);
  });
});

describe("Decision 2: the unsaved bar hides once nothing is unsaved", () => {
  async function editAndLeave(id = "tool-1") {
    const editor = await open(id);
    await editor.type(editor.field(NAME), "x_y");
    await editor.click(editor.buttonWith("aria-label", "Back to tools"));
    expect(text(editor)).toContain(UNSAVED_BAR);
    return editor;
  }

  it("hides after a successful save from the header", async () => {
    const editor = await editAndLeave();
    await editor.click(editor.button("Save"));

    expect(text(editor)).not.toContain(UNSAVED_BAR);
    expect(useUIStore.getState()).toMatchObject({ toolDetailId: "tool-1", editorDirty: false });
  });

  it("hides when another tool opens", async () => {
    const editor = await editAndLeave();
    await openTool("tool-2");

    expect(text(editor)).not.toContain(UNSAVED_BAR);
    expect(editor.field(NAME).value).toBe("post_note");
  });

  it("hides when New opens", async () => {
    const editor = await editAndLeave();
    await openTool("__new__");

    expect(text(editor)).not.toContain(UNSAVED_BAR);
    expect(editor.field(NAME).value).toBe("");
  });

  it("hides when the list brings a changed copy of the row", async () => {
    const editor = await editAndLeave();
    fakeToolStorage.patchRow("tool-1", { description: "Changed elsewhere" });
    await editor.run(["refetch"]);

    expect(text(editor)).not.toContain(UNSAVED_BAR);
    expect(editor.field(DESCRIPTION).value).toBe("Changed elsewhere");
  });

  it("stays after a save that fails or can't be sent", async () => {
    const editor = await editAndLeave();
    fakeToolStorage.failNext("update", "server said no");
    await editor.click(editor.button("Save"));
    expect(text(editor)).toContain(UNSAVED_BAR);
    expect(bannerText(editor)).toBe("server said no");

    await editor.type(editor.field(NAME), "Bad");
    await editor.click(editor.button("Save"));
    expect(text(editor)).toContain(UNSAVED_BAR);
    expect(bannerText(editor)).toBe("Tool name must be lowercase snake_case (e.g. my_tool).");
  });

  it("stays when an unchanged list refresh keeps the edits", async () => {
    const editor = await editAndLeave();
    await editor.run(["refetch"]);

    expect(text(editor)).toContain(UNSAVED_BAR);
    expect(editor.field(NAME).value).toBe("x_y");
  });
});

describe("Decision 3: a failed delete is shown", () => {
  it("shows the error in the banner, stays open and leaves no unhandled rejection", async () => {
    const editor = await open("tool-1");
    fakeToolStorage.answerConfirm(true);
    fakeToolStorage.failNext("delete", "locked");
    await editor.click(editor.button("Delete"));

    expect(bannerText(editor)).toBe("Couldn't delete: locked");
    expect(useUIStore.getState().toolDetailId).toBe("tool-1");
    // It was a delete, not a save, so the header's save status says nothing.
    expect(text(editor)).not.toContain("Save failed");
    await editor.run(["dismissError"]);
    expect(bannerText(editor)).toBeNull();
    await editor.unmount();
    expect(editor.unhandled).toEqual([]);
    harness = null;
  });

  it("keeps the header's save status as it was", async () => {
    const editor = await open("tool-1");
    await editor.type(editor.field(NAME), "edited");
    fakeToolStorage.answerConfirm(true);
    fakeToolStorage.failNext("delete", "locked");
    await editor.click(editor.button("Delete"));

    expect(text(editor).startsWith("Unsaved Delete Save")).toBe(true);
    expect(editor.field(NAME).value).toBe("edited");
  });

  it("still closes after a confirmed delete that succeeds", async () => {
    const editor = await open("tool-1");
    fakeToolStorage.answerConfirm(true);
    await editor.click(editor.button("Delete"));

    expect(useUIStore.getState().toolDetailId).toBeNull();
    expect(fakeToolStorage.rows.some((row) => row.id === "tool-1")).toBe(false);
  });
});

describe("Decision 4: plain validation messages before sending", () => {
  it("shows one message at a time, in the spec's order, and sends nothing", async () => {
    const editor = await open("tool-2"); // a webhook tool
    const save = async () => {
      await editor.click(editor.button("Save"));
      return bannerText(editor);
    };

    await editor.type(editor.field(NAME), "");
    await editor.type(editor.field(DESCRIPTION), "");
    await editor.type(editor.field(URL_FIELD), "");
    expect(await save()).toBe("Tool name is required.");
    await editor.type(editor.field(NAME), "A".repeat(101));
    expect(await save()).toBe("Tool name must be lowercase snake_case (e.g. my_tool).");
    await editor.type(editor.field(NAME), "a".repeat(101));
    expect(await save()).toBe("Keep the tool name to 100 characters or fewer.");
    await editor.type(editor.field(NAME), "a".repeat(100));
    expect(await save()).toBe("Description is required.");
    await editor.type(editor.field(DESCRIPTION), "d".repeat(501));
    expect(await save()).toBe("Keep the description to 500 characters or fewer.");
    await editor.type(editor.field(DESCRIPTION), "d".repeat(500));
    expect(await save()).toBe("Webhook URL is required for a webhook custom tool.");
    await editor.type(editor.field(URL_FIELD), "example.com/no-scheme");
    expect(await save()).toBe("Enter a full webhook URL, like https://api.example.com/my-tool.");
    expect(writes()).toEqual([]);
    expect(text(editor)).toContain("Save failed");

    await editor.type(editor.field(URL_FIELD), "https://example.com/ok");
    expect(await save()).toBeNull();
    expect(writes()).toHaveLength(1);
  });

  it("checks the URL only while Webhook is selected", async () => {
    const editor = await open("tool-21"); // a webhook tool with "not a url"
    await editor.click(editor.button("Static Result"));
    await editor.type(editor.field(STATIC), "fixed");
    await editor.click(editor.button("Save"));

    expect(bannerText(editor)).toBeNull();
    expect(lastPayload()).toMatchObject({ executionType: "static", webhookUrl: null, staticResult: "fixed" });
  });

  it("still sends a URL the schema accepts (decision 7: ftp stays allowed)", async () => {
    const editor = await open("tool-22");
    await editor.click(editor.button("Save"));

    expect(bannerText(editor)).toBeNull();
    expect(lastPayload().webhookUrl).toBe("ftp://example.com/x");
  });
});

describe("Decision 5: imported tools keep their details", () => {
  it("shows an unknown stored type as a sixth option, selected, and drops it once another is picked", async () => {
    const editor = await open("tool-15");
    const intval = editor.typeSelect(4);
    expect([...intval.options].map((option) => option.value)).toEqual([
      "string",
      "number",
      "boolean",
      "array",
      "object",
      "integer",
    ]);
    expect(intval.value).toBe("integer");
    // The other rows offer the five types only.
    expect(editor.typeSelect(0).options).toHaveLength(5);

    await editor.choose(editor.typeSelect(4), "number");
    expect([...editor.typeSelect(4).options].map((option) => option.value)).toEqual([
      "string",
      "number",
      "boolean",
      "array",
      "object",
    ]);
    await editor.click(editor.button("Save"));
    const schema = lastPayload().parametersSchema as { properties: Record<string, unknown> };
    expect(schema.properties.intval).toEqual({ type: "number", description: "An integer" });
  });

  it("keeps each property's other keys and the schema's other keys, also after renaming a row", async () => {
    const editor = await open("tool-15");
    await editor.type(editor.field("param_name", 0), "units");
    await editor.click(editor.button("Save"));

    expect(JSON.stringify(lastPayload().parametersSchema)).toBe(
      JSON.stringify({
        type: "object",
        properties: {
          units: { type: "string", description: "Unit", enum: ["c", "f"], default: "c" },
          tags: { type: "array", description: "", items: { type: "string" } },
          notype: { type: "string", description: "No type here" },
          nodesc: { type: "boolean", description: "" },
          intval: { type: "integer", description: "An integer" },
          nested: { type: "object", description: "", properties: { a: { type: "string" } } },
        },
        required: ["units", "intval"],
        description: "top-level note",
        additionalProperties: false,
      }),
    );
  });

  it("leaves tools made in the editor unchanged", async () => {
    const editor = await open("__new__");
    await editor.type(editor.field(NAME), "made_here");
    await editor.type(editor.field(DESCRIPTION), "Made here");
    await editor.type(editor.field(STATIC), "ok");
    await editor.click(editor.button("Add Parameter"));
    await editor.type(editor.field("param_name"), "q");
    await editor.click(editor.button("Save"));

    expect(JSON.stringify(lastPayload().parametersSchema)).toBe(
      JSON.stringify({ type: "object", properties: { q: { type: "string", description: "" } }, required: [] }),
    );
  });
});

describe("Decision 6: controls are announced", () => {
  it("marks the selected execution type as pressed", async () => {
    const editor = await open("tool-1");
    expect(editor.button("Static Result").getAttribute("aria-pressed")).toBe("true");
    expect(editor.button("Webhook").getAttribute("aria-pressed")).toBe("false");

    await editor.click(editor.button("Webhook"));
    expect(editor.button("Static Result").getAttribute("aria-pressed")).toBe("false");
    expect(editor.button("Webhook").getAttribute("aria-pressed")).toBe("true");
  });

  it("names the remove button, the header name and every row control", async () => {
    const editor = await open("tool-1");
    const named = (label: string) => editor.element.querySelectorAll(`[aria-label="${label}"]`);

    expect(named("Remove parameter")).toHaveLength(2);
    expect(named("Remove parameter")[0]!.tagName).toBe("BUTTON");
    expect(named("Tool name")).toHaveLength(1);
    expect((named("Tool name")[0] as HTMLInputElement).value).toBe("check_weather");
    expect(named("Parameter name")).toHaveLength(2);
    expect(named("Parameter type")).toHaveLength(2);
    expect(named("Parameter type")[0]!.tagName).toBe("SELECT");
    expect(named("Parameter description")).toHaveLength(2);
    // The Required checkbox is named by its own visible label.
    expect(editor.requiredBox(0).closest("label")?.textContent).toBe("Required");
  });
});

describe("Decision 3: a save clears the delete error", () => {
  it("replaces the delete error with the save's own result", async () => {
    const editor = await open("tool-1");
    fakeToolStorage.answerConfirm(true);
    fakeToolStorage.failNext("delete", "locked");
    await editor.click(editor.button("Delete"));
    expect(bannerText(editor)).toBe("Couldn't delete: locked");

    await editor.type(editor.field(NAME), "Bad");
    await editor.click(editor.button("Save"));
    expect(bannerText(editor)).toBe("Tool name must be lowercase snake_case (e.g. my_tool).");

    await editor.type(editor.field(NAME), "renamed");
    await editor.click(editor.button("Save"));
    expect(bannerText(editor)).toBeNull();
    expect(text(editor)).toContain("Saved");
  });
});

describe("Decision 5: non-string stored types and descriptions", () => {
  const imported = {
    ...recording.rows[0]!,
    id: "imported",
    parametersSchema: {
      type: "object",
      properties: {
        q: { type: ["string", "null"], description: 9 },
        n: { type: 5, description: null },
      },
      required: [],
    },
  };

  async function openImported() {
    harness = new EditorHarness({ rows: [imported] }, { detailId: "imported" });
    await harness.mount();
    return harness;
  }

  it("shows them as text and saves them as stored", async () => {
    const editor = await openImported();
    expect(editor.typeSelect(0).value).toBe('["string","null"]');
    expect([...editor.typeSelect(0).options].map((option) => option.value)).toHaveLength(6);
    expect(editor.typeSelect(1).value).toBe("5");
    expect(editor.field("Description of this parameter…", 0).value).toBe("9");
    // Missing or null keeps the old default.
    expect(editor.field("Description of this parameter…", 1).value).toBe("");
    await editor.click(editor.button("Save"));

    expect(JSON.stringify((lastPayload().parametersSchema as { properties: unknown }).properties)).toBe(
      JSON.stringify({
        q: { type: ["string", "null"], description: 9 },
        n: { type: 5, description: "" },
      }),
    );
  });

  it("drops the stored type once another is picked, and the stored description once the user types", async () => {
    const editor = await openImported();
    await editor.choose(editor.typeSelect(0), "number");
    expect(editor.typeSelect(0).options).toHaveLength(5);
    await editor.type(editor.field("Description of this parameter…", 0), "typed");
    await editor.click(editor.button("Save"));

    const properties = (lastPayload().parametersSchema as { properties: Record<string, unknown> }).properties;
    expect(properties.q).toEqual({ type: "number", description: "typed" });
    expect(properties.n).toEqual({ type: 5, description: "" });
  });
});

describe("A save that finishes after the user moved on", () => {
  async function holdSaveOfEditedTool() {
    const editor = await open("tool-1");
    await editor.type(editor.field(NAME), "tool_a2");
    fakeToolStorage.hold();
    await editor.click(editor.button("Save"));
    expect(text(editor)).toContain("Saving");
    return editor;
  }

  it("leaves another tool opened meanwhile alone", async () => {
    const editor = await holdSaveOfEditedTool();
    await openTool("tool-2");
    await editor.run(["release"]);

    expect(useUIStore.getState()).toMatchObject({ toolDetailId: "tool-2", editorDirty: false });
    expect(editor.field(NAME).value).toBe("post_note");
    expect(editor.field(URL_FIELD).value).toBe("https://example.com/hook");
    expect(text(editor)).not.toContain("Saved");
    expect(writes()).toEqual([["update", "custom-tools", "tool-1", expect.objectContaining({ name: "tool_a2" })]]);

    await editor.click(editor.button("Save"));
    expect(writes()).toHaveLength(2);
    expect(writes()[1]!.slice(0, 3)).toEqual(["update", "custom-tools", "tool-2"]);
    expect(lastPayload()).toMatchObject({ name: "post_note", webhookUrl: "https://example.com/hook" });
  });

  it("leaves a new tool opened meanwhile alone", async () => {
    const editor = await holdSaveOfEditedTool();
    await openTool("__new__");
    await editor.run(["release"]);

    expect(useUIStore.getState()).toMatchObject({ toolDetailId: "__new__", editorDirty: false });
    expect(editor.field(NAME).value).toBe("");
    expect(editor.field(DESCRIPTION).value).toBe("");
    expect(editor.field(STATIC).value).toBe("");
    expect(writes()).toHaveLength(1);

    await editor.click(editor.button("Save"));
    expect(bannerText(editor)).toBe("Tool name is required.");
    expect(writes()).toHaveLength(1);
  });

  it("doesn't show its error on the tool opened meanwhile", async () => {
    const editor = await holdSaveOfEditedTool();
    fakeToolStorage.failNext("update", "server said no");
    await openTool("tool-2");
    await editor.run(["release"]);

    expect(bannerText(editor)).toBeNull();
    expect(text(editor)).not.toContain("Save failed");
  });
});

describe("Typing while a save runs", () => {
  it("keeps the edits, unsaved, when the saved row is unchanged", async () => {
    const editor = await open("tool-1");
    fakeToolStorage.hold();
    await editor.click(editor.button("Save"));
    await editor.type(editor.field(NAME), "typed_meanwhile");
    await editor.run(["release"]);

    expect(editor.field(NAME).value).toBe("typed_meanwhile");
    expect(useUIStore.getState().editorDirty).toBe(true);
    expect(text(editor).startsWith("Unsaved")).toBe(true);
  });

  it("keeps the edits, unsaved, when the saved row changed", async () => {
    const editor = await open("tool-1");
    await editor.type(editor.field(NAME), "x_y");
    await editor.click(editor.button("Add Parameter"));
    fakeToolStorage.hold();
    await editor.click(editor.button("Save"));
    await editor.type(editor.field(DESCRIPTION), "Typed meanwhile");
    await editor.run(["release"]);
    await editor.run(["refetch"]);

    expect(fakeToolStorage.rows.find((row) => row.id === "tool-1")).toMatchObject({ name: "x_y" });
    expect(editor.field(NAME).value).toBe("x_y");
    expect(editor.field(DESCRIPTION).value).toBe("Typed meanwhile");
    // No reload happened, so the nameless row is still there.
    expect(editor.element.querySelectorAll("select")).toHaveLength(3);
    expect(useUIStore.getState().editorDirty).toBe(true);

    await editor.click(editor.button("Save"));
    expect(lastPayload()).toMatchObject({ name: "x_y", description: "Typed meanwhile" });
    expect(useUIStore.getState().editorDirty).toBe(false);
    expect(editor.element.querySelectorAll("select")).toHaveLength(2);
  });

  it("still reloads a later change made elsewhere", async () => {
    const editor = await open("tool-1");
    fakeToolStorage.hold();
    await editor.click(editor.button("Save"));
    await editor.type(editor.field(NAME), "typed_meanwhile");
    await editor.run(["release"]);
    fakeToolStorage.patchRow("tool-1", { description: "Changed elsewhere" });
    await editor.run(["refetch"]);

    expect(editor.field(DESCRIPTION).value).toBe("Changed elsewhere");
    expect(editor.field(NAME).value).toBe("check_weather");
  });
});

describe("Follow-up: parameter rows say when Save will lose them", () => {
  const notesShown = (editor: EditorHarness) =>
    [...editor.element.querySelectorAll("[aria-label='Parameter name']")].map((input) => {
      const id = input.getAttribute("aria-describedby");
      return id ? (editor.element.querySelector(`[id="${id}"]`)?.textContent ?? "(missing)") : null;
    });

  it("says a row with no name won't be saved, until it has one", async () => {
    const editor = await open("tool-1");
    await editor.click(editor.button("Add Parameter"));
    expect(notesShown(editor)).toEqual([null, null, UNNAMED_PARAMETER_NOTE]);

    await editor.type(editor.field("param_name", 2), "   ");
    expect(notesShown(editor)).toEqual([null, null, UNNAMED_PARAMETER_NOTE]);
    await editor.type(editor.field("param_name", 2), "units");
    expect(notesShown(editor)).toEqual([null, null, null]);
  });

  it("warns every row sharing a name, and Save still keeps the last one", async () => {
    const editor = await open("tool-1");
    await editor.click(editor.button("Add Parameter"));
    await editor.type(editor.field("param_name", 2), "city");
    expect(notesShown(editor)).toEqual([DUPLICATE_PARAMETER_NOTE, null, DUPLICATE_PARAMETER_NOTE]);
    const note = editor.element.querySelector(`[id="${editor.field("param_name").getAttribute("aria-describedby")}"]`)!;
    expect(note.className).toContain("text-amber-800");
    expect(note.className).toContain("dark:text-amber-200");

    // Names are compared exactly, as Save does.
    await editor.type(editor.field("param_name", 2), "City");
    expect(notesShown(editor)).toEqual([null, null, null]);
    await editor.type(editor.field("param_name", 2), "city");
    await editor.type(editor.field("Description of this parameter…", 2), "Last city");
    await editor.click(editor.button("Save"));

    const schema = lastPayload().parametersSchema as { properties: Record<string, { description: string }> };
    expect(Object.keys(schema.properties)).toEqual(["city", "days"]);
    expect(schema.properties.city!.description).toBe("Last city");
  });

  it("drops the notes once the rows are gone", async () => {
    const editor = await open("tool-1");
    await editor.click(editor.button("Add Parameter"));
    await editor.click(editor.buttonWith("aria-label", "Remove parameter", 2));
    expect(notesShown(editor)).toEqual([null, null]);
    expect(text(editor)).not.toContain(UNNAMED_PARAMETER_NOTE);
  });
});

describe("Follow-up: a create that answers without an id", () => {
  async function fillNew(name = "new_tool") {
    const editor = await open("__new__");
    await editor.type(editor.field(NAME), name);
    await editor.type(editor.field(DESCRIPTION), "Does a thing");
    await editor.type(editor.field(STATIC), "done");
    return editor;
  }

  it("opens the new row, so a second Save updates it", async () => {
    const editor = await fillNew();
    fakeToolStorage.createNoId();
    await editor.click(editor.button("Save"));
    expect(useUIStore.getState().toolDetailId).toBe("created-1");

    await editor.type(editor.field(STATIC), "done again");
    await editor.click(editor.button("Save"));
    expect(writes().map((call) => [call[0], call[2]])).toEqual([
      ["create", expect.any(Object)],
      ["update", "created-1"],
    ]);
    expect(fakeToolStorage.rows.filter((row) => row.name === "new_tool")).toHaveLength(1);
  });

  it("finds it even when another tool already has that name", async () => {
    const editor = await fillNew("check_weather");
    fakeToolStorage.createNoId();
    await editor.click(editor.button("Save"));
    expect(useUIStore.getState().toolDetailId).toBe("created-1");
  });

  it("goes back to the list when the new row can't be told apart, instead of creating it twice", async () => {
    const editor = await fillNew();
    fakeToolStorage.createNoId();
    fakeToolStorage.hold();
    await editor.click(editor.button("Save"));
    // Another tab saves a tool with the same name while this create runs.
    fakeToolStorage.insertRow({ ...recording.rows[0]!, id: "elsewhere", name: "new_tool" });
    await act(async () => fakeToolStorage.release());
    await settle();

    expect(useUIStore.getState().toolDetailId).toBeNull();
    expect(writes().filter((call) => call[0] === "create")).toHaveLength(1);
  });
});

describe("Follow-up: the script warning reads in both themes", () => {
  it("uses dark amber text in light theme and pale amber in dark theme", async () => {
    const editor = await open("tool-8");
    const warning = [...editor.element.querySelectorAll("div")].find((div) =>
      div.textContent?.startsWith("Script custom tools are disabled"),
    )!;
    expect(warning.className.split(" ")).toEqual(expect.arrayContaining(["text-amber-800", "dark:text-amber-200"]));
    expect(warning.className.split(" ")).not.toContain("text-amber-200");
  });
});
