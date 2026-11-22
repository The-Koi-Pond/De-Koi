import { afterEach, describe, expect, it, vi } from "vitest";
import { VariablesHarness, worldFor, type Recording } from "./preset-variables-replay-harness";
import show from "./test-fixtures/recorded-show.json";

// The spec's decisions 1 to 3 (docs/provenance/preset-variables.md, "Decisions"): the attributes the replay sets
// aside are checked here, one test per decision.

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

/** The list with the `STD` variables (GENRE single select, NSFW boolean, TAGS multi, MOOD random pick). */
async function mountStd(variables = "STD") {
  harness = new VariablesHarness(worldFor(recording, { id: "decisions", world: { variables }, pre: [], steps: [] }));
  await harness.run(["mount"]);
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

/** The text of the label tied to a field. */
function labelText(field: Element): string {
  return [...((field as HTMLInputElement).labels ?? [])].map((label) => label.textContent).join("|");
}

describe("PresetVariablesEditor decisions", () => {
  it("1: names and states for the chevrons, trash buttons, option controls, labels, switches, icons and grips", async () => {
    const list = await mountStd();
    const page = list.element;

    const chevron = byLabel(page, "Expand TAGS");
    expect(chevron.tagName).toBe("BUTTON");
    expect(chevron.getAttribute("aria-expanded")).toBe("false");
    expect(byLabel(page, "Delete TAGS").getAttribute("title")).toBe("Delete variable");

    await list.run(["toggle", 2]);
    expect(byLabel(page, "Collapse TAGS").getAttribute("aria-expanded")).toBe("true");
    expect(byLabel(page, "Expand GENRE").getAttribute("aria-expanded")).toBe("false");

    for (const number of [1, 2, 3]) {
      expect(byLabel(page, `Edit value of option ${number}`).getAttribute("title")).toBe("Expand value editor");
      expect(byLabel(page, `Remove option ${number}`).getAttribute("title")).toBe("Remove option");
      expect(byLabel(page, `Option ${number} label`).getAttribute("placeholder")).toBe("Label…");
      expect(byLabel(page, `Option ${number} value`).getAttribute("placeholder")).toBe("Value…");
    }

    expect(labelText(list.field("name"))).toBe("Variable Name");
    expect(labelText(list.field("question"))).toBe("Question (shown to user)");
    expect(labelText(list.field("separator"))).toBe("Separator");

    const multiSelect = byLabel(page, "Multi-Select");
    const randomPick = byLabel(page, "Random Pick");
    expect(multiSelect.getAttribute("role")).toBe("switch");
    expect(multiSelect.getAttribute("aria-checked")).toBe("true");
    expect(randomPick.getAttribute("role")).toBe("switch");
    expect(randomPick.getAttribute("aria-checked")).toBe("false");

    await list.run(["toggle", 3]);
    expect(byLabel(page, "Random Pick").getAttribute("aria-checked")).toBe("true");
    await list.run(["toggle", 0]);
    expect(byLabel(page, "Multi-Select").getAttribute("aria-checked")).toBe("false");

    const icons = [...page.querySelectorAll("svg")];
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) expect(icon.getAttribute("aria-hidden")).toBe("true");

    const grips = [...page.querySelectorAll('[title="Drag to reorder"]')];
    expect(grips).toHaveLength(4);
    for (const grip of grips) expect(grip.getAttribute("aria-hidden")).toBe("true");

    // The value editor's icons too (the replay leaves SVGs out).
    await list.run(["expandValue", 0]);
    const dialogIcons = [...list.modalRoot()!.querySelectorAll("svg")];
    expect(dialogIcons.length).toBeGreaterThan(0);
    for (const icon of dialogIcons) expect(icon.getAttribute("aria-hidden")).toBe("true");

    // A variable without a name is called `variable`, as the arrow buttons already were.
    await list.unmount();
    const odd = await mountStd("ODD");
    expect(byLabel(odd.element, "Move variable up").getAttribute("title")).toBe("Move up");
    expect(byLabel(odd.element, "Expand variable").tagName).toBe("BUTTON");
    expect(byLabel(odd.element, "Delete variable").getAttribute("title")).toBe("Delete variable");
  });

  it('2: every button is type="button"', async () => {
    const expectButtons = (root: Element, atLeast: number) => {
      const buttons = [...root.querySelectorAll("button")];
      expect(buttons.length).toBeGreaterThanOrEqual(atLeast);
      for (const button of buttons) expect(button.getAttribute("type"), button.outerHTML).toBe("button");
    };

    // The empty list.
    let list = await mountStd("NONE");
    expectButtons(list.element, 1);
    await list.unmount();

    // Odd rows with cards expanded: no options, blank values, a single multi-select option.
    list = await mountStd("ODD");
    for (const card of [11, 15, 10]) {
      await list.run(["toggle", card]);
      expectButtons(list.element, 80);
    }
    await list.unmount();

    // Many options.
    list = await mountStd("MANY");
    await list.run(["toggle", 0]);
    expectButtons(list.element, 60);
    await list.unmount();

    // A multi-select card with the value editor open.
    list = await mountStd();
    await list.run(["toggle", 2]);
    await list.run(["expandValue", 0]);
    expectButtons(list.element, 20);
    expectButtons(list.modalRoot()!, 2);
  });

  it("3: the value editor is a modal dialog named by its title, with a named close button", async () => {
    const list = await mountStd();
    await list.run(["toggle", 2]);
    await list.run(["expandValue", 1]);
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.getAttribute("aria-modal")).toBe("true");
    const title = document.getElementById(dialog!.getAttribute("aria-labelledby") ?? "");
    expect(title?.textContent).toBe("Edit Value: Cozy");
    expect(dialog!.parentElement!.parentElement).toBe(document.body);
    const close = byLabel(dialog!, "Close");
    expect(close.tagName).toBe("BUTTON");
    await list.run(["close"]);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
