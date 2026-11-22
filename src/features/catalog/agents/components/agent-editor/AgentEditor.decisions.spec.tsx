// The spec's decisions 1 to 3 (docs/provenance/agent-editor.md, "Decisions"): accessibility changes on top of
// the recorded behavior. The replay sets exactly these attributes aside; these tests pin their values.
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorHarness, worldFor, type Recording } from "./agent-editor-replay-harness";
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
const anyScenario = recording.scenarios[0]!;

let editor: EditorHarness | null = null;

/** Mounts the editor on `detailId` with the recorder's data sets (`agents` overridable). */
async function open(detailId: string, agents = "CUSTOM", lorebooks = "STD") {
  editor = new EditorHarness(worldFor(recording, { ...anyScenario, world: { agents, lorebooks } }), detailId);
  editor.useWorldSets(recording.worlds);
  await editor.mount();
  return editor;
}

afterEach(async () => {
  await editor?.unmount();
  editor = null;
});

const pressed = (button: HTMLButtonElement | undefined) => button?.getAttribute("aria-pressed");

describe("Decision 1: on/off and pick-one buttons announce their state", () => {
  it("marks status, phases, result types, turn data, writer, section and tools", async () => {
    const view = await open("cust-full");
    // cust-full: enabled, Post-Processing, Context Injection, both turn data flags, writer on, section on.
    expect(pressed(view.groupButtons("Agent Status")[0])).toBe("true");
    expect(view.groupButtons("Pipeline Phase").map(pressed)).toEqual(["false", "false", "true"]);
    expect(view.groupButtons("Result Type").map(pressed)).toEqual(["true", "false"]);
    expect(view.groupButtons("Turn Data Access").map(pressed)).toEqual(["true", "true"]);
    expect(pressed(view.groupButtons("Lorebook Writer")[0])).toBe("true");
    expect(pressed(view.groupButtons("Add as Prompt Section")[0])).toBe("true");
    expect(pressed(view.toolCard("roll_dice").querySelector("button")!)).toBe("true");
    expect(pressed(view.toolCard("update_game_state").querySelector("button")!)).toBe("false");

    await view.click(view.groupButtons("Agent Status")[0]!);
    await view.click(view.groupButtons("Pipeline Phase")[1]!);
    expect(pressed(view.groupButtons("Agent Status")[0])).toBe("false");
    expect(view.groupButtons("Pipeline Phase").map(pressed)).toEqual(["false", "true", "false"]);
  });

  it("marks the Background toggle", async () => {
    const view = await open("background");
    expect(pressed(view.groupButtons("Background Image Generation")[0])).toBe("false");
    await view.click(view.groupButtons("Background Image Generation")[0]!);
    expect(pressed(view.groupButtons("Background Image Generation")[0])).toBe("true");
  });

  it("marks each lorebook and file row", async () => {
    const view = await open("knowledge-retrieval");
    expect(pressed(view.lorebookRow("World Lore"))).toBe("false");
    await view.click(view.lorebookRow("World Lore"));
    expect(pressed(view.lorebookRow("World Lore"))).toBe("true");
    const fileButton = () => view.fileRow("notes.txt").querySelector("button")!;
    expect(pressed(fileButton())).toBe("false");
    await view.click(fileButton());
    expect(pressed(fileButton())).toBe("true");
  });
});

describe("Decision 2: unnamed controls get names", () => {
  it("names the header name input", async () => {
    const view = await open("cust-full");
    expect(view.placeholder("Agent name…").getAttribute("aria-label")).toBe("Agent name");
  });

  it("names each tool toggle and says whether its card is expanded", async () => {
    const view = await open("__new__");
    const [toggle, header] = view.toolCard("lookup_price").querySelectorAll("button");
    expect(toggle!.getAttribute("aria-label")).toBe("lookup_price");
    expect(header!.getAttribute("aria-expanded")).toBe("false");
    await view.click(header!);
    expect(view.toolCard("lookup_price").querySelectorAll("button")[1]!.getAttribute("aria-expanded")).toBe("true");
  });

  it("names the file trash button", async () => {
    const view = await open("knowledge-retrieval");
    const trash = view.fileRow("notes.txt").querySelector('button[title="Delete file"]');
    expect(trash?.getAttribute("aria-label")).toBe("Delete file");
  });

  it.each([
    [
      "__new__",
      [
        "Description",
        "Author",
        "Target lorebook",
        "Connection Override",
        "Context Size",
        "Max Output Tokens",
        "Trigger Cadence",
        "Keywords",
        "Scan Depth",
        "Prompt Template",
      ],
    ],
    [
      "illustrator",
      [
        "Image Generation Connection Override",
        "Positive prompt / tags",
        "Negative prompt",
        "Character & persona references",
        "Run Interval",
      ],
    ],
    ["chat-summary", ["Max Output Tokens", "Triggers After"]],
    ["lorebook-keeper", ["Run Interval"]],
  ])("ties the visible labels to their controls (%s)", async (detailId, labels) => {
    const view = await open(detailId as string);
    for (const label of labels as string[]) {
      const control = view.labelled(label);
      expect(
        [...(control.labels ?? [])].map((element) => element.textContent),
        label,
      ).toEqual([label]);
    }
  });

  it("ties the Image Generation Connection label for NPC avatars and backgrounds", async () => {
    const tracker = await open("character-tracker", "BUILTIN");
    expect([...(tracker.labelled("Image Generation Connection").labels ?? [])].map((e) => e.textContent)).toEqual([
      "Image Generation Connection",
    ]);
    await tracker.unmount();
    editor = null;
    const background = await open("background", "BUILTIN");
    expect([...(background.labelled("Image Generation Connection").labels ?? [])].map((e) => e.textContent)).toEqual([
      "Image Generation Connection",
    ]);
  });
});

