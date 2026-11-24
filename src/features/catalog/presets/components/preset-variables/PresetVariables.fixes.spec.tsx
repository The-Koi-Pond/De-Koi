import { afterEach, describe, expect, it, vi } from "vitest";
import { fakePresetVariablesApis } from "./fake-preset-variables-apis";
import { VariablesHarness, worldFor, type Recording, type Step } from "./preset-variables-replay-harness";
import show from "./test-fixtures/recorded-show.json";

// Follow-up 10 after the rebuild (docs/provenance/preset-variables.md, "Follow-ups after the rebuild"), as new step
// sequences on the recorder's `STD` variables. The first failed on the rebuild as merged; the others guard that the
// fix doesn't block a delete it shouldn't.

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

const recording = show as unknown as Recording;
let harness: VariablesHarness | null = null;

async function mount(steps: Step[] = []) {
  harness = new VariablesHarness(worldFor(recording, { id: "fixes", world: { variables: "STD" }, pre: [], steps: [] }));
  await harness.run(["mount"]);
  for (const step of steps) await harness.run(step);
  return harness;
}

afterEach(async () => {
  await harness?.unmount();
  harness = null;
});

const flow = () =>
  fakePresetVariablesApis.calls
    .filter((call) => call[0] === "confirm" || call[0] === "mutate")
    .map((call) => (call[0] === "confirm" ? "confirm" : `${String(call[1])} ${JSON.stringify(call[2])}`));

describe("PresetVariablesEditor follow-up 10", () => {
  it("a second Delete while the variable's delete runs neither asks nor deletes again", async () => {
    await mount([
      ["hold", "variables.delete"],
      ["delete", 0],
      ["delete", 0],
    ]);
    expect(flow()).toEqual(["confirm", 'delete {"presetId":"preset-1","variableId":"v-genre"}']);
  });

  it("another variable's Delete still works while one delete runs", async () => {
    await mount([
      ["hold", "variables.delete"],
      ["delete", 0],
      ["delete", 1],
    ]);
    expect(flow()).toEqual([
      "confirm",
      'delete {"presetId":"preset-1","variableId":"v-genre"}',
      "confirm",
      'delete {"presetId":"preset-1","variableId":"v-nsfw"}',
    ]);
  });

  it("Delete asks again after a cancel and after a failed delete", async () => {
    await mount([
      ["confirm", false],
      ["delete", 0],
      ["confirm", true],
      ["fail", "variables.delete", "in use"],
      ["delete", 0],
      ["delete", 0],
    ]);
    expect(flow()).toEqual([
      "confirm",
      "confirm",
      'delete {"presetId":"preset-1","variableId":"v-genre"}',
      "confirm",
      'delete {"presetId":"preset-1","variableId":"v-genre"}',
    ]);
  });
});
