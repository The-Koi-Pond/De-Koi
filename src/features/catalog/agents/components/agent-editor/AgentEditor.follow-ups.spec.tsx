// Behavior changed on purpose after the rebuild, by the spec's numbered follow-ups. The recorded steps these change
// are set aside in the replay (`FOLLOW_UP_CHANGES` there) and checked here instead.
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorHarness, worldFor, type Recording, type StepResult } from "./agent-editor-replay-harness";
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
