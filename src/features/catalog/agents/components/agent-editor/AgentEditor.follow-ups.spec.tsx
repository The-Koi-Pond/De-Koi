// Behavior changed on purpose after the rebuild, by the spec's numbered follow-ups. The recorded steps these change
// are set aside in the replay (`FOLLOW_UP_CHANGES` there) and checked here instead.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EditorHarness,
  replayScenario,
  resolveStep,
  worldFor,
  type Recording,
  type StepResult,
} from "./agent-editor-replay-harness";
import actionsFields from "./test-fixtures/recorded-actions-fields.json";
import actionsFlow from "./test-fixtures/recorded-actions-flow.json";
import actionsKnowledge from "./test-fixtures/recorded-actions-knowledge.json";
import actionsSave1 from "./test-fixtures/recorded-actions-save-1.json";
import saveUnchanged1 from "./test-fixtures/recorded-save-unchanged-1.json";
import saveUnchanged2 from "./test-fixtures/recorded-save-unchanged-2.json";
import show1 from "./test-fixtures/recorded-show-1.json";
import show2 from "./test-fixtures/recorded-show-2.json";

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
vi.mock("../../../../../shared/api/file-save-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  saveTextFileToUserSelectedLocation: (await import("./fake-agent-editor-apis")).fakeSaveTextFile,
}));
vi.mock("sonner", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: (await import("./fake-agent-editor-apis")).fakeToast,
}));

const recording = show2 as unknown as Recording;

let editor: EditorHarness | null = null;

afterEach(async () => {
  await editor?.unmount();
  editor = null;
});

/** Opens the recorded scenario's starting state, as the replay does. */
function harnessFor(scenarioId: string) {
  const scenario = recording.scenarios.find((candidate) => candidate.id === scenarioId);
  if (!scenario) throw new Error(`no recorded scenario ${scenarioId}`);
  editor = new EditorHarness(worldFor(recording, scenario), scenario.detailId);
  editor.useWorldSets(recording.worlds);
  return editor;
}

function noCrash(result: StepResult) {
  expect("renderError" in result ? result.renderError : undefined, JSON.stringify(result.step)).toBeUndefined();
}

/** Each listed parameter of an expanded tool card, as its text. */
function parameterLines(view: EditorHarness, tool: string) {
  return [...view.toolCard(tool).querySelectorAll("ul > li")].map((line) => line.textContent);
}

describe("follow-up 9: a bad custom tool schema shows no parameters instead of crashing", () => {
  it("opens with a tool whose schema is null, and its card lists no parameters", async () => {
    const view = harnessFor("show:tools-null-schema");
    noCrash(await view.record(["mount"]));
    expect(view.text()).toContain("null_schema");
    noCrash(await view.record(["expandTool", "null_schema"]));
    expect(view.toolCard("null_schema").textContent).toContain("Parameters:");
    expect(parameterLines(view, "null_schema")).toEqual([]);
  });

  it("stays open when a null-schema tool arrives on a refetch", async () => {
    const view = harnessFor("show:tools-null-schema-appears");
    noCrash(await view.record(["mount"]));
    noCrash(await view.record(["setWorld", "tools", "NULL_SCHEMA"]));
    noCrash(await view.record(["refetch", "custom-tools"]));
    expect(view.text()).toContain("null_schema");
  });

  it("lists odd schemas the way generation reads them", async () => {
    const view = harnessFor("show:tools-odd-schema");
    noCrash(await view.record(["mount"]));

    // `required` given as a string marks nothing (it used to match by substring, starring `it` too).
    noCrash(await view.record(["expandTool", "string_required"]));
    expect(parameterLines(view, "string_required")).toEqual(["itemstring", "itstring", "countnumber"]);

    // A schema stored as JSON text is parsed, as generation does before sending it to the model.
    noCrash(await view.record(["expandTool", "string_schema"]));
    expect(parameterLines(view, "string_schema")).toEqual([
      "item*string — Item name",
      "currencystring[gold, silver]",
      "countnumber",
    ]);

    // An `enum` that isn't a list is left out (it used to crash the editor on expand).
    noCrash(await view.record(["expandTool", "enum_string"]));
    expect(parameterLines(view, "enum_string")).toEqual(["modestring"]);
  });
});

// ── Follow-ups 2, 3, 4, 10, 11 and 12: whole recorded scenarios replayed, checked at the steps they change ──

const RECORDINGS = [
  show1,
  show2,
  saveUnchanged1,
  saveUnchanged2,
  actionsFields,
  actionsFlow,
  actionsKnowledge,
  actionsSave1,
].map((file) => file as unknown as Recording);

/** Replays a recorded scenario on the new editor; `recorded(i)` is what the old editor recorded at step `i`. */
async function replay(id: string) {
  const recordingOf = RECORDINGS.find((file) => file.scenarios.some((scenario) => scenario.id === id));
  if (!recordingOf) throw new Error(`no recorded scenario ${id}`);
  const scenario = recordingOf.scenarios.find((candidate) => candidate.id === id)!;
  const { results, unhandledAfterUnmount } = await replayScenario(recordingOf, scenario);
  const recorded = (index: number) => resolveStep(recordingOf, scenario.steps[index]!) as Result;
  return { results, unhandledAfterUnmount, recorded };
}

