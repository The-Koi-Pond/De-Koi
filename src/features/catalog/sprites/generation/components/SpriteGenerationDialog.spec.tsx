import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUIStore } from "../../../../../shared/stores/ui.store";
import {
  allByRole,
  blur,
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
const confirmDialog = vi.hoisted(() => ({ answer: true, asked: [] as string[] }));
vi.mock("../../../../../shared/lib/app-dialogs", () => ({
  showConfirmDialog: async (options: { message: string }) => {
    confirmDialog.asked.push(options.message);
    return confirmDialog.answer;
  },
}));
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

function deferred() {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { gate, release };
}

/** A reply that waits for `release`, then answers (or fails) like `reply`. */
function held(command: string, reply: () => unknown): { call: RecordedCall; release: () => void } {
  const { gate, release } = deferred();
  return { call: { command, args: null, reply: gate.then(reply) }, release };
}

const cleanedCells = () => ({ cells: NAMES.map((name) => ({ expression: name, base64: "fake:clean" })) });

const OTHER_OWNER = <DialogHost entityId="<other-id>" defaultAvatarUrl={null} defaultAppearance="Someone else." />;

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
  confirmDialog.answer = true;
  confirmDialog.asked = [];
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

  it("stops at a cancelled review mid-run and shows the finished batch, with the next one waiting (decision 3)", async () => {
    useUIStore.setState({ reviewImagePromptsBeforeSend: true });
    const five = ["angry", "happy", "neutral", "smirk", "very_sad"];
    const preview: RecordedCall = {
      command: "sprite_generate_sheet_preview",
      args: null,
      reply: { items: [{ id: "a", kind: "sprite", title: "t", prompt: "p", width: 1, height: 1 }] },
    };
    await open({ initialSpriteType: "full-body", existingExpressionNames: five }, [
      preview,
      sheetReply(five.slice(0, 4), "fake:2x2-full:sheet"),
      preview,
    ]);
    await setChecked(/^Match existing/, true);
    await click(button("Generate matched batches"));
    await click(byRole("button", "Generate", dialogNamed("Review Image Prompt")));
    await settle();
    await click(byRole("button", "Cancel", dialogNamed("Review Image Prompt")));
    await settle();
    expect(sentCommands()).toEqual([
      "sprite_generate_sheet_preview",
      "sprite_generate_sheet",
      "sprite_generate_sheet_preview",
    ]);
    expect(allByRole("checkbox", /^Keep /, view())).toHaveLength(4);
    expect(alertText()).toBeNull();
    expect(view().textContent).toContain("Batch 2 of 2 paused");
    expect(view().textContent).toContain("You cancelled its prompt review.");
  });

  it("keeps a matched batch uncleaned when its cleanup fails, without generating it again (decision 2)", async () => {
    await open({ initialSpriteType: "full-body", existingExpressionNames: ["happy"] }, [
      sheetReply(["happy"], "fake:1x1-full:sheet"),
      { command: "sprite_cleanup", args: null, replyError: { code: "some_internal_error", message: "boom" } },
    ]);
    await setChecked("Prefer transparent PNG", true);
    await setChecked(/^Match existing/, true);
    await click(button("Generate matched batches"));
    await settle();
    expect(sentCommands()).toEqual(["sprite_generate_sheet", "sprite_cleanup"]);
    expect(allByRole("checkbox", /^Keep /, view())).toHaveLength(1);
    expect(alertText()).toBe("Couldn't remove the background. Use Apply cleanup to try again.");
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
  it("keeps the results and the settings they were made with when it opens again (decision 1)", async () => {
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
    expect(byRole<HTMLInputElement>("checkbox", "Transparent background", view()).checked).toBe(true);
    await click(button("Back to setup"));
    await click(button("Discard"));
    expect(byRole<HTMLTextAreaElement>("textbox", "Appearance", view()).value).toBe("kept look");
    expect(byRole<HTMLInputElement>("checkbox", "Prefer transparent PNG", view()).checked).toBe(true);
  });

  it("resets the setup beneath the appearance when it opens again on the setup step", async () => {
    await open({}, []);
    await setChecked("Prefer transparent PNG", true);
    await changeValue(byRole("textbox", "Appearance", view()), "kept look");
    await click(button("Close Generate sprites"));
    hostEvents.setOpen(true);
    await settle();
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

describe("names that the save rule empties", () => {
  it("counts full_ on Expressions as unnamed and never sends an empty save name", async () => {
    await open({}, [sheetReply(), ...SIX_UPLOADS]);
    await generate();
    await changeValue(byRole("textbox", "Sprite 1 name", view()), "FULL_");
    expect(byRole<HTMLInputElement>("textbox", "Sprite 1 name", view()).value).toBe("FULL_");
    await blur(byRole("textbox", "Sprite 1 name", view()));
    expect(byRole<HTMLInputElement>("textbox", "Sprite 1 name", view()).value).toBe("full_");
    expect(view().textContent).toContain("Needs a name");
    expect(button(/^Save /).textContent).toBe("Save 5 sprites");
    await click(button("Save 5 sprites"));
    await settle();
    expect(uploads().map((body) => body.expression)).toEqual(["happy", "sad", "angry", "surprised", "smirk"]);
  });
});

describe("work that overlaps a running cleanup", () => {
  it("holds cuts, frames and the Transparent background box until the cleanup is back", async () => {
    const cleanup = held("sprite_cleanup", cleanedCells);
    await open({}, [sheetReply(), cleanup.call]);
    await generate();
    await setChecked("Transparent background", true);
    await click(button("Frame sprite 1"));
    await click(button("Apply cleanup"));
    expect((button("Apply slice") as HTMLButtonElement).disabled).toBe(true);
    expect((button("Apply frame") as HTMLButtonElement).disabled).toBe(true);
    expect((button("Frame sprite 2") as HTMLButtonElement).disabled).toBe(true);
    expect(byRole<HTMLInputElement>("checkbox", "Transparent background", view()).disabled).toBe(true);
    cleanup.release();
    await settle();
    expect((button("Apply slice") as HTMLButtonElement).disabled).toBe(false);
    expect((button("Apply frame") as HTMLButtonElement).disabled).toBe(false);
    expect(byRole<HTMLInputElement>("checkbox", "Transparent background", view()).disabled).toBe(false);
    expect(button("Use original")).toBeTruthy();
  });

  it("drops a cleanup reply that comes back after the sprites were replaced", async () => {
    const cleanup = held("sprite_cleanup", cleanedCells);
    await open({}, [sheetReply(), cleanup.call, sheetReply(), ...SIX_UPLOADS]);
    await generate();
    await setChecked("Transparent background", true);
    await click(button("Apply cleanup"));
    await click(button("Back to setup"));
    await click(button("Discard"));
    await generate();
    await setChecked("Transparent background", true);
    cleanup.release();
    await settle();
    expect(queryByRole("button", "Use original", view())).toBeNull();
    expect(alertText()).toBeNull();
    await click(button("Save 6 sprites"));
    await settle();
    expect(uploads()[0].image).toBe("data:image/png;base64,fake:cell0");
  });
});

describe("a new owner while work is still running", () => {
  it("closes an open prompt review so the old owner's run sends nothing more", async () => {
    useUIStore.setState({ reviewImagePromptsBeforeSend: true });
    await open({}, [
      {
        command: "sprite_generate_sheet_preview",
        args: null,
        reply: { items: [{ id: "a", kind: "sprite", title: "t", prompt: "p", width: 1, height: 1 }] },
      },
      sheetReply(),
    ]);
    await generate();
    expect(dialogNamed("Review Image Prompt")).toBeTruthy();
    await mounted!.render(OTHER_OWNER);
    await settle();
    // If the review is still in the page (an exit animation), confirming it now must do nothing.
    const review = allByRole("dialog").find((item) => item.querySelector("h2")?.textContent === "Review Image Prompt");
    const confirm = review ? queryByRole("button", "Generate", review) : null;
    if (confirm) await click(confirm);
    await settle();
    expect(button("Generate sheet")).toBeTruthy();
    expect(allByRole("checkbox", /^Keep /, view())).toHaveLength(0);
    expect(sentCommands()).toEqual(["sprite_generate_sheet_preview"]);
  });

  it("stops a matched run for the old owner: the next batch is never sent", async () => {
    const five = ["angry", "happy", "neutral", "smirk", "very_sad"];
    await open({ initialSpriteType: "full-body", existingExpressionNames: five });
    const first = held("sprite_generate_sheet", () => sheetReply(five.slice(0, 4), "fake:2x2-full:sheet").reply);
    runtime.reset([first.call, sheetReply(["very_sad"], "fake:1x1-full:sheet")]);
    await setChecked(/^Match existing/, true);
    await click(button("Generate matched batches"));
    expect(sentCommands()).toEqual(["sprite_generate_sheet"]);
    await mounted!.render(OTHER_OWNER);
    await settle();
    first.release();
    await settle();
    expect(sentCommands()).toEqual(["sprite_generate_sheet"]);
    expect(allByRole("checkbox", /^Keep /, view())).toHaveLength(0);
  });

  it("doesn't show the old owner's save failure or refresh for it", async () => {
    const failing = held("sprite_upload", () => {
      throw Object.assign(new Error("disk full"), { details: { code: "image_provider_error" } });
    });
    await open({}, [sheetReply(), { command: "sprite_upload", args: null }, failing.call]);
    await generate();
    await click(button("Save 6 sprites"));
    await mounted!.render(OTHER_OWNER);
    failing.release();
    await settle();
    expect(alertText()).toBeNull();
    expect(hostEvents.spritesGenerated).toBe(0);
  });

  it("doesn't show the old owner's cleanup failure", async () => {
    const failing = held("sprite_cleanup", () => {
      throw new Error("boom");
    });
    await open({}, [sheetReply(), failing.call]);
    await generate();
    await setChecked("Transparent background", true);
    await click(button("Apply cleanup"));
    await mounted!.render(OTHER_OWNER);
    failing.release();
    await settle();
    expect(alertText()).toBeNull();
  });
});

describe("saving over saved sprites", () => {
  it("asks before replacing saved sprites and sends nothing when cancelled", async () => {
    confirmDialog.answer = false;
    await open({ savedSpriteNames: ["happy", "full_idle", "Smirk"] }, [sheetReply()]);
    await generate();
    await click(button("Save 6 sprites"));
    await settle();
    expect(confirmDialog.asked).toEqual(["Replace 2 saved sprites: happy, smirk?"]);
    expect(uploads()).toEqual([]);
    expect(hostEvents.closes).toBe(0);
    expect(button("Save 6 sprites")).toBeTruthy();
  });

  it("saves exactly as before once the replacement is confirmed", async () => {
    await open({ savedSpriteNames: ["happy"] }, [sheetReply(), ...SIX_UPLOADS]);
    await generate();
    await click(button("Save 6 sprites"));
    await settle();
    expect(confirmDialog.asked).toEqual(["Replace 1 saved sprite: happy?"]);
    expect(uploads().map((body) => body.expression)).toEqual(NAMES);
    expect(hostEvents.spritesGenerated).toBe(1);
  });

  it("doesn't ask when no save name is taken, including full-body names on Expressions", async () => {
    await open({ savedSpriteNames: ["full_happy", "full_sad"] }, [sheetReply(), ...SIX_UPLOADS]);
    await generate();
    await click(button("Save 6 sprites"));
    await settle();
    expect(confirmDialog.asked).toEqual([]);
    expect(uploads().map((body) => body.expression)).toEqual(NAMES);
  });
});
