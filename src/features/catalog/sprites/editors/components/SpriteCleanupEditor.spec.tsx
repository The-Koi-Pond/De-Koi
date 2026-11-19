import { inflateSync } from "node:zlib";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { brushRadius, stampBrush, strokeBrushLine } from "../lib/brush";
import { copyPicture, samePixels, type RgbaPicture } from "../lib/picture";
import { removeWandArea, DEFAULT_WAND_SETTINGS } from "../lib/wand";
import recorded from "../test-fixtures/pixel-cases.json";
import {
  allByRole,
  byLabel,
  byRole,
  changeValue,
  click,
  mount,
  pointer,
  pressKey,
  settle,
  stubLayout,
} from "../test-fixtures/editor-driver";
import { SpriteCleanupEditor } from "./SpriteCleanupEditor";

// The cleanup editor's behaviour with the canvas layer replaced: loading hands back picture A's RGBA, drawing and
// encoding are recorded. The pixel rules themselves are checked against the recordings in lib/pixel-cases.spec.ts and,
// with a real canvas, in tests/e2e/sprite-editors-replay.spec.ts.

const layer = vi.hoisted(() => ({
  pictures: new Map<string, RgbaPicture>(),
  failLoads: 0,
  pendingLoad: null as Promise<void> | null,
  drawn: [] as RgbaPicture[],
  encoded: [] as RgbaPicture[],
}));

vi.mock("../../../../../shared/lib/url-blob", () => ({
  loadUrlBlob: async (url: string) => {
    if (layer.pendingLoad) await layer.pendingLoad;
    if (layer.failLoads > 0) {
      layer.failLoads -= 1;
      throw new Error("load_url_binary failed");
    }
    return { url } as unknown as Blob;
  },
}));
vi.mock("../browser/picture-canvas", () => ({
  decodePicture: async (blob: { url: string }) => {
    const picture = layer.pictures.get(blob.url);
    if (!picture) throw new Error("Not a picture");
    return picture;
  },
  drawPicture: (_canvas: HTMLCanvasElement, picture: RgbaPicture) => layer.drawn.push(picture),
  pictureToPngDataUrl: (picture: RgbaPicture) => {
    layer.encoded.push(picture);
    return `data:image/png;base64,encoded-${layer.encoded.length}`;
  },
}));
const confirm = vi.hoisted(() => ({ answer: true, asked: [] as string[] }));
vi.mock("../../../../../shared/lib/app-dialogs", () => ({
  showConfirmDialog: async (options: { message: string }) => {
    confirm.asked.push(options.message);
    return confirm.answer;
  },
}));

const SPRITE_URL = "http://runtime/api/assets/sprite/character/c1/happy.png?v=1";
const A = (() => {
  const source = recorded.pictures.A;
  const data = new Uint8ClampedArray(inflateSync(Buffer.from(source.rgba, "base64")));
  return { width: source.width, height: source.height, data } satisfies RgbaPicture;
})();

const events = { applied: [] as string[], closed: 0 };
let applyResult: () => Promise<void> = async () => {};
let mounted: Awaited<ReturnType<typeof mount>> | null = null;

function editor(props: { applying?: boolean; imageUrl?: string } = {}) {
  return (
    <SpriteCleanupEditor
      imageUrl={props.imageUrl ?? SPRITE_URL}
      label="happy"
      applying={props.applying ?? false}
      onApply={(dataUrl) => {
        events.applied.push(dataUrl);
        return applyResult();
      }}
      onClose={() => {
        events.closed += 1;
      }}
    />
  );
}

async function open(props: Parameters<typeof editor>[0] = {}) {
  mounted = await mount(editor(props));
  return dialog();
}

const dialog = () => byRole("dialog");
const button = (name: string) => byRole<HTMLButtonElement>("button", name, dialog());
const slider = (name: string) => byRole<HTMLInputElement>("slider", name, dialog());
const statusText = () => byRole("status", undefined, dialog()).textContent;
const alertText = () => byRole("alert", undefined, dialog()).textContent;
const readout = () => byRole("status", undefined, dialog()).nextElementSibling?.textContent;
const canvas = () => byLabel("Wand cleanup canvas for happy", dialog());
const at = (x: number, y: number) => ({ x: x + 0.5, y: y + 0.5 });
const lastDrawn = () => layer.drawn.at(-1)!;