type Result = StepResult & { text?: string; calls?: unknown[]; unhandled?: string[]; store?: unknown };
const at = (results: StepResult[], index: number) => results[index] as Result;
const writes = (result: Result) =>
  (result.calls ?? []).filter((call) => Array.isArray(call) && /^storage\.(create|update)$/.test(String(call[0])));

describe("follow-up 2: a stored phase outside the three", () => {
  it("opens with no phase chosen instead of crashing", async () => {
    const { results } = await replay("show:custom:cust-badphase");
    noCrash(results[0]!);
    expect(at(results, 0).text).toContain("Post-ProcessingPick when this agent runs.");
    expect(at(results, 0).text).toContain("Phase: Pick when this agent runs.");
  });

  it("asks for a phase on Save and writes nothing", async () => {
    const { results } = await replay("save0:custom:cust-badphase");
    noCrash(results[1]!);
    expect(at(results, 1).text).toContain("Pick a pipeline phase before saving.");
    expect(writes(at(results, 1))).toEqual([]);
  });
});

describe("follow-up 3: the unsaved bar after a successful Save", () => {
  it.each([
    "back:header-save-bar-stays:cust-full",
    "back:header-save-bar-stays:__new__",
    "back:header-save-bar-stays:continuity",
  ])("%s: hides, and the Save sends what it sent before", async (id) => {
    const { results, recorded } = await replay(id);
    expect(recorded(3).text).toContain("You have unsaved changes.");
    expect(at(results, 3).text).not.toContain("You have unsaved changes.");
    expect(JSON.stringify(at(results, 3).calls)).toBe(JSON.stringify(recorded(3).calls));
  });

  it("hides when a held save finishes after Back opened it", async () => {
    const { results, recorded } = await replay("save:held");
    expect(recorded(8).text).toContain("You have unsaved changes.");
    expect(at(results, 8).text).not.toContain("You have unsaved changes.");
    expect(JSON.stringify(at(results, 8).calls)).toBe(JSON.stringify(recorded(8).calls));
  });
});

describe("follow-ups 4, 10 and 11: failures say so", () => {
  it("a failed Delete shows an error and keeps the editor open", async () => {
    const { results, recorded, unhandledAfterUnmount } = await replay("delete:fails");
    const step = at(results, 3);
    expect(step.calls).toEqual([
      ...(recorded(3).calls ?? []),
      ["toast", "error", expect.stringMatching(/^Couldn't delete agent/)],
    ]);
    expect(step.store).toEqual(recorded(3).store);
    expect(step.unhandled).toBeUndefined();
    expect(unhandledAfterUnmount).toEqual([]);
  });

  it.each([
    [
      "export:row:cust-legacy-type",
      `Couldn't export this agent. Only custom agent types can be exported. Received "my-agent".`,
    ],
    [
      "export:row:cust-upper-type",
      `Couldn't export this agent. Only custom agent types can be exported. Received "custom-Upper Case".`,
    ],
    [
      "export:odd-builtin-row",
      `Couldn't export this agent. Only custom agent types can be exported. Received "illustrator".`,
    ],
    [
      "export:row:cust-longname",
      "Couldn't export this agent: its name isn't valid (Too big: expected string to have <=200 characters).",
    ],
    [
      "export:row:cust-credit-num",
      "Couldn't export this agent: its credit isn't valid (Invalid input: expected string, received number).",
    ],
  ])("%s: an Export that can't be built says why", async (id, message) => {
    const { results } = await replay(id);
    expect(at(results, 1).calls).toEqual([["toast", "error", message]]);
    expect(at(results, 1).unhandled).toBeUndefined();
  });

  it("a failed upload shows an error", async () => {
    const { results, recorded } = await replay("k:retrieval:upload-fails");
    expect(at(results, 2).calls).toEqual([
      ...(recorded(2).calls ?? []),
      ["toast", "error", "Couldn't upload file. Try again."],
    ]);
  });

  it("a failed file delete says which action failed", async () => {
    const { results } = await replay("k:retrieval:delete-file-fails");
    expect(at(results, 3).calls).toEqual([
      ["knowledge.delete", "ks-1"],
      ["toast", "error", "Couldn't delete file. Try again."],
    ]);
  });
});

describe("follow-up 12: the name rule says what is wrong", () => {
  it.each([
    ["type:name-empty-save:new", 2, "Give the agent a name before saving."],
    ["type:name-empty-save:custom", 2, "Give the agent a name before saving."],
    ["type:name-long-save:custom", 2, "Agent names can be up to 200 characters. Shorten the name and save again."],
    ["save0:custom:cust-longname", 1, "Agent names can be up to 200 characters. Shorten the name and save again."],
  ])("%s", async (id, index, message) => {
    const { results, recorded } = await replay(id);
    expect(recorded(index).text).toContain("Couldn't save agent config.");
    expect(at(results, index).text).toContain(message);
    expect(writes(at(results, index))).toEqual([]);
  });
});
