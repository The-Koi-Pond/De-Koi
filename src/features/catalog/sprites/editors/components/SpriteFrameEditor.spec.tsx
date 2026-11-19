import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SpriteFrameAdjustments } from "../../../../../shared/lib/sprite-frame-crop";
import { byRole, changeValue, click, mount, settle } from "../test-fixtures/editor-driver";
import { SpriteFrameEditor } from "./SpriteFrameEditor";

// The frame editor's behaviour with the shared crop helper replaced by a recorder: it answers with a label naming the
// picture and the frame. Real cropping is checked in Chromium by tests/e2e/sprite-editors-replay.spec.ts.

const crop = vi.hoisted(() => ({
  calls: [] as Array<{ url: string; frame: SpriteFrameAdjustments }>,
  fail: false,
}));
vi.mock("../../../../../shared/lib/sprite-frame-crop", () => ({
  cropSpriteDataUrl: async (url: string, frame: SpriteFrameAdjustments) => {
    crop.calls.push({ url, frame });
    if (crop.fail) throw new Error("tainted canvas");
    return `cropped:${url}:${frame.top}/${frame.bottom}/${frame.left}/${frame.right}`;
  },
}));
/** The discard question: answered at once, or held open (`"hold"`) until it is dismissed. */
const confirm = vi.hoisted(() => ({
  answer: true as boolean | "hold",
  asked: [] as string[],
  dismissed: 0,
  release: null as ((answer: boolean) => void) | null,
}));
vi.mock("../../../../../shared/lib/app-dialogs", () => ({
  showConfirmDialog: async (options: { message: string }) => {
    confirm.asked.push(options.message);
    if (confirm.answer !== "hold") return confirm.answer;
    return new Promise<boolean>((resolve) => {
      confirm.release = resolve;
    });
  },
  dismissActiveDialog: () => {
    confirm.dismissed += 1;
    confirm.release?.(false);
    confirm.release = null;
  },
}));

const HAPPY = "http://runtime/api/assets/sprite/character/c1/happy.png?v=1";
const SAD = "http://runtime/api/assets/sprite/character/c1/sad.jpg?v=1";

const events = { applied: [] as string[], closed: 0 };
let applyResult: () => Promise<void> = async () => {};
let mounted: Awaited<ReturnType<typeof mount>> | null = null;

function frameEditor(props: { imageUrl?: string; label?: string; applying?: boolean } = {}) {
  return (
    <SpriteFrameEditor
      imageUrl={props.imageUrl ?? HAPPY}
      label={props.label ?? "happy"}
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

const panel = () => byRole("region");
const slider = (name: string) => byRole<HTMLInputElement>("slider", name, panel());
const button = (name: string) => byRole<HTMLButtonElement>("button", name, panel());
const values = () => ["Top", "Bottom", "Left", "Right"].map((name) => slider(name).value);
const preview = () => panel().querySelector("img")!;
const errorLine = () => byRole("alert", undefined, panel()).textContent;

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
  crop.calls = [];
  crop.fail = false;
  confirm.answer = true;
  confirm.asked = [];
  confirm.dismissed = 0;
  confirm.release = null;
  events.applied = [];
  events.closed = 0;
  applyResult = async () => {};
});

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