async function pressPixel(x: number, y: number, button = 0) {
  await pointer(canvas(), "pointermove", at(x, y));
  await pointer(canvas(), "pointerdown", at(x, y), button);
  await pointer(canvas(), "pointerup", at(x, y), button);
  await settle(1);
}

async function strokePixels(points: Array<[number, number]>) {
  const [first, ...rest] = points;
  await pointer(canvas(), "pointermove", at(...first));
  await pointer(canvas(), "pointerdown", at(...first));
  for (const point of rest) await pointer(canvas(), "pointermove", at(...point));
  await pointer(canvas(), "pointerup", at(...points.at(-1)!));
  await settle(1);
}

beforeEach(() => {
  stubLayout(A.width, A.height);
  layer.pictures = new Map([[SPRITE_URL, A]]);
  layer.failLoads = 0;
  layer.pendingLoad = null;
  layer.drawn = [];
  layer.encoded = [];
  confirm.answer = true;
  confirm.asked = [];
  events.applied = [];
  events.closed = 0;
  applyResult = async () => {};
});

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

describe("opening", () => {
  it("starts fresh: Wand, Dark, fitted, a hint for the tool, nothing to undo or save", async () => {
    await open();
    expect(dialog().querySelector("h2")?.textContent).toBe("Clean up happy");
    expect(button("Wand").getAttribute("aria-pressed")).toBe("true");
    expect(button("Dark").getAttribute("aria-pressed")).toBe("true");
    expect(button("Fit to view").textContent).toBe("100%");
    expect(statusText()).toBe("Click the background to remove it.");
    expect(readout()).toBe("Move over the sprite to sample pixels");
    for (const name of ["Undo", "Redo", "Reset", "Save changes"]) expect(button(name).disabled).toBe(true);
    expect(samePixels(lastDrawn(), A)).toBe(true);
  });

  it("disables everything but Cancel, the backgrounds and the close button while loading", async () => {
    let release = () => {};
    layer.pendingLoad = new Promise<void>((resolve) => {
      release = resolve;
    });
    await open();
    const enabled = allByRole("button", undefined, dialog())
      .filter((element) => !(element as HTMLButtonElement).disabled)
      .map((element) => element.getAttribute("aria-label") ?? element.textContent);
    expect(enabled).toEqual(["Close Clean up happy", "Dark", "Checkerboard", "Light", "Pink", "Cancel"]);
    expect(slider("Tolerance").disabled).toBe(true);
    release();
    await settle();
    expect(button("Wand").disabled).toBe(false);
  });

  it("says the picture couldn't load and offers Try again (decision 10)", async () => {
    layer.failLoads = 1;
    await open();
    expect(alertText()).toBe("Sprite image could not be loaded. Try again.");
    expect(button("Wand").disabled).toBe(true);
    await click(button("Try again"));
    expect(alertText()).toBe("");
    expect(statusText()).toBe("Click the background to remove it.");
    expect(button("Wand").disabled).toBe(false);
  });
});

