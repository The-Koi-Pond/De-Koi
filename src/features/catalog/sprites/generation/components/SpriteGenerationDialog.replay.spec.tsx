import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUIStore } from "../../../../../shared/stores/ui.store";
import recordings from "../test-fixtures/recorded-calls.json";
import {
  allByRole,
  byRole,
  changeValue,
  click,
  dialogNamed,
  LabelFileReader,
  mount,
  pickFile,
  queryByRole,
  settle,
  type Mounted,
} from "../test-fixtures/dialog-driver";
import { DialogHost, hostEvents, RECORDED_PERSONA, type HostProps } from "../test-fixtures/dialog-host";
import { isDialogMadePicture, runtime, type RecordedCall } from "../test-fixtures/fake-runtime";

vi.mock("../../../../../shared/api/tauri-client", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  invokeTauri: (await import("../test-fixtures/fake-runtime")).invokeTauri,
}));
vi.mock("../../../../../shared/api/local-file-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  invalidateRemoteManagedAssetObjectUrlsAfter: (value: unknown) => value,
}));
vi.mock("../lib/sheet-raster", async () => {
  const fake = await import("../test-fixtures/fake-runtime");
  return { loadSheet: fake.loadSheet, cutSheetBox: fake.cutSheetBox };
});
vi.mock("../../../../../shared/lib/sprite-frame-crop", async () => ({
  cropSpriteDataUrl: (await import("../test-fixtures/fake-runtime")).cropSpriteDataUrl,
}));

/** The Sprites tab, not the dialog, sends these. */
const TAB_COMMANDS = new Set(["sprite_list", "sprite_capabilities_command"]);

interface Scenario {
  scenario: number;
  title: string;
  calls: RecordedCall[];
}

function recorded(scenario: number): Scenario {
  const found = (recordings.scenarios as Scenario[]).find((item) => item.scenario === scenario);
  if (!found) throw new Error(`No recorded scenario ${scenario}`);
  return found;
}

function dialogCalls(scenario: number): RecordedCall[] {
  return recorded(scenario).calls.filter((call) => !TAB_COMMANDS.has(call.command));
}

/** Pictures the dialog made itself can't match byte for byte; everything else must. */
function comparable(value: unknown): unknown {
  if (typeof value === "string") return isDialogMadePicture(value) ? "<picture made by the dialog>" : value;
  if (Array.isArray(value)) return value.map(comparable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, comparable(item)]));
  }
  return value;
}

const view = () => dialogNamed("Generate sprites");
const button = (name: string | RegExp) => byRole("button", name, view());
const alertText = () => queryByRole("alert", undefined, view())?.textContent ?? null;

async function generate() {
  await click(button(/^Generate /));
  await settle();
}

async function save() {
  await click(button(/^Save \d+ sprites?$/));
  await settle();
}

async function backToSetup() {
  await click(button("Back to setup"));
  const discard = queryByRole("button", "Discard", view());
  if (discard) await click(discard);
}

async function setChecked(name: string | RegExp, checked: boolean) {
  const box = byRole<HTMLInputElement>("checkbox", name, view());
  if (box.checked !== checked) await click(box);
}

async function chips(...names: string[]) {
  for (const name of names) await click(button(name));
}

async function upload(label: string) {
  const input = view().querySelector<HTMLInputElement>("input[type='file']");
  if (!input) throw new Error("No upload tile");
  await pickFile(input, new File([label], "reference.png", { type: "image/png" }));
}

function reviewDialog(): HTMLElement {
  return dialogNamed(/^Review Image Prompts?$/);
}

