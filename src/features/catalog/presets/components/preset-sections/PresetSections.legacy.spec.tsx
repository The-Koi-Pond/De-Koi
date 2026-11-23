import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SectionsHarness,
  worldFor,
  type Recording,
  type Snapshot,
  type Step,
  type StepResult,
} from "./preset-sections-replay-harness";
import { fakePresetSectionsApis } from "./fake-preset-sections-apis";
import show from "./test-fixtures/recorded-show.json";

// Old behavior on legacy and odd rows that the recordings don't cover, found by black-box testing the old tab and
// kept on purpose (rebuild first). Each test drives the tab with the replay harness and checks the exact calls.

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
const NOW = 1767225600000;
let harness: SectionsHarness | null = null;

type Row = Record<string, unknown> & { id: string };

/** A stored section row with the recordings' defaults, `overrides` applied (a `undefined` value removes the key). */
function row(id: string, overrides: Record<string, unknown> = {}): Row {
  const base: Row = {
    id,
    presetId: "preset-1",
    identifier: id.replace(/^s-/, ""),
    name: `Name ${id}`,
    content: "",
    role: "system",
    enabled: true,
    isMarker: false,
    groupId: null,
    markerConfig: null,
    injectionPosition: "ordered",
    injectionDepth: 0,
    injectionOrder: 100,
    forbidOverrides: false,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
  for (const [key, value] of Object.entries(overrides)) if (value === undefined) delete base[key];
  return base;
}

/** Mounts the tab over these section rows (in this order) and, optionally, these agent rows. */
async function mount(sections: Row[], agents?: Row[]) {
  await harness?.unmount();
  const scenario = worldFor(recording, { world: { groups: "NONE", variables: "NONE" } });
  const { world } = scenario;
  world.sections = [...sections, ...world.sections.filter((section) => section.presetId !== "preset-1")];
  world.presets[0]!.sectionOrder = sections.map((section) => section.id);
  if (agents) world.agents = agents;
  harness = new SectionsHarness(scenario, recording.worlds);
  // Recorded, so the mount's own loading calls are taken before the steps.
  await harness.record(["mount"]);
  return harness;
}

afterEach(async () => {
  await harness?.unmount();
  harness = null;
});

/** Runs a step and returns its snapshot (failing on a missing control). */
async function step(tab: SectionsHarness, run: Step): Promise<Snapshot> {
  const result: StepResult = await tab.record(run);
  if ("error" in result) throw new Error(result.error);
  return result;
}

const mutations = (snapshot: Snapshot) =>
  snapshot.calls.filter((call) => /^mutate/.test(String((call as unknown[])[0])));

const update = (sectionId: string, data: Record<string, unknown>) => [
  "mutate",
  "updateSection",
  { presetId: "preset-1", sectionId, ...data },
];

describe("PresetSectionsTab keeps the old behavior on odd rows", () => {
  it("1: Duplicate falls back to `Prompt Block` / `section` only for a missing or null name / identifier", async () => {
    const copies: Array<[string, string]> = [];
    for (const odd of [
      { name: "", identifier: "" },
      { name: 0, identifier: 0 },
      { name: false, identifier: null },
      { name: null, identifier: undefined },
    ]) {
      const tab = await mount([row("s-a", odd)]);
      const snapshot = await step(tab, ["duplicate", 0]);
      const payload = (snapshot.calls[0] as [string, string, Record<string, unknown>])[2];
      expect((snapshot.calls[0] as unknown[]).slice(0, 2)).toEqual(["mutateAsync", "createSection"]);
      copies.push([payload.identifier as string, payload.name as string]);
    }
    expect(copies).toEqual([
      [`_copy_${NOW}`, " Copy"],
      [`0_copy_${NOW}`, "0 Copy"],
      [`section_copy_${NOW}`, "false Copy"],
      [`section_copy_${NOW}`, "Prompt Block Copy"],
    ]);
  });

  it("2: an agent item without a type adds a plain prompt block", async () => {
    const agent = (id: string, extra: Record<string, unknown>) => ({
      id,
      name: id,
      description: "",
      phase: "post_processing",
      enabled: true,
      connectionId: null,
      promptTemplate: "",
      settings: { injectAsSection: true },
      ...extra,
    });
    const tab = await mount([row("s-a")], [agent("Blank", { type: "" }), agent("NoType", {})]);
    const promptBlock = [
      "mutate",
      "createSection",
      {
        presetId: "preset-1",
        identifier: `section_${NOW}`,
        name: "New Section",
        content: "",
        role: "system",
        isMarker: false,
        markerConfig: null,
      },
    ];
    for (const item of ["Blank (Agent)", "NoType (Agent)"]) {
      await step(tab, ["addSection"]);
      const snapshot = await step(tab, ["menuItem", item]);
      expect(mutations(snapshot)).toEqual([promptBlock]);
    }
  });

  it("3: the agent macro falls back to `agent` only for a missing or null agent type", async () => {
    const marker = (agentType: unknown) => ({
      isMarker: true,
      markerConfig: { type: "agent_data", agentType },
      content: "",
    });
    const tab = await mount([
      row("s-empty", marker("")),
      row("s-false", marker(false)),
      row("s-null", marker(null)),
      row("s-gone", { isMarker: true, markerConfig: { type: "agent_data" }, content: "" }),
    ]);
    const expected = ["{{agent::}}", "{{agent::false}}", "{{agent::agent}}", "{{agent::agent}}"];
    for (const [card, macro] of expected.entries()) {
      const snapshot = await step(tab, ["toggle", card]);
      expect(snapshot.text).toContain(`The ${macro} macro will be replaced`);
      expect(snapshot.fields.find((field) => field.tag === "textarea")?.value).toBe(macro);
      await step(tab, ["toggle", card]);
    }
  });

  it("4a: on a null or missing content row, erasing typed text back to empty saves an empty content", async () => {
    for (const content of [null, undefined]) {
      // On the 800 ms timer.
      let tab = await mount([row("s-a", { content })]);
      await step(tab, ["toggle", 0]);
      await step(tab, ["focus", "content:0"]);
      await step(tab, ["type", "content:0", "abc"]);
      await step(tab, ["type", "content:0", ""]);
      expect(mutations(await step(tab, ["wait", 800]))).toEqual([update("s-a", { content: "" })]);

      // On blur.
      tab = await mount([row("s-a", { content })]);
      await step(tab, ["toggle", 0]);
      await step(tab, ["focus", "content:0"]);
      await step(tab, ["type", "content:0", "abc"]);
      await step(tab, ["type", "content:0", ""]);
      expect(mutations(await step(tab, ["blur", "content:0"]))).toEqual([update("s-a", { content: "" })]);
      expect(mutations(await step(tab, ["wait", 800]))).toEqual([]);
    }
  });

  it("4b: Tab on a null content row throws in the key handler and inserts and saves nothing", async () => {
    const tab = await mount([row("s-a", { content: null })]);
    await step(tab, ["toggle", 0]);
    await step(tab, ["focus", "content:0"]);
    let snapshot = await step(tab, ["key", "content:0", "Tab"]);
    expect(snapshot.eventError).toEqual(["TypeError: Cannot read properties of null (reading 'substring')"]);
    expect(snapshot.fields.find((field) => field.tag === "textarea")?.value).toBe("");
    expect(snapshot.calls).toEqual([]);
    expect((await step(tab, ["blur", "content:0"])).calls).toEqual([]);
    expect((await step(tab, ["wait", 800])).calls).toEqual([]);

    // The same in the expanded editor.
    await step(tab, ["expandEditor", 0]);
    await step(tab, ["wait", 100]);
    snapshot = await step(tab, ["key", "editor", "Tab"]);
    expect(snapshot.eventError).toEqual(["TypeError: Cannot read properties of null (reading 'substring')"]);
    expect(snapshot.modals[0]?.fields[0]?.value).toBe("");
    expect((await step(tab, ["done"])).calls).toEqual([]);
    expect((await step(tab, ["wait", 800])).calls).toEqual([]);
  });

  it("4c: Tab on a number content throws and inserts and saves nothing; the text area shows the number", async () => {
    const tab = await mount([row("s-a", { content: 42 })]);
    let snapshot = await step(tab, ["toggle", 0]);
    expect(snapshot.fields.find((field) => field.tag === "textarea")?.value).toBe("42");
    await step(tab, ["focus", "content:0"]);
    snapshot = await step(tab, ["key", "content:0", "Tab"]);
    expect(snapshot.eventError).toEqual(["TypeError: text.substring is not a function"]);
    expect(snapshot.fields.find((field) => field.tag === "textarea")?.value).toBe("42");
    expect(snapshot.calls).toEqual([]);
    expect((await step(tab, ["blur", "content:0"])).calls).toEqual([]);
    expect((await step(tab, ["wait", 800])).calls).toEqual([]);
  });

  it("5: on a row without a name, a blank name stays shown after blur and saves nothing", async () => {
    for (const name of [undefined, null]) {
      const tab = await mount([row("s-a", { name })]);
      await step(tab, ["toggle", 0]);
      await step(tab, ["focus", "name:0"]);
      await step(tab, ["type", "name:0", "   "]);
      const snapshot = await step(tab, ["blur", "name:0"]);
      expect(snapshot.calls).toEqual([]);
      expect(snapshot.eventError).toBeUndefined();
      expect(snapshot.fields[0]).toMatchObject({ placeholder: "Section name", value: "   " });
    }
  });

  it("6: Escape closes several expanded editors in the order they last re-rendered", async () => {
    const tab = await mount([row("s-a", { content: "a" }), row("s-b", { content: "b" })]);
    await step(tab, ["toggle", 0]);
    await step(tab, ["toggle", 1]);
    await step(tab, ["expandEditor", 0]);
    await step(tab, ["expandEditor", 1]);
    await step(tab, ["type", "editor", "b1"]);
    const editorA = tab.modalRoots()[0]!.querySelector("textarea")!;
    await tab.setValue(editorA, "a1", "input");
    expect((await step(tab, ["key", "body", "Escape"])).calls).toEqual([]);
    expect(mutations(await step(tab, ["wait", 800]))).toEqual([
      update("s-b", { content: "b1" }),
      update("s-a", { content: "a1" }),
    ]);
  });

  it("7: the drop place next to the dragged card shows no line and drops nothing, also when it is stale", async () => {
    const rows = [row("s-a"), row("s-b"), row("s-c")];
    let tab = await mount(rows);
    await step(tab, ["gripDown", 0]);
    await step(tab, ["dragStart", 0]);
    expect((await step(tab, ["dragOver", 2, 280])).cards).toEqual([["dragging"], [], ["lineAfter"]]);
    await step(tab, ["gripDown", 2]);
    let snapshot = await step(tab, ["dragStart", 2]);
    expect(snapshot.cards).toEqual([[], [], ["dragging"]]);
    snapshot = await step(tab, ["drop", 2]);
    expect(snapshot.calls).toEqual([]);

    // A drag over a card with no drag in progress still moves the drop place: the next drag starts with its line.
    tab = await mount(rows);
    snapshot = await step(tab, ["dragOver", 1, 110]);
    expect(snapshot.cards).toEqual([[], [], []]);
    await step(tab, ["gripDown", 2]);
    snapshot = await step(tab, ["dragStart", 2]);
    expect(snapshot.cards).toEqual([[], ["lineBefore"], ["dragging"]]);
  });

  it("8: Move on a section whose id is empty sends nothing", async () => {
    const tab = await mount([row(""), row("s-b")]);
    expect((await step(tab, ["moveDown", 0])).calls).toEqual([]);
  });

  it("9: a drop after the list shrank mid-drag sends the moved id as `undefined` (no id check on a drop)", async () => {
    const rows = [row("s-a"), row("s-b"), row("s-c")];
    // The dragged card's index points past the end of the shrunk list.
    let tab = await mount(rows);
    await step(tab, ["gripDown", 2]);
    await step(tab, ["dragStart", 2]);
    fakePresetSectionsApis.setSections([rows[0]!, rows[2]!]);
    expect((await step(tab, ["refetch"])).cards).toHaveLength(2);
    await step(tab, ["dragOverList", -20]);
    let snapshot = await step(tab, ["dropList"]);
    expect(snapshot.calls.slice(0, 2)).toEqual([
      ["mutate", "reorderSections", { presetId: "preset-1", sectionIds: [{ $undefined: true }, "s-a", "s-c"] }],
      ["reorder", { presetId: "preset-1", kind: "sections", ids: [{ $undefined: true }, "s-a", "s-c"] }],
    ]);
    // Then the refetch.
    expect(snapshot.calls[2]).toEqual(["storage.get", "prompts", "preset-1"]);
    // Serialized, the missing id is `null`.
    expect(JSON.stringify((snapshot.calls[0] as unknown[])[2])).toBe(
      '{"presetId":"preset-1","sectionIds":[{"$undefined":true},"s-a","s-c"]}',
    );

    // The dragged index pointing at another card: the drop at its own place (by index) sends nothing.
    tab = await mount(rows);
    await step(tab, ["gripDown", 1]);
    await step(tab, ["dragStart", 1]);
    fakePresetSectionsApis.setSections([rows[0]!, rows[2]!]);
    await step(tab, ["refetch"]);
    await step(tab, ["dragOverList", 999]);
    snapshot = await step(tab, ["dropList"]);
    expect(snapshot.calls).toEqual([]);
  });

  it("10: a new drag shows the drop place the previous drag over left, when it isn't the new card's own place", async () => {
    const tab = await mount([row("s-a"), row("s-b", { enabled: false }), row("s-c")]);
    await step(tab, ["gripDown", 1]);
    await step(tab, ["dragStart", 1]);
    // Card 0's lower half: before card 1, the dragged card's own place (no line).
    expect((await step(tab, ["dragOver", 0, 63])).cards).toEqual([[], ["dragging"], []]);
    await step(tab, ["gripDown", 2]);
    expect((await step(tab, ["dragStart", 2])).cards).toEqual([[], ["off", "lineBefore"], ["dragging"]]);
    // Dropped there, it moves card 2 before card 1.
    expect(mutations(await step(tab, ["drop", 2]))).toEqual([
      ["mutate", "reorderSections", { presetId: "preset-1", sectionIds: ["s-a", "s-c", "s-b"] }],
    ]);
  });
});