describe("the wand", () => {
  it("removes the clicked background, says how much, and saves exactly that picture", async () => {
    await open();
    await pressPixel(6, 6);
    expect(statusText()).toBe("6,082 px removed with wand (55% softness, 12% feather) from rgba(240, 240, 240, 255)");
    expect(readout()).toBe("x 6, y 6 · rgba(240, 240, 240, 255)");
    const expected = removeWandArea(A, 6, 6, DEFAULT_WAND_SETTINGS).picture;
    expect(samePixels(lastDrawn(), expected)).toBe(true);

    await click(button("Save changes"));
    expect(events.applied).toEqual(["data:image/png;base64,encoded-1"]);
    expect(samePixels(layer.encoded[0], expected)).toBe(true);
  });

  it("uses Strong, Tolerance, Softness and Feather, and Defaults puts them back", async () => {
    await open();
    await click(byRole("checkbox", "Strong (reaches further)", dialog()));
    await changeValue(slider("Tolerance"), "80");
    await changeValue(slider("Softness"), "0");
    await changeValue(slider("Feather"), "0");
    await pressPixel(6, 6);
    expect(statusText()).toBe(
      "6,251 px removed with strong wand (0% softness, 0% feather) from rgba(240, 240, 240, 255)",
    );
    await click(button("Defaults"));
    expect(statusText()).toBe("Wand settings reset");
    expect([slider("Tolerance").value, slider("Softness").value, slider("Feather").value]).toEqual(["36", "55", "12"]);
    expect(byRole<HTMLInputElement>("checkbox", "Strong (reaches further)", dialog()).checked).toBe(false);
  });

  it("does nothing on a see-through pixel", async () => {
    await open();
    await pressPixel(3, 92);
    expect(statusText()).toBe("No opaque pixels selected");
    expect(readout()).toBe("x 3, y 92 · rgba(0, 0, 0, 0)");
    expect(button("Undo").disabled).toBe(true);
    expect(button("Save changes").disabled).toBe(true);
  });
});

describe("strokes", () => {
  it("counts each changed pixel once (decision 9) and is one undo step", async () => {
    await open();
    await click(button("Erase"));
    expect(statusText()).toBe("Drag to erase.");
    await changeValue(slider("Opacity"), "50");
    await changeValue(slider("Hardness"), "0");
    const points: Array<[number, number]> = [
      [10, 48],
      [18, 47],
      [26, 46],
      [31, 45],
      [39, 44],
      [46, 44],
    ];
    await strokePixels(points);

    const expected = copyPicture(A);
    const settings = { mode: "erase" as const, radius: brushRadius(18), hardness: 0, opacity: 50 };
    const strokeCanvas = { current: expected, original: A };
    let stamped = stampBrush(strokeCanvas, { x: 10, y: 48 }, settings);
    for (let index = 1; index < points.length; index += 1) {
      const [fromX, fromY] = points[index - 1];
      const [toX, toY] = points[index];
      stamped += strokeBrushLine(strokeCanvas, { x: fromX, y: fromY }, { x: toX, y: toY }, settings);
    }
    let distinct = 0;
    for (let index = 3; index < A.data.length; index += 4) if (expected.data[index] !== A.data[index]) distinct += 1;
    // The old status summed stamps (the recording showed "2,032 px erased"); this stroke changes fewer distinct pixels.
    expect(statusText()).toBe(`${distinct.toLocaleString()} px erased`);
    expect(distinct).toBeLessThan(stamped);
    expect(samePixels(lastDrawn(), expected)).toBe(true);
    // The readout shows the pixel as it was when the pointer reached it, before that move's stamps.
    expect(readout()).toBe("x 46, y 44 · rgba(200, 60, 90, 253)");

    await click(button("Undo"));
    expect(samePixels(lastDrawn(), A)).toBe(true);
    expect(button("Save changes").disabled).toBe(true);
  });

  it("says No pixels changed for a stroke that changes nothing", async () => {
    await open();
    await click(button("Erase"));
    await changeValue(slider("Opacity"), "0");
    await strokePixels([
      [10, 48],
      [20, 48],
    ]);
    expect(statusText()).toBe("No pixels changed");
    expect(button("Undo").disabled).toBe(true);
  });

  it("shows a hint per tool and mode", async () => {
    await open();
    const hints: string[] = [];
    for (const tool of ["Clean", "Brush", "Blur", "Pan"]) {
      await click(button(tool));
      hints.push(statusText() ?? "");
    }
    await click(button("Brush"));
    await click(button("Restore"));
    hints.push(statusText() ?? "");
    expect(hints).toEqual([
      "Drag over leftover background to clean it.",
      "Drag to paint.",
      "Drag along jagged edges to smooth them.",
      "Drag to move the view.",
      "Drag to bring back the original.",
    ]);
  });

  it("picks a brush colour from the picture, even a see-through one, and stops picking on a tool switch", async () => {
    await open();
    await click(button("Brush"));
    await click(button("Pick"));
    expect(statusText()).toBe("Click the sprite to pick a brush color");
    await pressPixel(48, 40);
    expect(statusText()).toBe("Brush color picked: rgba(200, 60, 90, 255)");
    expect(byLabel<HTMLInputElement>("Brush color", dialog()).value).toBe("#c83c5a");
    expect(button("Pick").getAttribute("aria-pressed")).toBe("false");
    expect(button("Undo").disabled).toBe(true);

    await click(button("Pick"));
    await pressPixel(3, 92);
    expect(statusText()).toBe("Brush color picked: rgba(0, 0, 0, 0)");
    expect(byLabel<HTMLInputElement>("Brush color", dialog()).value).toBe("#000000");

    await click(button("Pick"));
    await click(button("Pick"));
    expect(statusText()).toBe("Brush color picker canceled");
    await click(button("Pick"));
    await click(button("Erase"));
    await click(button("Brush"));
    expect(button("Pick").getAttribute("aria-pressed")).toBe("false");
  });

  it("pans with the middle button without editing", async () => {
    await open();
    await pointer(canvas(), "pointerdown", at(20, 20), 1);
    await pointer(canvas(), "pointerup", at(20, 20), 1);
    await settle(1);
    expect(statusText()).toBe("Panning");
    expect(button("Undo").disabled).toBe(true);
  });
});

