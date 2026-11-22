// Details the spec's "Recorded details" and review notes pin that no recording reaches: they keep the old
// behavior where a corrupt or unusual row would otherwise take a different path.
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorHarness, worldFor, type Recording } from "./agent-editor-replay-harness";
import type { World } from "./fake-agent-editor-apis";
import show1 from "./test-fixtures/recorded-show-1.json";

vi.mock("../../../../../shared/api/storage-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  storageApi: (await import("./fake-agent-editor-apis")).fakeStorageApi,
}));
vi.mock("../../../../../shared/api/connection-catalog-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  connectionCatalogApi: (await import("./fake-agent-editor-apis")).fakeConnectionCatalogApi,
}));
vi.mock("../../../../../shared/api/custom-tool-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  customToolApi: (await import("./fake-agent-editor-apis")).fakeCustomToolApi,
}));
vi.mock("../../../../../shared/api/integration-utility-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  knowledgeSourcesApi: (await import("./fake-agent-editor-apis")).fakeKnowledgeSourcesApi,
}));
vi.mock("../../../../../shared/lib/app-dialogs", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  showConfirmDialog: (await import("./fake-agent-editor-apis")).fakeConfirmDialog,
}));
vi.mock("sonner", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: (await import("./fake-agent-editor-apis")).fakeToast,
}));

const recording = show1 as unknown as Recording;
const baseWorld = () => worldFor(recording, { ...recording.scenarios[0]!, world: {} });

let editor: EditorHarness | null = null;

afterEach(async () => {
  await editor?.unmount();
  editor = null;
});

async function open(world: World, detailId: string) {
  editor = new EditorHarness(world, detailId);
  await editor.mount();
  return editor;
}

function customRow(id: string, settings: Record<string, unknown>) {
  return {
    id,
    type: `custom-${id}`,
    name: id,
    description: "",
    credit: "",
    phase: "post_processing",
    enabled: true,
    connectionId: null,
    promptTemplate: "",
    settings,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  };
}

describe("custom cadence focus", () => {
  it("survives switching agents, so the next agent's box shows its raw value", async () => {
    const world = baseWorld();
    world.agents = [customRow("c1", { runInterval: 1 }), customRow("c2", { runInterval: 1 })];
    const view = await open(world, "c1");
    expect(view.labelled("Trigger Cadence")).toMatchObject({ value: "Every run" });
    await view.run(["focus", "Trigger Cadence"]);
    expect(view.labelled("Trigger Cadence")).toMatchObject({ value: "1" });
    await view.run(["open", "continuity"]);
    await view.run(["open", "c2"]);
    expect(view.labelled("Trigger Cadence")).toMatchObject({ value: "1" });
  });
});

describe("built-in cadence group", () => {
  it("shows for an agent of type illustrator, driven by the built-in it opens as", async () => {
    const world = baseWorld();
    world.agents = [{ ...customRow("lorebook-keeper", {}), type: "illustrator" }];
    const view = await open(world, "lorebook-keeper");
    const groups = [...view.element.querySelectorAll("section h3, section label")]
      .map((title) => title.textContent)
      .filter((title) => title === "Run Interval");
    expect(groups).toHaveLength(2);
    // The second Run Interval box takes the keeper's own numbers.
    const boxes = [...view.element.querySelectorAll<HTMLInputElement>('input[type="number"]')].filter(
      (input) => input.max === "100",
    );
    expect(boxes.map((input) => input.placeholder)).toEqual(["8", "8"]);
  });
});

describe("after creating a custom agent", () => {
  it("opens any truthy id the create returns, numbers too", async () => {
    const view = await open(baseWorld(), "__new__");
    const { fakeStorageApi } = await import("./fake-agent-editor-apis");
    const create = vi.spyOn(fakeStorageApi, "create").mockImplementation(async (_entity, payload) => {
      return { ...payload, id: 42 } as never;
    });
    await view.run(["click", "Save"]);
    expect(create).toHaveBeenCalledOnce();
    const { useUIStore } = await import("../../../../../shared/stores/ui.store");
    expect(useUIStore.getState().agentDetailId).toBe(42);
  });
});
