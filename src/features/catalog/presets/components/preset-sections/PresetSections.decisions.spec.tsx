import { afterEach, describe, expect, it, vi } from "vitest";
import { SectionsHarness, worldFor, type Recording, type Scenario, type Step } from "./preset-sections-replay-harness";
import show from "./test-fixtures/recorded-show.json";

// The spec's decisions 1 to 3 (docs/provenance/preset-sections.md, "Decisions"): the attributes the replay sets
// aside are checked here, one test per decision, across several states.

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
let harness: SectionsHarness | null = null;

/** Mounts the tab over a recorded world (`STD` sections and groups unless said otherwise) and runs `steps`. */
async function mount(world: Scenario["world"] = {}, steps: Step[] = []) {
  await harness?.unmount();
  harness = new SectionsHarness(worldFor(recording, { world }), recording.worlds);
  await harness.run(["mount"]);
  for (const step of steps) await harness.run(step);
  return harness;
}

afterEach(async () => {
  await harness?.unmount();
  harness = null;
});

function byLabel(root: Element, name: string): HTMLElement {
  const found = root.querySelector<HTMLElement>(`[aria-label="${name}"]`);
  if (!found) throw new Error(`nothing named "${name}"`);
  return found;
}

/** The text of the labels tied to a field. */
function labelText(field: Element | undefined): string {
  return [...((field as HTMLInputElement | undefined)?.labels ?? [])].map((label) => label.textContent).join("|");
}

function dialogs(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="dialog"]')];
}

/** Every icon in `roots` is hidden from assistive tech, and there is at least one. */
function expectIconsHidden(...roots: Element[]) {
  const icons = roots.flatMap((root) => [...root.querySelectorAll("svg")]);
  expect(icons.length).toBeGreaterThan(0);
  for (const icon of icons) expect(icon.getAttribute("aria-hidden"), icon.outerHTML.slice(0, 80)).toBe("true");
}

/** Every button in `roots` is `type="button"`, and there are at least `atLeast`. */
function expectButtonTypes(atLeast: number, ...roots: Element[]) {
  const buttons = roots.flatMap((root) => [...root.querySelectorAll("button")]);
  expect(buttons.length).toBeGreaterThanOrEqual(atLeast);
  for (const button of buttons) expect(button.getAttribute("type"), button.outerHTML.slice(0, 120)).toBe("button");
}