describe("undo, redo and reset", () => {
  async function thirteenErasePresses() {
    await click(button("Erase"));
    await changeValue(slider("Brush"), "2");
    for (let press = 0; press < 13; press += 1) await pressPixel(8 + press * 6, 6);
  }

  it("keeps 12 steps, redoes by Ctrl+Y and Ctrl+Shift+Z, and Reset clears everything", async () => {
    await open();
    await thirteenErasePresses();
    expect(statusText()).toBe("5 px erased");
    const undoEnabled: boolean[] = [];
    for (let step = 0; step < 13; step += 1) {
      undoEnabled.push(!button("Undo").disabled);
      await click(button("Undo"));
    }
    expect(undoEnabled).toEqual([...Array(12).fill(true), false]);
    expect(statusText()).toBe("Undo applied");
    // Twelve undos leave the first press: still a change from the original.
    expect([button("Redo").disabled, button("Reset").disabled, button("Save changes").disabled]).toEqual([
      false,
      false,
      false,
    ]);

    expect((await pressKey("y", { ctrlKey: true })).defaultPrevented).toBe(true);
    await pressKey("y", { metaKey: true });
    await pressKey("z", { ctrlKey: true, shiftKey: true });
    expect(statusText()).toBe("Redo applied");
    await pressKey("z", { ctrlKey: true });
    expect(statusText()).toBe("Undo applied");

    await click(button("Reset"));
    expect(statusText()).toBe("Reset");
    for (const name of ["Undo", "Redo", "Reset", "Save changes"]) expect(button(name).disabled).toBe(true);
    expect(samePixels(lastDrawn(), A)).toBe(true);
  });

  it("knows the picture is unchanged after undoing back to the original, and a new change clears redo", async () => {
    await open();
    await pressPixel(6, 6);
    await click(button("Undo"));
    expect(button("Save changes").disabled).toBe(true);
    expect(button("Reset").disabled).toBe(true);
    await pressPixel(6, 6);
    expect(button("Redo").disabled).toBe(true);
  });

  it("leaves the keys alone while typing, with Alt, or with nothing to undo", async () => {
    await open();
    expect((await pressKey("z", { ctrlKey: true })).defaultPrevented).toBe(false);
    await pressPixel(6, 6);
    expect((await pressKey("z", { ctrlKey: true, altKey: true })).defaultPrevented).toBe(false);
    const textBox = document.createElement("input");
    document.body.appendChild(textBox);
    expect((await pressKey("z", { ctrlKey: true }, textBox)).defaultPrevented).toBe(false);
    textBox.remove();
    expect(button("Undo").disabled).toBe(false);
    // A slider is not a text box.
    expect((await pressKey("z", { ctrlKey: true }, slider("Tolerance"))).defaultPrevented).toBe(true);
    expect(button("Undo").disabled).toBe(true);
  });
});