describe("the frame editor", () => {
  it("shows four sliders at 0 and a cropped preview named after the sprite", async () => {
    mounted = await mount(frameEditor());
    expect(byRole("heading", undefined, panel()).textContent).toBe("Frame happy");
    expect(values()).toEqual(["0", "0", "0", "0"]);
    expect(slider("Top").getAttribute("aria-valuetext")).toBe("0.0%");
    expect([slider("Top").max, slider("Top").step]).toEqual(["80", "0.5"]);
    expect(preview().alt).toBe("Framed preview of happy");
    expect(preview().getAttribute("src")).toBe(`cropped:${HAPPY}:0/0/0/0`);
  });

  it("keeps each edge at 80 or less and a pair at 90 or less", async () => {
    mounted = await mount(frameEditor());
    await changeValue(slider("Top"), "10");
    await changeValue(slider("Left"), "80");
    await changeValue(slider("Right"), "20");
    await changeValue(slider("Bottom"), "5");
    expect(values()).toEqual(["10", "5", "70", "20"]);
    await settle();
    expect(preview().getAttribute("src")).toBe(`cropped:${HAPPY}:10/5/70/20`);
  });

  it("Apply frame crops the file with the shown values and hands the crop over", async () => {
    mounted = await mount(frameEditor());
    await changeValue(slider("Top"), "12.5");
    crop.calls = [];
    await click(button("Apply frame"));
    expect(crop.calls).toEqual([{ url: HAPPY, frame: { top: 12.5, bottom: 0, left: 0, right: 0 } }]);
    expect(events.applied).toEqual([`cropped:${HAPPY}:12.5/0/0/0`]);
  });

  it("keeps Apply frame off until an edge is above 0, so it never saves an unchanged copy (decision 6)", async () => {
    mounted = await mount(frameEditor());
    expect(button("Apply frame").disabled).toBe(true);
    await changeValue(slider("Left"), "0.5");
    expect(button("Apply frame").disabled).toBe(false);
    await click(button("Reset"));
    expect(values()).toEqual(["0", "0", "0", "0"]);
    expect(button("Apply frame").disabled).toBe(true);
    await click(button("Apply frame"));
    expect(events.applied).toEqual([]);
  });

  it("notes that a GIF comes back as a still picture, and only for GIFs", async () => {
    mounted = await mount(frameEditor());
    expect(panel().textContent).not.toContain("still picture");
    await mounted.render(
      <SpriteFrameEditor
        imageUrl={HAPPY.replace(".png", ".gif")}
        label="happy"
        filename="Happy.GIF"
        applying={false}
        onApply={() => {}}
        onClose={() => {}}
      />,
    );
    expect(panel().textContent).toContain("Saving turns this GIF into a still picture.");
  });

  it("shows the uncropped picture and says so when the preview can't be made; Apply says it failed", async () => {
    crop.fail = true;
    mounted = await mount(frameEditor());
    await changeValue(slider("Top"), "10");
    await settle();
    expect(preview().getAttribute("src")).toBe(HAPPY);
    expect(errorLine()).toBe("Couldn't show the framed preview.");

    crop.fail = false;
    await changeValue(slider("Top"), "20");
    await settle();
    expect(errorLine()).toBe("");
    expect(preview().getAttribute("src")).toBe(`cropped:${HAPPY}:20/0/0/0`);

    crop.fail = true;
    await click(button("Apply frame"));
    expect(errorLine()).toBe("Couldn't frame sprite. Try again.");
    expect(events.applied).toEqual([]);
  });

  it("says Couldn't frame sprite when the save itself rejects", async () => {
    applyResult = async () => {
      throw new Error("disk full");
    };
    mounted = await mount(frameEditor());
    await changeValue(slider("Top"), "10");
    await click(button("Apply frame"));
    expect(errorLine()).toBe("Couldn't frame sprite. Try again.");
  });

  it("locks the sliders, Reset and Apply while the tab saves, but not close (decision 8)", async () => {
    mounted = await mount(frameEditor());
    await changeValue(slider("Top"), "10");
    await mounted.render(frameEditor({ applying: true }));
    expect(["Top", "Bottom", "Left", "Right"].map((name) => slider(name).disabled)).toEqual([true, true, true, true]);
    expect([button("Reset").disabled, button("Apply frame").disabled]).toEqual([true, true]);
    expect(button("Close frame editor").disabled).toBe(false);
    expect(button("Apply frame").querySelector(".animate-spin")).not.toBeNull();
  });

  it("starts over when opened for another sprite and moves focus to its heading (decision 7)", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    mounted = await mount(frameEditor());
    expect(document.activeElement).toBe(byRole("heading", undefined, panel()));
    await changeValue(slider("Top"), "20");

    const secondOpener = document.createElement("button");
    document.body.appendChild(secondOpener);
    secondOpener.focus();
    await mounted.render(frameEditor({ imageUrl: SAD, label: "sad" }));
    expect(byRole("heading", undefined, panel()).textContent).toBe("Frame sad");
    expect(values()).toEqual(["0", "0", "0", "0"]);
    expect(document.activeElement).toBe(byRole("heading", undefined, panel()));

    await mounted.unmount();
    mounted = null;
    expect(document.activeElement).toBe(secondOpener);
    opener.remove();
    secondOpener.remove();
  });

  it("asks before closing with a frame set (decision 3), and closes at once without one", async () => {
    mounted = await mount(frameEditor());
    await click(button("Close frame editor"));
    expect([confirm.asked, events.closed]).toEqual([[], 1]);

    await changeValue(slider("Left"), "5");
    confirm.answer = false;
    await click(button("Close frame editor"));
    expect([confirm.asked, events.closed]).toEqual([["Discard your changes to happy?"], 1]);
    confirm.answer = true;
    await click(button("Close frame editor"));
    expect(events.closed).toBe(2);
    expect(button("Close frame editor").title).toBe("Close frame editor");
  });

  it("drops the discard question when a running save finishes and the tab closes the panel", async () => {
    mounted = await mount(frameEditor());
    await changeValue(slider("Top"), "10");
    await mounted.render(frameEditor({ applying: true }));
    confirm.answer = "hold";
    await click(button("Close frame editor"));
    expect(confirm.asked).toEqual(["Discard your changes to happy?"]);
    await mounted.unmount();
    mounted = null;
    expect(confirm.dismissed).toBe(1);
    expect(events.closed).toBe(0);
  });
});