describe("PresetSectionsTab decisions", () => {
  it("1: names and states for the toolbar, cards, body controls, groups, icons and grips", async () => {
    // Every kind of row, collapsed and expanded in turn.
    const tab = await mount();
    const page = tab.element;

    const addSection = tab.buttonWithText("Add Section");
    const groups = tab.buttonWithText("Groups (2)");
    expect(addSection.getAttribute("aria-expanded")).toBe("false");
    expect(groups.getAttribute("aria-expanded")).toBe("false");
    await tab.run(["addSection"]);
    expect(addSection.getAttribute("aria-expanded")).toBe("true");
    expectIconsHidden(page);
    await tab.run(["menuBackdrop"]);
    expect(addSection.getAttribute("aria-expanded")).toBe("false");
    await tab.run(["groups"]);
    expect(groups.getAttribute("aria-expanded")).toBe("true");
    expect(byLabel(page, "Delete group Style Rules").tagName).toBe("BUTTON");
    expect(byLabel(page, "Delete group Formatting").tagName).toBe("BUTTON");
    await tab.run(["groups"]);
    expect(groups.getAttribute("aria-expanded")).toBe("false");

    const chevron = byLabel(page, "Expand Main Prompt");
    expect(chevron.tagName).toBe("BUTTON");
    expect(chevron.getAttribute("aria-expanded")).toBe("false");
    expect(byLabel(page, "Disable Main Prompt").getAttribute("aria-pressed")).toBe("true");
    expect(byLabel(page, "Disable Main Prompt").getAttribute("title")).toBe("Disable");
    expect(byLabel(page, "Enable Prefill").getAttribute("aria-pressed")).toBe("false");
    expect(byLabel(page, "Enable Prefill").getAttribute("title")).toBe("Enable");
    expect(byLabel(page, "Delete Main Prompt").getAttribute("title")).toBe("Delete");

    await tab.run(["toggle", 0]);
    expect(byLabel(page, "Collapse Main Prompt").getAttribute("aria-expanded")).toBe("true");
    expect(byLabel(page, "Expand Character Info").getAttribute("aria-expanded")).toBe("false");
    expect(byLabel(page, "Expand editor").getAttribute("title")).toBe("Expand editor");
    expect(byLabel(page, "Macros reference").getAttribute("title")).toBe("Macros reference");
    expect(tab.field("name:0").getAttribute("aria-label")).toBe("Section name");
    expect(tab.field("role:0").getAttribute("aria-label")).toBe("Role");
    expect(labelText(tab.field("position:0"))).toBe("Position:");
    expect(labelText(tab.field("group:0"))).toBe("Group:");
    await tab.run(["choose", "position:0", "depth"]);
    expect(labelText(tab.field("depth:0"))).toBe("Depth:");
    expectIconsHidden(page);

    const grips = [...page.querySelectorAll('[data-section-index] [title="Drag to reorder"]')];
    expect(grips).toHaveLength(5);
    for (const grip of grips) expect(grip.getAttribute("aria-hidden")).toBe("true");

    // Every marker type, agent markers and odd rows, each card expanded.
    for (const [sections, count] of [
      ["MARKERS", 11],
      ["AGENTS", 5],
      ["PROMPTS", 7],
      ["ODD", 15],
    ] as const) {
      const odd = await mount({ sections, groups: "ONE" });
      for (let card = 0; card < count; card += 1) {
        await odd.run(["toggle", card]);
        const body = odd.card(card);
        expect(body.querySelector('button[aria-expanded="true"]')?.getAttribute("aria-label")).toMatch(/^Collapse /);
        expect(odd.field(`name:${card}`).getAttribute("aria-label")).toBe("Section name");
        expect(odd.field(`role:${card}`).getAttribute("aria-label")).toBe("Role");
        expect(labelText(odd.field(`position:${card}`))).toBe("Position:");
        expect(labelText(odd.field(`group:${card}`))).toBe("Group:");
        const depth = body.querySelector('input[inputmode="numeric"]');
        if (depth) expect(labelText(depth)).toBe("Depth:");
        expectIconsHidden(body);
        await odd.run(["toggle", card]);
      }
    }

    // A section without a name keeps the recorded way of naming it (as Move up / Duplicate already do).
    const nameless = await mount({ sections: "ODD", groups: "ONE" });
    expect(byLabel(nameless.element, "Move undefined up").getAttribute("title")).toBe("Move up");
    expect(byLabel(nameless.element, "Expand undefined").tagName).toBe("BUTTON");
    expect(byLabel(nameless.element, "Delete undefined").getAttribute("title")).toBe("Delete");

    // Both dialogs' icons.
    const dialogsTab = await mount({}, [
      ["toggle", 0],
      ["macros", 0],
      ["expandEditor", 0],
    ]);
    expect(dialogs()).toHaveLength(2);
    expectIconsHidden(...dialogsTab.modalRoots());
  }, 60_000);

  it('2: every button is type="button"', async () => {
    // The empty tab with the groups panel (no groups) and the add menu.
    let tab = await mount({ sections: "NONE", groups: "NONE" }, [["groups"], ["addSection"]]);
    expectButtonTypes(14, tab.element);

    // Every kind of row expanded, with the lorebook warning.
    for (const sections of ["STD", "MARKERS", "AGENTS", "CONFIGS", "ODD"]) {
      tab = await mount({ sections, groups: "STD", lore: "ON" });
      const count = tab.cards().length;
      for (let card = 0; card < count; card += 1) await tab.run(["toggle", card]);
      expectButtonTypes(count * 6, tab.element);
    }

    // The add menu with agent sections, the groups panel while renaming.
    tab = await mount({ agents: "MIXED", groups: "ODD" }, [["addSection"]]);
    expectButtonTypes(16, tab.element);
    await tab.run(["menuBackdrop"]);
    await tab.run(["groups"]);
    await tab.run(["renameGroup", 0]);
    expectButtonTypes(10, tab.element);

    // Both dialogs.
    tab = await mount({}, [
      ["toggle", 0],
      ["expandEditor", 0],
      ["macros", 0],
    ]);
    expectButtonTypes(4, ...tab.modalRoots());
  }, 60_000);

  it("3: the expanded editor and the macros reference are modal dialogs named by their titles, with a named X", async () => {
    const tab = await mount({ sections: "ODD", groups: "ONE" }, [["toggle", 0]]);

    const expectDialog = (dialog: HTMLElement | undefined, title: string) => {
      expect(dialog).toBeDefined();
      expect(dialog!.getAttribute("aria-modal")).toBe("true");
      expect(document.getElementById(dialog!.getAttribute("aria-labelledby") ?? "")?.textContent).toBe(title);
      expect(dialog!.parentElement!.parentElement).toBe(document.body);
      const close = byLabel(dialog!, "Close");
      expect(close.tagName).toBe("BUTTON");
      expect(close.textContent).toBe("");
    };

    // A row without a name: "Edit Prompt".
    await tab.run(["expandEditor", 0]);
    expectDialog(dialogs()[0], "Edit Prompt");
    await tab.run(["close"]);
    expect(dialogs()).toHaveLength(0);

    // A named row, and the macros reference over it.
    await tab.run(["toggle", 2]);
    await tab.run(["expandEditor", 2]);
    expectDialog(dialogs()[0], "Edit: No Content Key");
    await tab.run(["macros", 2]);
    expectDialog(dialogs()[1], "Macros Reference");
    await tab.run(["close"]);
    expect(dialogs()).toHaveLength(1);
    await tab.run(["key", "body", "Escape"]);
    expect(dialogs()).toHaveLength(0);
  }, 60_000);
});
