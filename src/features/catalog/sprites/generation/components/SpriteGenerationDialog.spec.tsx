import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUIStore } from "../../../../../shared/stores/ui.store";
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
import { CAPABILITIES, DialogHost, hostEvents, type HostProps } from "../test-fixtures/dialog-host";
import { runtime, type RecordedCall } from "../test-fixtures/fake-runtime";

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

const NAMES = ["neutral", "happy", "sad", "angry", "surprised", "smirk"];

function sheetReply(names = NAMES, sheet = "fake:2x3:sheet"): RecordedCall {
  return {
    command: "sprite_generate_sheet",
    args: null,
    reply: {
      sheetBase64: sheet,
      cells: names.map((name, index) => ({ expression: name, base64: `fake:cell${index}` })),
    },
  };
}

const CLEANED: RecordedCall = { command: "sprite_cleanup", args: null, reply: "cleaned(fake:clean per cell)" };
const SIX_UPLOADS: RecordedCall[] = NAMES.map(() => ({ command: "sprite_upload", args: null }));

const view = () => dialogNamed("Generate sprites");
const button = (name: string | RegExp) => byRole("button", name, view());
const alertText = () => queryByRole("alert", undefined, view())?.textContent ?? null;
const sentCommands = () => runtime.sent.map((call) => call.command);
const uploads = () =>
  runtime.sent
    .filter((call) => call.command === "sprite_upload")
    .map((call) => (call.args as { body: { expression: string; image: string } }).body);

async function setChecked(name: string | RegExp, checked: boolean) {
  const box = byRole<HTMLInputElement>("checkbox", name, view());
  if (box.checked !== checked) await click(box);
}

async function generate() {
  await click(button(/^Generate /));
  await settle();
}

let mounted: Mounted | null = null;

async function open(props: HostProps = {}, replies: RecordedCall[] = []) {
  runtime.reset(replies);
  mounted = await mount(<DialogHost {...props} />);
}

beforeEach(() => {
  hostEvents.reset();
  vi.stubGlobal("FileReader", LabelFileReader);
});

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  useUIStore.setState({ reviewImagePromptsBeforeSend: false });
  vi.unstubAllGlobals();
});

describe("setup step", () => {
  it("names its controls and shows the type and count as radio groups and chips as toggles", async () => {
    await open();
    expect(byRole("radio", "Expressions (portrait)", view()).getAttribute("aria-checked")).toBe("true");
    expect(byRole("radio", "6 (2×3)", view()).getAttribute("aria-checked")).toBe("true");
    expect(button("Happy").getAttribute("aria-pressed")).toBe("true");
    expect(button("Blushing").getAttribute("aria-pressed")).toBe("false");
    expect(byRole<HTMLSelectElement>("combobox", "Image generation connection", view()).value).toBe(
      "<connection-gpt-image-1>",
    );
    expect(byRole("textbox", "Appearance", view())).toBeTruthy();
    expect(view().textContent).toContain("Pick up to 6. A pick past 6 replaces the oldest one.");
    expect(button("Generate sheet")).toBeTruthy();
  });

  it("shows pose lists and labels on the Full-body tab", async () => {
    await open();
    await click(byRole("radio", "Full-body", view()));
    expect(view().textContent).toContain("Pose count");
    expect(button("Battle stance").getAttribute("aria-pressed")).toBe("true");
    expect(button("Generate pose sheet")).toBeTruthy();
    await click(byRole("radio", "1 (1×1)", view()));
    expect(view().textContent).toContain("Generate one full-body pose image. Pick the pose you want to render.");
  });

  it("says why Generate is disabled", async () => {
    await open({ defaultAppearance: "   " });
    expect((button("Generate sheet") as HTMLButtonElement).disabled).toBe(true);
    expect(view().textContent).toContain("Describe their appearance to generate.");
    await changeValue(byRole("textbox", "Appearance", view()), "red coat");
    expect((button("Generate sheet") as HTMLButtonElement).disabled).toBe(false);
    for (const name of NAMES) await click(button(name.charAt(0).toUpperCase() + name.slice(1)));
    expect(view().textContent).toContain("Pick at least one expression to generate.");
  });

  it("explains missing connections and unavailable generation", async () => {
    await open({
      imageConnections: [],
      spriteCapabilities: { ...CAPABILITIES, spriteGenerationAvailable: false, reason: "No sprite support here." },
    });
    expect(view().textContent).toContain("No image generation connections found.");
    expect(queryByRole("note", undefined, view())?.textContent).toBe("No sprite support here.");
    const generateButton = button("Generate sheet") as HTMLButtonElement;
    expect(generateButton.disabled).toBe(true);
    expect(generateButton.title).toBe("No sprite support here.");
  });

  it("shows the GPT-Image-2 note only with Prefer transparent PNG on that model", async () => {
    await open();
    await changeValue(byRole("combobox", "Image generation connection", view()), "<connection-gpt-image-2>");
    expect(view().textContent).not.toContain("GPT-Image-2 does not support");
    await setChecked("Prefer transparent PNG", true);
    expect(view().textContent).toContain("GPT-Image-2 does not support native transparent backgrounds right now");
  });

  it("keeps uploads within the reference limit and names their remove buttons", async () => {
    await open();
    const input = () => view().querySelector<HTMLInputElement>("input[type='file']");
    await setChecked(/^Use current avatar/, false);
    for (let index = 0; index < 4; index += 1) {
      await pickFile(input()!, new File([`fake:upload${index}`], "a.png", { type: "image/png" }));
    }
    expect(input()).toBeNull();
    await setChecked(/^Use current avatar/, true);
    expect(allByRole("button", /^Remove reference image \d$/, view())).toHaveLength(3);
    await click(button("Remove reference image 1"));
    expect(allByRole("button", /^Remove reference image \d$/, view())).toHaveLength(2);
  });

  it("only offers matching on Full-body when there are portrait names", async () => {
    await open({ existingExpressionNames: ["Happy", "very sad"] });
    expect(queryByRole("checkbox", /^Match existing/, view())).toBeNull();
    await click(byRole("radio", "Full-body", view()));
    await setChecked(/^Match existing/, true);
    expect(view().textContent).toContain("Matched expressions (2)");
    expect(view().textContent).toContain("very sad");
    expect(view().textContent).toContain("Each batch of up to 4 is one sheet");
    expect(button("Generate matched batches")).toBeTruthy();
    await click(byRole("radio", "Expressions (portrait)", view()));
    await click(byRole("radio", "Full-body", view()));
    expect(byRole<HTMLInputElement>("checkbox", /^Match existing/, view()).checked).toBe(false);
  });
});

