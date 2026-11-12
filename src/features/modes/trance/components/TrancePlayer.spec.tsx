import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranceAfter, TranceScript } from "../../../../engine/contracts/types/trance";
import { TRANCE_STOP_LINE } from "../../../../engine/modes/trance/session";
import { TrancePlayer } from "./TrancePlayer";

const script: TranceScript = {
  lines: [
    { phase: "induction", text: "You're reading this." },
    { phase: "deepener", text: "Deeper now." },
    { phase: "wake", text: "Ten. Wide awake." },
  ],
  exits: { gentle: ["Coming up.", "Awake."], calm: ["You're safe.", "Back in the room."] },
  connectionId: "c",
  createdAt: "t",
};

describe("TrancePlayer", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container.remove();
  });

  function render(onFinish: (after: TranceAfter) => void, playScript: TranceScript = script) {
    act(() => {
      root ??= createRoot(container);
      root.render(
        <TrancePlayer script={playScript} ending="wake" saving={false} saveError={null} onFinish={onFinish} />,
      );
    });
  }
  const line = () => container.querySelector('p[aria-live="polite"]')?.textContent;
  const button = (name: string | RegExp) =>
    [...container.querySelectorAll("button")].find((b) =>
      typeof name === "string" ? b.textContent === name : name.test(b.textContent ?? ""),
    )!;
  const next = () =>
    act(() => container.querySelectorAll<HTMLButtonElement>("div.flex.justify-center button")[0]!.click());

  it("reads line by line to the end, then saves how it went", () => {
    const onFinish = vi.fn();
    render(onFinish);
    expect(line()).toBe("You're reading this.");
    next();
    expect(line()).toBe("Deeper now.");
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: " " })));
    expect(line()).toBe("Ten. Wide awake.");
    expect(button("I'm awake")).toBeTruthy();
    next();
    expect(container.textContent).toContain("How do you feel now?");
    act(() => button("7").click());
    act(() => button("Yes").click());
    act(() => button("Done").click());
    expect(onFinish).toHaveBeenCalledWith(
      expect.objectContaining({ finishedBy: "completed", rating: 7, fullyAwake: true }),
    );
  });

  it("leaves through a way out at any line", () => {
    const onFinish = vi.fn();
    render(onFinish);
    act(() => button(/I need out/).click());
    act(() => button(/Something's upsetting me/).click());
    expect(line()).toBe("You're safe.");
    next();
    next();
    act(() => button("Done").click());
    expect(onFinish).toHaveBeenCalledWith(expect.objectContaining({ finishedBy: "calm" }));
  });

  it("walks someone back up when they aren't fully awake", () => {
    const onFinish = vi.fn();
    render(onFinish);
    next();
    next();
    next();
    act(() => button(/Not quite/).click());
    expect(line()).toBe("Coming up.");
    next();
    next();
    act(() => button("Done").click());
    expect(onFinish).toHaveBeenCalledWith(expect.objectContaining({ finishedBy: "completed", fullyAwake: false }));
  });

  it("still has a way out when a saved script has no exit lines", () => {
    render(vi.fn(), { ...script, exits: { gentle: [], calm: [] } });
    act(() => button(/I need out/).click());
    act(() => button(/Wake me gently/).click());
    expect(line()).toBe(TRANCE_STOP_LINE);
  });
});