describe("Decision 3: buttons never submit", () => {
  it.each(["__new__", "cust-full", "illustrator", "knowledge-retrieval", "knowledge-router", "background"])(
    "gives every button type=button (%s)",
    async (detailId) => {
      const view = await open(detailId, detailId === "cust-full" || detailId === "__new__" ? "CUSTOM" : "BUILTIN");
      await view.click(view.toolCard("roll_dice").querySelectorAll("button")[1]!);
      const buttons = view.buttons();
      expect(buttons.length).toBeGreaterThan(10);
      for (const button of buttons) expect(button.getAttribute("type"), button.textContent ?? "").toBe("button");
    },
  );

  it("gives the unsaved bar's and error banner's buttons type=button too", async () => {
    const view = await open("cust-writer-missing");
    await view.run(["typePh", "Agent name…", "x"]);
    await view.run(["click", "Save"]);
    await view.run(["clickLabel", "Back to agents"]);
    expect(view.element.textContent).toContain("You have unsaved changes.");
    expect(view.element.textContent).toContain("Select an available target lorebook");
    for (const button of view.buttons()) expect(button.getAttribute("type"), button.textContent ?? "").toBe("button");
  });
});

describe("Decision 1 stays on its own buttons", () => {
  it("puts no aria-pressed on Save, Delete, Export, Back or the help buttons", async () => {
    const view = await open("cust-full");
    const plain = view
      .buttons()
      .filter(
        (button) =>
          ["Save", "Delete", "Export"].includes(button.textContent?.trim() ?? "") ||
          (button.getAttribute("aria-label") ?? "").startsWith("Help:") ||
          button.getAttribute("aria-label") === "Back to agents",
      );
    expect(plain.length).toBeGreaterThan(10);
    for (const button of plain) expect(button.hasAttribute("aria-pressed"), button.outerHTML).toBe(false);
  });
});

describe("Decision 4: small accessibility details", () => {
  it("hides the header button labels visually below 768px but keeps them for screen readers", async () => {
    const view = await open("cust-full");
    for (const name of ["Delete", "Export", "Save"]) {
      const label = [...view.element.querySelectorAll("button span")].find((span) => span.textContent === name);
      expect(label?.className, name).toContain("max-md:sr-only");
      expect(label?.closest("button")?.textContent?.trim()).toBe(name);
    }
  });

  it("marks decorative icons aria-hidden", async () => {
    const view = await open("cust-full");
    await view.click(view.toolCard("roll_dice").querySelectorAll("button")[1]!);
    // Every icon inside a button is decoration: the button's text or name says what it does. The help buttons
    // belong to the shared HelpTooltip, which this module doesn't own.
    const icons = [...view.element.querySelectorAll("button svg")].filter(
      (icon) => !(icon.closest("button")?.getAttribute("aria-label") ?? "").startsWith("Help:"),
    );
    expect(icons.length).toBeGreaterThan(20);
    for (const icon of icons) expect(icon.closest("[aria-hidden='true']"), icon.outerHTML).not.toBeNull();
  });
});

describe("Decision 5: a row without a description shows an empty box", () => {
  it("doesn't keep the previous agent's description in the box", async () => {
    const view = await open("cust-full");
    expect(view.labelled("Description")).toMatchObject({ value: "Description of cust-full" });
    await view.run(["open", "cust-sparse"]);
    expect(view.labelled("Description")).toMatchObject({ value: "" });
  });

  it("doesn't show the built-in's description for a built-in row without one", async () => {
    const world = worldFor(recording, { ...anyScenario, world: { agents: "BUILTIN" } });
    const { description: _dropped, ...row } = world.agents.find((agent) => agent.type === "continuity")!;
    world.agents = [row as (typeof world.agents)[number]];
    editor = new EditorHarness(world, "continuity");
    await editor.mount();
    expect(editor.labelled("Description")).toMatchObject({ value: "" });
  });
});