describe("review step", () => {
  it("counts only named, selected sprites for Save and marks the unnamed ones", async () => {
    await open({}, [sheetReply()]);
    await generate();
    await changeValue(byRole("textbox", "Sprite 1 name", view()), "");
    expect(view().textContent).toContain("Needs a name");
    for (const name of NAMES.slice(1, 5)) await setChecked(`Keep ${name}`, false);
    expect(button(/^Save /).textContent).toBe("Save 1 sprite");
    await setChecked("Keep smirk", false);
    expect((button(/^Save /) as HTMLButtonElement).disabled).toBe(true);
  });

  it("warns when two kept sprites share a save name", async () => {
    await open({}, [sheetReply()]);
    await generate();
    await changeValue(byRole("textbox", "Sprite 2 name", view()), "neutral");
    expect(view().textContent).toContain("Two sprites are named neutral; only the last one will be kept.");
  });

  it("lays tiles out in the generation's columns, at most two on narrow screens", async () => {
    await open({}, [sheetReply(NAMES.concat(["scared", "disgusted", "thinking"]), "fake:3x3:sheet")]);
    await click(byRole("radio", "9 (3×3)", view()));
    await generate();
    const grid = byRole("checkbox", "Keep neutral", view()).closest("ul");
    expect(grid?.className).toContain("grid-cols-2 sm:grid-cols-3");
  });

  it("asks before going back to setup and sends nothing", async () => {
    await open({}, [sheetReply()]);
    await generate();
    await click(button("Back to setup"));
    expect(view().textContent).toContain("Discard these 6 sprites?");
    await click(button("Keep them"));
    expect(allByRole("checkbox", /^Keep /, view())).toHaveLength(6);
    await click(button("Back to setup"));
    await click(button("Discard"));
    expect(button("Generate sheet")).toBeTruthy();
    expect(sentCommands()).toEqual(["sprite_generate_sheet"]);
  });

  it("shows the cut failure in its own words and changes nothing", async () => {
    await open({}, [sheetReply()]);
    await generate();
    await changeValue(byRole("slider", "Top/bottom margin", view()), "18");
    await changeValue(byRole("slider", "Row gap", view()), "24");
    await click(button("Apply slice"));
    expect(alertText()).toBe("These cut settings leave no room for a sprite. Lower the margins, gaps or crops.");
    await click(button("Reset slices"));
    expect(byRole<HTMLInputElement>("slider", "Row gap", view()).value).toBe("0");
  });

  it("frames the original and the cleaned picture, and loses the frame when the cuts are applied again", async () => {
    await open({}, [sheetReply(), CLEANED, ...SIX_UPLOADS]);
    await generate();
    await setChecked("Transparent background", true);
    await click(button("Apply cleanup"));
    await click(button("Frame sprite 2"));
    await changeValue(byRole("slider", "Bottom", view()), "60");
    await changeValue(byRole("slider", "Top", view()), "50");
    expect(byRole<HTMLInputElement>("slider", "Bottom", view()).value).toBe("40");
    await click(button("Apply frame"));
    expect(queryByRole("button", "Close frame editor", view())).toBeNull();
    await click(button("Use original"));
    await click(button("Save 6 sprites"));
    await settle();
    expect(uploads()[1].image).toBe("data:image/png;base64,frame:50,40,0,0:fake:cell1");

    runtime.reset([sheetReply(), CLEANED, ...SIX_UPLOADS]);
    hostEvents.setOpen(true);
    await settle();
    await generate();
    await setChecked("Transparent background", true);
    await click(button("Apply cleanup"));
    await click(button("Frame sprite 1"));
    await changeValue(byRole("slider", "Left", view()), "10");
    await click(button("Apply frame"));
    await click(button("Apply slice"));
    await click(button("Save 6 sprites"));
    await settle();
    expect(uploads()[0].image).toBe("data:image/png;base64,cut:fake:2x3:sheet@0,0,512x512");
  });

  it("keeps Apply cleanup off with the engine's reason when it isn't installed", async () => {
    await open(
      {
        spriteCapabilities: {
          ...CAPABILITIES,
          cleanupEngine: { ...CAPABILITIES.cleanupEngine!, installed: false, reason: "Remover missing." },
        },
      },
      [sheetReply()],
    );
    await generate();
    await setChecked("Transparent background", true);
    const apply = button("Apply cleanup") as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    expect(apply.title).toBe("Remover missing.");
    expect(view().textContent).toContain("Remover missing.");
  });

  it("shows a cleanup failure without changing the pictures", async () => {
    await open({}, [
      sheetReply(),
      { command: "sprite_cleanup", args: null, replyError: { code: "sprite_cleanup_failed", message: "x" } },
    ]);
    await generate();
    await setChecked("Transparent background", true);
    await click(button("Apply cleanup"));
    expect(alertText()).toBe("Couldn't apply background cleanup. Try again.");
    expect(button("Apply cleanup")).toBeTruthy();
  });

  it("announces matched batch progress while waiting", async () => {
    let release: () => void = () => {};
    await open({ initialSpriteType: "full-body", existingExpressionNames: ["happy"] });
    runtime.reset([sheetReply(["happy"], "fake:1x1-full:sheet")]);
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = runtime.replies.shift()!;
    runtime.replies.unshift({ ...original, reply: pending.then(() => original.reply) });
    await setChecked(/^Match existing/, true);
    await click(button("Generate matched batches"));
    expect(queryByRole("status", undefined, view())?.textContent).toBe("Batch 1 of 1: happy");
    release();
    await settle();
    expect(allByRole("checkbox", /^Keep /, view())).toHaveLength(1);
  });
});

