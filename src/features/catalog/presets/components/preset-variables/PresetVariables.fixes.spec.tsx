import { act } from "react";
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
// Lets a test hold the confirm dialog open (the fake answers at once); the fake still logs the call.
const confirmGate = vi.hoisted(() => ({ hold: false, answer: null as ((confirmed: boolean) => void) | null }));
vi.mock("../../../../../shared/lib/app-dialogs", async (importOriginal) => {
  const { fakeConfirmDialog } = await import("./fake-preset-variables-apis");
  return {
    ...(await importOriginal<object>()),
    showConfirmDialog: async (options: unknown) => {
      const answer = await fakeConfirmDialog(options);
      if (!confirmGate.hold) return answer;
      return new Promise<boolean>((resolve) => {
        confirmGate.answer = resolve;
      });
    },
  };
});
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
  confirmGate.hold = false;
  confirmGate.answer = null;
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

  it("a second Delete while the confirm is still open neither asks nor deletes again", async () => {
    await mount();
    confirmGate.hold = true;
    await harness!.run(["delete", 0]);
    await harness!.run(["delete", 0]);
    expect(flow()).toEqual(["confirm"]);
    confirmGate.hold = false;
    await act(async () => confirmGate.answer!(true));
    await harness!.run(["wait", 0]);
    expect(flow()).toEqual(["confirm", 'delete {"presetId":"preset-1","variableId":"v-genre"}']);
  });
});