/** Each drivable scenario: the host's props, the prompt review setting, and the person's steps. */
const SCENARIOS: Record<number, { props?: HostProps; review?: boolean; steps: () => Promise<void> }> = {
  1: {
    steps: async () => {
      await generate();
      await save();
      expect(hostEvents.spritesGenerated).toBe(1);
      expect(hostEvents.closes).toBe(1);
    },
  },
  2: {
    steps: async () => {
      await setChecked(/^Use current avatar/, false);
      await upload("fake:cell0");
      await upload("fake:cell0");
      await changeValue(byRole("textbox", "Appearance", view()), "  blue eyes, red scarf  ");
      await generate();
      await save();
    },
  },
  3: {
    steps: async () => {
      await upload("fake:cell0");
      await upload("fake:cell0");
      await upload("fake:cell0");
      expect(view().querySelector("input[type='file']")).toBeNull();
      await generate();
    },
  },
  4: {
    steps: async () => {
      await click(byRole("radio", "1 (1×1)", view()));
      await chips("Happy");
      await generate();
      for (const count of ["9 (3×3)", "12 (3×4)", "16 (4×4)"]) {
        await backToSetup();
        await click(byRole("radio", count, view()));
        await generate();
      }
    },
  },
  5: {
    steps: async () => {
      await chips("Sad", "Angry", "Smirk", "Crying", "Sleepy");
      await generate();
      await backToSetup();
      await chips("Crying", "Smirk");
      await generate();
    },
  },
  6: {
    props: { initialSpriteType: "full-body" },
    steps: async () => {
      await generate();
      await backToSetup();
      await click(byRole("radio", "1 (1×1)", view()));
      expect(button("Generate pose")).toBeTruthy();
      await generate();
      await save();
    },
  },
  7: {
    props: {
      initialSpriteType: "full-body",
      existingExpressionNames: ["angry", "happy", "neutral", "smirk", "very_sad"],
    },
    steps: async () => {
      await setChecked(/^Match existing expression sprites/, true);
      await generate();
      await save();
    },
  },
  8: {
    props: {
      initialSpriteType: "full-body",
      existingExpressionNames: Array.from({ length: 18 }, (_, index) => `expr${index + 1}`).sort(),
    },
    steps: async () => {
      await setChecked(/^Match existing expression sprites/, true);
      expect(view().textContent).toContain("First 16 used");
      await generate();
    },
  },
  9: {
    props: {
      initialSpriteType: "full-body",
      existingExpressionNames: ["angry", "happy", "neutral", "smirk", "thinking", "very_sad"],
    },
    steps: async () => {
      await setChecked(/^Match existing expression sprites/, true);
      await generate();
      expect(alertText()).toBe(
        "Batch 2 of 2 failed after one automatic retry: None of the sprites could be generated. Try again, or pick another connection.",
      );
      expect(view().textContent).toContain("Batch 2 of 2 paused");
      await click(button("Retry batch"));
      await settle();
      expect(alertText()).toBeNull();
      await save();
    },
  },
  10: {
    steps: async () => {
      await setChecked("Prefer transparent PNG", true);
      await generate();
      await save();
    },
  },
  11: {
    steps: async () => {
      await generate();
      await setChecked("Transparent background", true);
      await changeValue(byRole("slider", "Cleanup strength", view()), "70");
      await click(button("Apply cleanup"));
      expect(button("Reapply cleanup")).toBeTruthy();
      await click(button("Use original"));
      // "Use original" marks cleanup as not applied, so the button is back to its first label.
      await click(button("Apply cleanup"));
      await setChecked("Transparent background", false);
      await save();
    },
  },
  12: {
    steps: async () => {
      await setChecked("Prefer transparent PNG", true);
      await generate();
      expect(alertText()).toBe("Couldn't remove the background. Use Apply cleanup to try again.");
      expect(allByRole("checkbox", /^Keep /, view())).toHaveLength(6);
    },
  },
  13: {
    review: true,
    steps: async () => {
      await generate();
      const [prompt, negative] = allByRole("textbox", undefined, reviewDialog());
      await changeValue(prompt, "PROMPT-EDITED");
      await changeValue(negative, "NEG-EDITED");
      await click(byRole("button", "Generate", reviewDialog()));
      await settle();
      await backToSetup();
      await generate();
      await click(byRole("button", "Cancel", reviewDialog()));
      await settle();
      expect(button(/^Generate /)).toBeTruthy();
      expect(alertText()).toBeNull();
      await generate();
      await backToSetup();
      await generate();
      await click(byRole("button", "Generate", reviewDialog()));
      await settle();
    },
  },
  14: {
    review: true,
    props: {
      initialSpriteType: "full-body",
      existingExpressionNames: ["angry", "happy", "neutral", "smirk", "very_sad"],
    },
    steps: async () => {
      await setChecked(/^Match existing expression sprites/, true);
      await generate();
      await click(byRole("button", "Cancel", reviewDialog()));
      await settle();
      await click(byRole("button", "Cancel", reviewDialog()));
      await settle();
      expect(alertText()).toBe("Batch 1 of 2 failed after one automatic retry: Image generation failed. Try again.");
    },
  },
  15: {
    steps: async () => {
      await generate();
      expect(alertText()).toBe("Some expressions didn't generate: sad. Generate again to retry them.");
      expect(view().textContent).not.toContain("Adjust slices");
      await save();
    },
  },
  16: {
    steps: async () => {
      await generate();
      expect(alertText()).toBe("Provider says: quota exceeded (fake)");
      await generate();
      expect(alertText()).toBe("None of the sprites could be generated. Try again, or pick another connection.");
    },
  },
  17: {
    steps: async () => {
      await generate();
      await changeValue(byRole("slider", "Side margin", view()), "2");
      await changeValue(byRole("slider", "Column cut 1", view()), "3");
      await changeValue(byRole("slider", "Crop top", view()), "5");
      await click(button("Apply slice"));
      await save();
      const images = runtime.sent
        .filter((call) => call.command === "sprite_upload")
        .map((call) => (call.args as { body: { image: string } }).body.image.replace("data:image/png;base64,", ""));
      expect(images).toEqual([
        "cut:fake:2x3:sheet@20,26,523x486",
        "cut:fake:2x3:sheet@543,26,461x486",
        "cut:fake:2x3:sheet@20,538,523x486",
        "cut:fake:2x3:sheet@543,538,461x486",
        "cut:fake:2x3:sheet@20,1050,523x486",
        "cut:fake:2x3:sheet@543,1050,461x486",
      ]);
    },
  },
  18: {
    steps: async () => {
      await generate();
      await click(button("Frame sprite 2"));
      await changeValue(byRole("slider", "Top", view()), "10");
      await changeValue(byRole("slider", "Left", view()), "85");
      await click(button("Apply frame"));
      await save();
      const second = runtime.sent.filter((call) => call.command === "sprite_upload")[1];
      expect((second.args as { body: { image: string } }).body.image).toBe(
        "data:image/png;base64,frame:10,0,80,0:fake:cell1",
      );
    },
  },
  19: {
    steps: async () => {
      await generate();
      const list = byRole<HTMLSelectElement>("combobox", "Sprite 1 name list", view());
      await changeValue(list, list.options[3].value);
      // The recording typed into sprite 3's box with the caret at the start; each keystroke is renamed at once.
      const box = byRole<HTMLInputElement>("textbox", "Sprite 3 name", view());
      const typed = "Very Happy!";
      for (let index = 0; index < typed.length; index += 1) {
        await changeValue(box, index === 0 ? `${typed[0]}${box.value}` : `${box.value}${typed[index]}`);
      }
      expect(box.value).toBe("vsaderyhappy_");
      await changeValue(byRole("textbox", "Sprite 2 name", view()), "");
      await changeValue(byRole("textbox", "Sprite 4 name", view()), "");
      await setChecked("Keep surprised", false);
      await setChecked("Keep smirk", false);
      expect(button(/^Save \d+ sprites?$/).textContent).toBe("Save 2 sprites");
      await save();
    },
  },
  20: {
    props: RECORDED_PERSONA,
    steps: async () => {
      await generate();
      await save();
    },
  },
  21: {
    steps: async () => {
      await generate();
      await save();
      expect(alertText()).toBe("Saved 2 of 6. Couldn't save sad. Try again.");
      expect(hostEvents.spritesGenerated).toBe(1);
      await save();
      expect(hostEvents.spritesGenerated).toBe(2);
    },
  },
  22: {
    props: { initialSpriteType: "full-body" },
    steps: async () => {
      await generate();
      await click(button("Close Generate sprites"));
      await mounted.render(<DialogHost initialSpriteType="expressions" />);
      hostEvents.setOpen(true);
      await settle();
      await save();
    },
  },
  23: {
    steps: async () => {
      await generate();
      await click(button("Back to setup"));
      expect(view().textContent).toContain("Discard these 6 sprites?");
      await click(button("Discard"));
      await generate();
    },
  },
};

