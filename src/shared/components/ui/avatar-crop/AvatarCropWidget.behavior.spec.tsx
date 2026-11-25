import { act, Profiler } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { mountScenario, setPictureState, type Replay } from "./avatar-crop-replay-harness";
import { AvatarCropWidget } from "./index";

// Spec "Getting ready": a src change forgets everything about the earlier picture. Going back to an earlier src
// (A, then B, then A) needs A to get ready again, with the unclamped-then-follow steps.

const A = "https://img.test/a.png";
const B = "https://img.test/b.png";
const CENTERED = { srcX: 0.25, srcY: 0.25, srcWidth: 0.5, srcHeight: 0.5 };
const HIDDEN_FRAME = { width: "360px", height: "360px", visibility: "hidden" };
const A_FRAME = { width: "240px", height: "360px", visibility: "visible" };

let replays: Replay[] = [];

async function mount(crop: unknown, handsBack: boolean) {
  const replay = await mountScenario({
    images: { [A]: { state: "loaded", w: 800, h: 1200 }, [B]: { state: "pending", w: 300, h: 600 } },
    props: { src: A, alt: "Ava", crop },
    handsBack,
  });
  replays.push(replay);
  return replay;
}

afterEach(async () => {
  for (const replay of replays.reverse()) await replay.dispose();
  replays = [];
});

/** Switches to B (pending), checks nothing works there, then back to A made pending again. */
async function visitPendingBThenPendingA(widget: Replay) {
  const onB = await widget.run({ do: "props", src: B });
  expect(onB.shown.frame).toEqual(HIDDEN_FRAME);
  expect(onB.shown.box).toBeNull();
  expect(onB.shown.preview).toEqual({});

  const reset = await widget.run({ do: "click", name: "Reset" });
  const move = await widget.run({ do: "move", x: 150, y: 150 });
  expect([...reset.calls, ...move.calls]).toEqual([]);

  setPictureState(A, "pending", 800, 1200);
  const backOnA = await widget.run({ do: "props", src: A });
  expect(backOnA.shown.frame).toEqual(HIDDEN_FRAME);
  expect(backOnA.shown.box).toBeNull();
  const resetOnA = await widget.run({ do: "click", name: "Reset" });
  const moveOnA = await widget.run({ do: "move", x: 160, y: 160 });
  expect([...resetOnA.calls, ...moveOnA.calls]).toEqual([]);
  expect(moveOnA.shown.box).toBeNull();
}

describe("A -> B -> A: going back to an earlier picture needs it to get ready again", () => {
  it("forgets the dragged square when the caller doesn't hand back", async () => {
    const widget = await mount(null, false);
    await widget.run({ do: "down", on: "box", x: 100, y: 100 });
    const drag = await widget.run({ do: "move", x: 100, y: 140 });
    expect(drag.shown.box).toMatchObject({ top: "100px" });
    await widget.run({ do: "up" });

    await visitPendingBThenPendingA(widget);

    const loaded = await widget.run({ do: "load", src: A });
    expect(loaded.calls).toEqual([]);
    expect(loaded.shown.frame).toEqual(A_FRAME);
    // The crop prop is still null: the default square, not the dragged one.
    expect(loaded.shown.box).toEqual({ left: "0px", top: "60px", width: "240px", height: "240px", corners: 4 });
  });

  it("shows the handed-back crop again when the caller hands back", async () => {
    const widget = await mount(null, true);
    await widget.run({ do: "down", on: "box", x: 100, y: 100 });
    await widget.run({ do: "move", x: 100, y: 140 });
    await widget.run({ do: "up" });

    await visitPendingBThenPendingA(widget);

    const loaded = await widget.run({ do: "load", src: A });
    expect(loaded.calls).toEqual([]);
    expect(loaded.shown.box).toEqual({ left: "0px", top: "100px", width: "240px", height: "240px", corners: 4 });
  });

  it("mid-drag, shows the unclamped square from the crop prop given while on B, then follows only on the next change", async () => {
    const widget = await mount(CENTERED, false);
    await widget.run({ do: "down", on: "box", x: 100, y: 100 });
    const before = await widget.run({ do: "move", x: 110, y: 120 });
    expect(before.shown.box).toMatchObject({ left: "70px", top: "110px" });

    const outOfRange = { srcX: 0.9, srcY: 0.95, srcWidth: 0.5, srcHeight: 0.5 };
    await widget.run({ do: "props", src: B });
    const cropOnB = await widget.run({ do: "props", crop: outOfRange });
    expect(cropOnB.shown.box).toBeNull();
    setPictureState(A, "pending", 800, 1200);
    const backOnA = await widget.run({ do: "props", src: A });
    expect(backOnA.shown.box).toBeNull();
    const moveOnA = await widget.run({ do: "move", x: 120, y: 120 });
    expect(moveOnA.calls).toEqual([]);

    // Getting ready mid-drag: the unclamped square (0.9 * 240, 0.95 * 360, 0.5 * 240) stays.
    const loaded = await widget.run({ do: "load", src: A });
    expect(loaded.calls).toEqual([]);
    expect(loaded.shown.box).toEqual({ left: "216px", top: "342px", width: "120px", height: "120px", corners: 4 });

    // The drag carries on from its old start square (60, 90, 120).
    const move = await widget.run({ do: "moveOn", on: "box", x: 130, y: 100 });
    expect(move.calls).toEqual([{ srcX: 0.375, srcY: 0.25, srcWidth: 0.5, srcHeight: 0.3333333333333333 }]);
    await widget.run({ do: "up" });

    // Only the next crop change is followed (clamped).
    const next = await widget.run({ do: "props", crop: { ...outOfRange } });
    expect(next.calls).toEqual([]);
    expect(next.shown.box).toEqual({ left: "120px", top: "240px", width: "120px", height: "120px", corners: 4 });
  });
});

describe("a src change is followed by one more render with the previous picture's state", () => {
  it("commits the new picture under the old frame, square and preview, then becomes not ready", async () => {
    setPictureState(A, "loaded", 800, 1200);
    setPictureState(B, "pending");
    const commits: Array<{ src: string | null; frame: string; box: boolean; preview: string }> = [];
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const onRender = () => {
      const stageImage = host.querySelector("img");
      const preview = host.querySelectorAll("img")[1] as HTMLImageElement | undefined;
      commits.push({
        src: stageImage?.getAttribute("src") ?? null,
        frame: `${stageImage?.parentElement?.style.width} ${stageImage?.parentElement?.style.visibility}`,
        box: !!host.querySelector('[data-crop="box"]'),
        preview: preview?.style.height ?? "",
      });
    };
    const render = (src: string) =>
      act(async () =>
        root.render(
          <Profiler id="crop" onRender={onRender}>
            <AvatarCropWidget src={src} alt="Ava" crop={null} onChange={() => {}} />
          </Profiler>,
        ),
      );
    try {
      await render(A);
      commits.length = 0;
      await render(B);
      expect(commits).toEqual([
        { src: B, frame: "240px visible", box: true, preview: "150%" },
        { src: B, frame: "360px hidden", box: false, preview: "" },
      ]);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
