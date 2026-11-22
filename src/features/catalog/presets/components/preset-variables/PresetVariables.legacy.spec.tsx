import { afterEach, describe, expect, it, vi } from "vitest";
import { fakePresetVariablesApis } from "./fake-preset-variables-apis";
import { VariablesHarness, type Step } from "./preset-variables-replay-harness";

// Old behavior with stored rows whose fields aren't text (missing, `null`, numbers, booleans) or whose ids are bad,
// found by running the old and new lists side by side. The rebuild keeps it (follow-ups may change it later), like
// the replay keeps the recorded behavior.

vi.mock("../../../../../shared/api/storage-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  storageApi: (await import("./fake-preset-variables-apis")).fakeStorageApi,
}));
vi.mock("../../../../../shared/api/prompt-nested-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  promptNestedApi: (await import("./fake-preset-variables-apis")).fakePromptNestedApi,
}));
vi.mock("../../../../../shared/lib/app-dialogs", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  showConfirmDialog: (await import("./fake-preset-variables-apis")).fakeConfirmDialog,
}));
vi.mock("sonner", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: (await import("./fake-preset-variables-apis")).fakeToast,
}));

type Row = Record<string, unknown> & { id: string };

let harness: VariablesHarness | null = null;

/** Mounts the list over these stored rows (filled in with plain defaults). */
async function mountRows(rows: Array<Record<string, unknown>>) {
  await harness?.unmount();
  const variables = rows.map(
    (row, index) =>
      ({
        presetId: "preset-1",
        variableName: `VAR_${index}`,
        question: "Question?",
        options: [{ id: `o-${index}`, label: "Only", value: "only" }],
        multiSelect: false,
        randomPick: false,
        separator: ", ",
        ...row,
      }) as unknown as Row,
  );
  harness = new VariablesHarness({
    variables,
    preset: { id: "preset-1", name: "Preset", variableOrder: variables.map((row) => row.id) },
  });
  await harness.run(["mount"]);
  return harness;
}

async function steps(list: VariablesHarness, ...run: Step[]) {
  for (const step of run) await list.run(step);
}

/** The `mutate` calls the list made, as `[name, payload]`. */
function mutations(): Array<[unknown, unknown]> {
  return fakePresetVariablesApis.calls.filter((call) => call[0] === "mutate").map((call) => [call[1], call[2]]);
}

afterEach(async () => {
  await harness?.unmount();
  harness = null;
});