describe("opening, closing and owners", () => {
  it("keeps the results but resets the settings beneath them when it opens again", async () => {
    await open({}, [sheetReply()]);
    await setChecked("Prefer transparent PNG", true);
    await changeValue(byRole("textbox", "Appearance", view()), "kept look");
    runtime.reset([sheetReply(), CLEANED]);
    await generate();
    expect(byRole<HTMLInputElement>("checkbox", "Transparent background", view()).checked).toBe(true);
    await click(button("Close Generate sprites"));
    expect(hostEvents.closes).toBe(1);
    hostEvents.setOpen(true);
    await settle();
    expect(allByRole("checkbox", /^Keep /, view())).toHaveLength(6);
    expect(byRole<HTMLInputElement>("checkbox", "Transparent background", view()).checked).toBe(false);
    await click(button("Back to setup"));
    await click(button("Discard"));
    expect(byRole<HTMLTextAreaElement>("textbox", "Appearance", view()).value).toBe("kept look");
    expect(byRole<HTMLInputElement>("checkbox", "Prefer transparent PNG", view()).checked).toBe(false);
  });

  it("starts over for a new owner", async () => {
    await open({}, [sheetReply()]);
    await generate();
    await mounted!.render(
      <DialogHost entityId="<other-id>" defaultAvatarUrl={null} defaultAppearance="Someone else." />,
    );
    expect(button("Generate sheet")).toBeTruthy();
    expect(byRole<HTMLTextAreaElement>("textbox", "Appearance", view()).value).toBe("Someone else.");
    expect(queryByRole("checkbox", /^Use current avatar/, view())).toBeNull();
  });

  it("counts the prompt review as cancelled when the dialog goes away", async () => {
    useUIStore.setState({ reviewImagePromptsBeforeSend: true });
    await open({}, [
      {
        command: "sprite_generate_sheet_preview",
        args: null,
        reply: { items: [{ id: "a", kind: "sprite", title: "t", prompt: "p", width: 1, height: 1 }] },
      },
    ]);
    await generate();
    expect(dialogNamed("Review Image Prompt")).toBeTruthy();
    await mounted!.unmount();
    mounted = null;
    await settle();
    expect(sentCommands()).toEqual(["sprite_generate_sheet_preview"]);
  });
});
