import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranceAfter, TranceScript } from "../../../../engine/contracts/types/trance";
import { TRANCE_STOP_LINE } from "../../../../engine/modes/trance/session";
import { TrancePlayer } from "./TrancePlayer";

// The voice hook is faked: tests see what was spoken and decide when a line has finished or failed.
const voice = vi.hoisted(() => ({
  active: false,
  error: null as string | null,
  spoken: [] as string[],
  ended: null as (() => void) | null,
  stops: 0,
}));
vi.mock("../hooks/use-trance-voice", () => ({
  useTranceVoice: ({ enabled }: { enabled: boolean }) => ({
    active: enabled && voice.active,
    error: voice.error,
    speak: (text: string, _upcoming: readonly string[], whenEnded?: () => void) => {
      voice.spoken.push(text);
      voice.ended = whenEnded ?? null;
    },
    stop: () => {
      voice.stops += 1;
    },
  }),
}));

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
    voice.active = false;
    voice.error = null;
    voice.spoken = [];
    voice.ended = null;
    voice.stops = 0;
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container.remove();
  });

  function render(
    onFinish: (after: TranceAfter) => void,
    playScript: TranceScript = script,
    extra: {
      voiceMode?: "off" | "read-along" | "eyes-closed";
      backdrop?: "drift" | "breathe" | "spiral" | "plain";
    } = {},
  ) {
    act(() => {
      root ??= createRoot(container);
      root.render(
        <TrancePlayer
          script={playScript}
          ending="wake"
          saving={false}
          saveError={null}
          onFinish={onFinish}
          characterId="jester"
          characterName="Jester"
          {...extra}
        />,
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

  it("reads each line aloud and, with eyes closed, moves on by itself after a pause", () => {
    vi.useFakeTimers();
    try {
      voice.active = true;
      render(vi.fn(), script, { voiceMode: "eyes-closed" });
      expect(voice.spoken).toEqual(["You're reading this."]);
      act(() => voice.ended?.());
      expect(line()).toBe("You're reading this.");
      act(() => vi.advanceTimersByTime(1500));
      expect(line()).toBe("Deeper now.");
      expect(voice.spoken.at(-1)).toBe("Deeper now.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads along without moving on by itself", () => {
    vi.useFakeTimers();
    try {
      voice.active = true;
      render(vi.fn(), script, { voiceMode: "read-along" });
      act(() => voice.ended?.());
      act(() => vi.advanceTimersByTime(5000));
      expect(line()).toBe("You're reading this.");
      next();
      expect(voice.spoken).toEqual(["You're reading this.", "Deeper now."]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("goes quiet while the way out is open and when muted", () => {
    voice.active = true;
    render(vi.fn(), script, { voiceMode: "read-along" });
    const stopsBefore = voice.stops;
    act(() => button(/I need out/).click());
    expect(voice.stops).toBeGreaterThan(stopsBefore);
    act(() => button(/Something's upsetting me/).click());
    expect(voice.spoken.at(-1)).toBe("You're safe.");
    const spokenBefore = voice.spoken.length;
    const stopsBeforeMute = voice.stops;
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Mute the voice"]')!.click());
    expect(voice.stops).toBeGreaterThan(stopsBeforeMute);
    // Focus goes back to the main button, so Space keeps moving on.
    expect(document.activeElement?.textContent).not.toBe("");
    expect(document.activeElement?.getAttribute("aria-label")).toBeNull();
    next();
    expect(voice.spoken.length).toBe(spokenBefore);
  });

  it("says when the voice stopped and leaves the reader in charge", () => {
    voice.active = true;
    voice.error = "quota exceeded";
    render(vi.fn(), script, { voiceMode: "eyes-closed" });
    expect(container.textContent).toContain("The voice stopped (quota exceeded)");
    expect(line()).toBe("You're reading this.");
  });

  it("draws the chosen backdrop behind the words", () => {
    render(vi.fn(), script, { backdrop: "spiral" });
    expect(container.querySelector('[data-backdrop="spiral"] svg path')).toBeTruthy();
    act(() => root?.unmount());
    root = null;
    render(vi.fn(), script, { backdrop: "drift" });
    expect(container.querySelectorAll(".trance-drift-cloud")).toHaveLength(3);
  });
});