describe("PresetVariablesEditor keeps the old behavior for odd stored rows", () => {
  it("1: closing the value editor without typing saves nothing when the stored value is missing, null, 0 or false", async () => {
    const cases: Array<[Record<string, unknown>, Step]> = [
      [{ id: "o", label: "Missing" }, ["close"]],
      [{ id: "o", label: "Null", value: null }, ["done"]],
      [{ id: "o", label: "Zero", value: 0 }, ["key", "body", "Escape"]],
      [{ id: "o", label: "False", value: false }, ["backdrop"]],
    ];
    for (const [option, close] of cases) {
      const list = await mountRows([{ id: "v", options: [option, { id: "p", label: "Other", value: "other" }] }]);
      await steps(list, ["toggle", 0], ["expandValue", 0], ["wait", 100], close);
      expect(list.modalRoot(), JSON.stringify(option)).toBeNull();
      expect(mutations(), JSON.stringify(option)).toEqual([]);
    }
  });

  it("2: typing into a missing label (or a value stored as 0) and back to empty saves the empty text", async () => {
    let list = await mountRows([
      {
        id: "v",
        options: [
          { id: "o", value: "kept" },
          { id: "p", label: "B", value: "b" },
        ],
      },
    ]);
    await steps(list, ["toggle", 0], ["focus", "label:0"], ["type", "label:0", "x"], ["type", "label:0", ""]);
    await steps(list, ["blur", "label:0"]);
    expect(mutations()).toEqual([
      [
        "update",
        {
          presetId: "preset-1",
          variableId: "v",
          options: [
            { id: "o", value: "kept", label: "" },
            { id: "p", label: "B", value: "b" },
          ],
        },
      ],
    ]);

    list = await mountRows([
      {
        id: "v",
        options: [
          { id: "o", label: "A", value: 0 },
          { id: "p", label: "B", value: "b" },
        ],
      },
    ]);
    await steps(list, ["toggle", 0], ["focus", "value:0"], ["type", "value:0", "x"], ["type", "value:0", ""]);
    await steps(list, ["blur", "value:0"]);
    expect(mutations()).toEqual([
      [
        "update",
        {
          presetId: "preset-1",
          variableId: "v",
          options: [
            { id: "o", label: "A", value: "" },
            { id: "p", label: "B", value: "b" },
          ],
        },
      ],
    ]);
  });

  it("3: typed text is compared strictly with a stored number, so typing it back still saves", async () => {
    const list = await mountRows([
      {
        id: "v",
        variableName: 42,
        question: 7,
        options: [
          { id: "o", label: 5, value: 0 },
          { id: "p", label: "B", value: "b" },
        ],
      },
    ]);
    await steps(list, ["toggle", 0]);
    expect((list.field("name") as HTMLInputElement).value).toBe("42");
    await steps(list, ["focus", "name"], ["type", "name", "421"], ["type", "name", "42"], ["blur", "name"]);
    await steps(
      list,
      ["focus", "question"],
      ["type", "question", "70"],
      ["type", "question", "7"],
      ["blur", "question"],
    );
    await steps(list, ["focus", "label:0"], ["type", "label:0", "55"], ["type", "label:0", "5"], ["blur", "label:0"]);
    await steps(list, ["focus", "value:0"], ["type", "value:0", "01"], ["type", "value:0", "0"], ["blur", "value:0"]);
    expect(mutations()).toEqual([
      ["update", { presetId: "preset-1", variableId: "v", variableName: "42" }],
      ["update", { presetId: "preset-1", variableId: "v", question: "7" }],
      [
        "update",
        {
          presetId: "preset-1",
          variableId: "v",
          options: [
            { id: "o", label: "5", value: 0 },
            { id: "p", label: "B", value: "b" },
          ],
        },
      ],
      [
        "update",
        {
          presetId: "preset-1",
          variableId: "v",
          options: [
            // The label save above was refused (a stored value of 0 isn't text), so the label is still 5.
            { id: "o", label: 5, value: "0" },
            { id: "p", label: "B", value: "b" },
          ],
        },
      ],
    ]);
  });

  it("4: Move up / Move down send nothing when the moved variable's id is empty or missing", async () => {
    const list = await mountRows([{ id: "" }, { id: "b" }, { id: undefined as unknown as string }]);
    await steps(list, ["moveDown", 0], ["moveUp", 2]);
    expect(mutations()).toEqual([]);
    await steps(list, ["moveUp", 1]);
    expect(mutations()).toEqual([["reorder", { presetId: "preset-1", variableIds: ["b", "", undefined] }]]);
  });

  it("5: option rows are keyed by their id only, so typing survives an earlier id-less option going away", async () => {
    const list = await mountRows([
      {
        id: "v",
        options: [
          { label: "No id", value: "x" },
          { id: "0", label: "Zero", value: "z" },
        ],
      },
    ]);
    await steps(list, ["toggle", 0], ["focus", "label:1"], ["type", "label:1", "Typed"]);
    fakePresetVariablesApis.patchVariable("v", { options: [{ id: "0", label: "Zero", value: "z" }] });
    await steps(list, ["refetch"]);
    const label = list.field("label:0") as HTMLInputElement;
    expect(label.value).toBe("Typed");
    expect(document.activeElement).toBe(label);
  });

  it("6: Tab in the value editor works on the stored value as it is, so a missing value throws and saves nothing", async () => {
    const list = await mountRows([
      {
        id: "v",
        options: [
          { id: "o", label: "No value" },
          { id: "p", label: "B", value: "b" },
        ],
      },
    ]);
    await steps(list, ["toggle", 0], ["expandValue", 0], ["wait", 100]);
    const errors: string[] = [];
    const onError = (event: ErrorEvent) => {
      errors.push(String(event.error?.message ?? event.message));
      event.preventDefault();
    };
    window.addEventListener("error", onError);
    try {
      const result = await list.record(["key", "editor", "Tab"]);
      const thrown = [...errors, ...("renderError" in result ? (result.renderError ?? []) : [])];
      expect(thrown.join(" ")).toContain("Cannot read properties of undefined (reading 'substring')");
    } finally {
      window.removeEventListener("error", onError);
    }
    await steps(list, ["wait", 600], ["close"]);
    expect(mutations()).toEqual([]);
  });

  it('7: a stored name changing from 42 to "42" replaces the typed name, and the blur then sends nothing', async () => {
    const list = await mountRows([{ id: "v", variableName: 42 }]);
    await steps(list, ["toggle", 0], ["focus", "name"], ["type", "name", "TYPED"]);
    fakePresetVariablesApis.patchVariable("v", { variableName: "42" });
    await steps(list, ["refetch"]);
    expect((list.field("name") as HTMLInputElement).value).toBe("42");
    await steps(list, ["blur", "name"]);
    expect(mutations()).toEqual([]);
  });

  it("8: the header shows the stored name as React renders it", async () => {
    let list = await mountRows([{ id: "v", variableName: true }]);
    expect(list.nameOf(0).textContent).toBe("");
    list = await mountRows([{ id: "v", variableName: ["A", "B"] }]);
    expect(list.nameOf(0).textContent).toBe("AB");
    await list.unmount();
    harness = new VariablesHarness({
      variables: [{ id: "v", presetId: "preset-1", variableName: { a: 1 }, question: "Q?", options: [] }],
      preset: { id: "preset-1", name: "Preset", variableOrder: ["v"] },
    });
    list = harness;
    const result = await list.record(["mount"]);
    expect("renderError" in result ? result.renderError?.join(" ") : "").toContain(
      "Objects are not valid as a React child",
    );
    expect(list.cards()).toHaveLength(0);
  });

  it("9: the value editor title uses the label only when it is truthy", async () => {
    const list = await mountRows([
      {
        id: "v",
        options: [
          { id: "a", label: 0, value: "a" },
          { id: "b", label: false, value: "b" },
          { id: "c", label: 7, value: "c" },
        ],
      },
    ]);
    await steps(list, ["toggle", 0]);
    const titles: string[] = [];
    for (const index of [0, 1, 2]) {
      await steps(list, ["expandValue", index]);
      titles.push(list.modalRoot()!.querySelector("h3")!.textContent ?? "");
      await steps(list, ["close"]);
    }
    expect(titles).toEqual(["Edit Value: Option 1", "Edit Value: Option 2", "Edit Value: 7"]);
  });
});