describe("saving and closing", () => {
  it("locks the editor while the tab saves and shows Saving…", async () => {
    await open();
    await pressPixel(6, 6);
    await mounted!.render(editor({ applying: true }));
    expect(button("Saving…").disabled).toBe(true);
    for (const name of ["Wand", "Erase", "Undo", "Reset", "Cancel", "Defaults"])
      expect(button(name).disabled).toBe(true);
    expect(slider("Tolerance").disabled).toBe(true);
    expect((await pressKey("z", { ctrlKey: true })).defaultPrevented).toBe(false);
    await pressPixel(40, 40);
    expect(statusText()).toContain("6,082 px removed");
  });

  it("shows its own error when the save itself fails", async () => {
    applyResult = async () => {
      throw new Error("disk full");
    };
    await open();
    await pressPixel(6, 6);
    await click(button("Save changes"));
    expect(alertText()).toBe("Couldn't save sprite cleanup. Try again.");
    expect(dialog()).toBeTruthy();
  });

  it("asks before dropping changes (decision 3) and closes at once without them", async () => {
    await open();
    await click(button("Cancel"));
    expect(confirm.asked).toEqual([]);
    expect(events.closed).toBe(1);

    await pressPixel(6, 6);
    confirm.answer = false;
    await click(button("Cancel"));
    await pressKey("Escape", {}, document.body);
    expect(confirm.asked).toEqual(["Discard your changes to happy?", "Discard your changes to happy?"]);
    expect(events.closed).toBe(1);
    confirm.answer = true;
    await click(button("Close Clean up happy"));
    expect(events.closed).toBe(2);
    expect(events.applied).toEqual([]);
  });

  it("shows the original while Show original is held (decision 15)", async () => {
    await open();
    await pressPixel(6, 6);
    const edited = lastDrawn();
    await pointer(button("Show original"), "pointerdown", { x: 0, y: 0 });
    await settle(1);
    expect(samePixels(lastDrawn(), A)).toBe(true);
    await pointer(button("Show original"), "pointerup", { x: 0, y: 0 });
    await settle(1);
    expect(lastDrawn()).toBe(edited);
  });
});

describe("accessibility (decision 13) and the stage", () => {
  it("names sliders by their label, groups the backgrounds and describes the canvas", async () => {
    await open();
    expect(slider("Tolerance").getAttribute("aria-valuetext")).toBe("36");
    expect(byRole("group", "Preview background", dialog())).toBeTruthy();
    const description = document.getElementById(canvas().getAttribute("aria-describedby")!);
    expect(description?.textContent).toBe(
      "Click or drag on the picture with a mouse, pen or finger. Use Undo to step back.",
    );
    expect(byRole("status", undefined, dialog()).getAttribute("aria-live")).toBe("polite");
    expect(canvas().getAttribute("title")).toBe("Edit sprite transparency");
  });

  it("zooms by 1.25 per button and fits back to 100%", async () => {
    await open();
    const shown: string[] = [];
    for (const name of ["Zoom in", "Zoom in", "Zoom in", "Zoom out", "Fit to view"]) {
      await click(button(name));
      shown.push(button("Fit to view").textContent ?? "");
    }
    expect(shown).toEqual(["125%", "156%", "195%", "156%", "100%"]);
  });

  it("switches the preview background without changing the picture", async () => {
    await open();
    await click(button("Pink"));
    expect(button("Pink").getAttribute("aria-pressed")).toBe("true");
    expect(button("Dark").getAttribute("aria-pressed")).toBe("false");
    expect(button("Save changes").disabled).toBe(true);
  });
});