/** Recorded scenarios this replay can't drive, and why. */
const NOT_REPLAYED: Record<number, string> = {
  24: "Capabilities with generation unavailable disable the tab's Generate Sprite button, so the dialog never opened and sent nothing; the dialog's own unavailable state is covered in SpriteGenerationDialog.spec.tsx.",
  25: "A hosted install's 30-second client limit lives in the runtime wrapper (decision 4, a follow-up); the dialog sends the same single request either way.",
};

let mounted: Mounted;

beforeEach(() => {
  hostEvents.reset();
  vi.stubGlobal("FileReader", LabelFileReader);
});

afterEach(async () => {
  await mounted?.unmount();
  useUIStore.setState({ reviewImagePromptsBeforeSend: false });
  vi.unstubAllGlobals();
});

describe("sprite generation dialog replays the recorded calls", () => {
  it("covers every recorded scenario", () => {
    const covered = [...Object.keys(SCENARIOS), ...Object.keys(NOT_REPLAYED)].map(Number).sort((a, b) => a - b);
    expect(covered).toEqual((recordings.scenarios as Scenario[]).map((item) => item.scenario));
  });

  it.each(Object.keys(SCENARIOS).map(Number))("scenario %i", async (number) => {
    const scenario = SCENARIOS[number];
    const expected = dialogCalls(number);
    runtime.reset(expected);
    useUIStore.setState({ reviewImagePromptsBeforeSend: scenario.review === true });
    mounted = await mount(<DialogHost {...scenario.props} />);
    await scenario.steps();
    expect(comparable(runtime.sent)).toEqual(comparable(expected.map(({ command, args }) => ({ command, args }))));
  });
});
