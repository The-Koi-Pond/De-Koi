import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useUIStore } from "../../../../../shared/stores/ui.store";
import { fakeToolStorage } from "./fake-tool-storage";
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
