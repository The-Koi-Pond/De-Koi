import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranceAfter, TranceScript } from "../../../../engine/contracts/types/trance";
import { TRANCE_STOP_LINE } from "../../../../engine/modes/trance/session";
import { TrancePlayer } from "./TrancePlayer";

// The voice hook is faked: tests see what was spoken and decide when a line has finished or failed. Like the real
// hook, speak and stop keep the same identity across renders.
const voice = vi.hoisted(() => {
  const state = {
    active: false,
    error: null as string | null,
    spoken: [] as string[],
    ended: null as (() => void) | null,
    stops: 0,
    speak: (text: string, _upcoming: readonly string[], whenEnded?: () => void) => {
      state.spoken.push(text);
      state.ended = whenEnded ?? null;
    },
    stop: () => {
      state.stops += 1;
    },
  };
  return state;
});
vi.mock("../hooks/use-trance-voice", () => ({
  useTranceVoice: ({ enabled }: { enabled: boolean }) => ({
    active: enabled && voice.active,
    error: voice.error,
    speak: voice.speak,
    stop: voice.stop,
  }),
}));

const ambience = vi.hoisted(() => ({ calls: [] as { soundscape: string | null; volume: number; mode: string }[] }));
vi.mock("../hooks/use-trance-ambience", () => ({
  useTranceAmbience: (args: { soundscape: string | null; volume: number; mode: string }) => {
    ambience.calls.push(args);
    return { waitingForTap: false };
  },
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
    ambience.calls = [];
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
      pace?: "press" | "auto";
      buttonWords?: "quiet" | "affirming";
      ambience?: "auto" | "rain" | "ocean" | "wind" | "chimes" | "pad" | "binaural" | "off";
      ambienceVolume?: number;
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

  it("uses quiet button words unless affirming ones are picked", () => {
    const mainButton = () => container.querySelectorAll<HTMLButtonElement>("div.flex.justify-center button")[0]!;
    render(vi.fn());
    expect(["Go on", "Okay", "Next"]).toContain(mainButton().textContent);
    next();
    expect(["Go on", "Okay", "Next"]).toContain(mainButton().textContent);
    act(() => root?.unmount());
    root = null;
    render(vi.fn(), script, { buttonWords: "affirming" });
    expect(["Yes", "Yes...", "Mmmm...", "So nice", "Feels nice"]).toContain(mainButton().textContent);
  });

  it("moves on by itself without a voice, timed by the line, and pauses on request", () => {
    vi.useFakeTimers();
    try {
      render(vi.fn(), script, { pace: "auto" });
      // "You're reading this." = 3 words: 1200 + 3 x 350 reading, then the induction pause of 1400.
      act(() => vi.advanceTimersByTime(3600));
      expect(line()).toBe("You're reading this.");
      act(() => vi.advanceTimersByTime(100));
      expect(line()).toBe("Deeper now.");
      act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Pause"]')!.click());
      act(() => vi.advanceTimersByTime(20000));
      expect(line()).toBe("Deeper now.");
      act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Carry on by itself"]')!.click());
      // "Deeper now." = 2 words: 1200 + 700, then the deepener pause of 1800.
      act(() => vi.advanceTimersByTime(3700));
      expect(line()).toBe("Ten. Wide awake.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("with eyes closed, a pause after a line ends holds it, and carrying on goes on after the pause", () => {
    vi.useFakeTimers();
    try {
      voice.active = true;
      render(vi.fn(), script, { voiceMode: "eyes-closed" });
      act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Pause"]')!.click());
      act(() => voice.ended?.());
      act(() => vi.advanceTimersByTime(10000));
      expect(line()).toBe("You're reading this.");
      act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Carry on by itself"]')!.click());
      act(() => vi.advanceTimersByTime(1400));
      expect(line()).toBe("Deeper now.");
      // Only one line moved on: the next one waits for its own speech to end.
      act(() => vi.advanceTimersByTime(10000));
      expect(line()).toBe("Deeper now.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("has no pause button when the reader presses to go on", () => {
    render(vi.fn());
    expect(container.querySelector('button[aria-label="Pause"]')).toBeNull();
  });

  it("dims the ways out after the start until the pointer comes near", () => {
    vi.useFakeTimers();
    try {
      render(vi.fn());
      const controls = () => container.querySelector<HTMLElement>('[data-testid="trance-controls"]')!;
      expect(controls().dataset.bright).toBe("true");
      act(() => vi.advanceTimersByTime(6000));
      expect(controls().dataset.bright).toBe("false");
      expect(controls().className).toContain("opacity-25");
      const rect = { left: 800, right: 900, top: 0, bottom: 60, width: 100, height: 60, x: 800, y: 0 };
      vi.spyOn(button(/I need out/), "getBoundingClientRect").mockReturnValue({
        ...rect,
        toJSON: () => rect,
      } as DOMRect);
      act(() => window.dispatchEvent(new MouseEvent("pointermove", { clientX: 300, clientY: 500 })));
      expect(controls().dataset.bright).toBe("false");
      act(() => window.dispatchEvent(new MouseEvent("pointermove", { clientX: 760, clientY: 100 })));
      expect(controls().dataset.bright).toBe("true");
      // Still there and still works while dim.
      act(() => window.dispatchEvent(new MouseEvent("pointermove", { clientX: 0, clientY: 900 })));
      act(() => button(/I need out/).click());
      expect(button(/Just stop/)).toBeTruthy();
      expect(controls().dataset.bright).toBe("true");
    } finally {
      vi.useRealTimers();
    }
  });

  it("draws the chosen backdrop behind the words", () => {
    render(vi.fn(), script, { backdrop: "spiral" });
    expect(container.querySelector('[data-backdrop="spiral"] svg path')).toBeTruthy();
    act(() => root?.unmount());
    root = null;
    render(vi.fn(), script, { backdrop: "drift" });
    expect(container.querySelectorAll(".trance-drift-cloud")).toHaveLength(3);
  });

  describe("keeping the screen on", () => {
    let held: { released: boolean }[];
    let requests: number;
    let refuse: boolean;
    const original = Object.getOwnPropertyDescriptor(navigator, "wakeLock");
    const secure = Object.getOwnPropertyDescriptor(window, "isSecureContext");
    const flush = () => act(async () => {});
    const holding = () => held.filter((lock) => !lock.released).length;

    beforeEach(() => {
      held = [];
      requests = 0;
      refuse = false;
      Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
      Object.defineProperty(navigator, "wakeLock", {
        configurable: true,
        value: {
          request: () => {
            requests += 1;
            if (refuse) return Promise.reject(new DOMException("Battery saver", "NotAllowedError"));
            const lock = {
              released: false,
              release: () => {
                lock.released = true;
                return Promise.resolve();
              },
            };
            held.push(lock);
            return Promise.resolve(lock);
          },
        },
      });
    });

    afterEach(() => {
      if (original) Object.defineProperty(navigator, "wakeLock", original);
      else delete (navigator as { wakeLock?: unknown }).wakeLock;
      if (secure) Object.defineProperty(window, "isSecureContext", secure);
      else delete (window as { isSecureContext?: unknown }).isSecureContext;
    });

    it("holds the screen on only while moving on by itself, and lets go when paused or finished", async () => {
      render(vi.fn(), script, { pace: "auto" });
      await flush();
      expect(holding()).toBe(1);
      act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Pause"]')!.click());
      await flush();
      expect(holding()).toBe(0);
      act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Carry on by itself"]')!.click());
      await flush();
      expect(holding()).toBe(1);
      next();
      next();
      next();
      await flush();
      expect(container.textContent).toContain("How do you feel now?");
      expect(holding()).toBe(0);
    });

    it("lets go on the dark sleep screen", async () => {
      act(() => {
        root ??= createRoot(container);
        root.render(
          <TrancePlayer
            script={script}
            ending="sleep"
            saving={false}
            saveError={null}
            onFinish={vi.fn()}
            pace="auto"
          />,
        );
      });
      await flush();
      expect(holding()).toBe(1);
      next();
      next();
      next();
      await flush();
      expect(button("I'm back")).toBeTruthy();
      expect(holding()).toBe(0);
    });

    it("takes it again when the page comes back, since the browser drops it while hidden", async () => {
      render(vi.fn(), script, { pace: "auto" });
      await flush();
      held[0]!.released = true;
      act(() => document.dispatchEvent(new Event("visibilitychange")));
      await flush();
      expect(requests).toBe(2);
      expect(holding()).toBe(1);
    });

    it("never asks when the reader presses to go on", async () => {
      render(vi.fn());
      await flush();
      expect(requests).toBe(0);
    });

    it("says so when the screen can't be kept on", async () => {
      refuse = true;
      render(vi.fn(), script, { pace: "auto" });
      await flush();
      expect(container.textContent).toContain("the device wouldn't keep it on");
      act(() => root?.unmount());
      root = null;
      Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
      render(vi.fn(), script, { pace: "auto" });
      await flush();
      expect(container.textContent).toContain("browsers only keep it on over https");
      expect(requests).toBe(1);
    });
  });

  describe("moving between lines", () => {
    let animations: { keyframes: Keyframe[]; onfinish: (() => void) | null; cancelled: boolean }[];
    const leaving = () => container.querySelector('[data-testid="trance-leaving-line"]');

    beforeEach(() => {
      animations = [];
      HTMLElement.prototype.animate = function (keyframes) {
        const animation = { keyframes: keyframes as Keyframe[], onfinish: null, cancelled: false, cancel() {} };
        animation.cancel = () => {
          animation.cancelled = true;
        };
        animations.push(animation);
        return animation as unknown as Animation;
      };
    });

    afterEach(() => {
      delete (HTMLElement.prototype as { animate?: unknown }).animate;
      delete (window as { matchMedia?: unknown }).matchMedia;
    });

    it("lets the finished line sink away instead of vanishing, then removes it", () => {
      render(vi.fn());
      expect(leaving()).toBeNull();
      next();
      expect(line()).toBe("Deeper now.");
      expect(leaving()?.textContent).toBe("You're reading this.");
      expect(leaving()?.closest('[aria-hidden="true"]')).toBeTruthy();
      const out = animations.find((animation) => JSON.stringify(animation.keyframes).includes("blur(4px)"))!;
      expect(out).toBeTruthy();
      act(() => out.onfinish?.());
      expect(leaving()).toBeNull();
      expect(line()).toBe("Deeper now.");
    });

    it("swaps lines straight away for people who asked for less motion", () => {
      window.matchMedia = ((query: string) => ({ matches: query.includes("reduce") })) as typeof window.matchMedia;
      render(vi.fn());
      next();
      expect(line()).toBe("Deeper now.");
      expect(leaving()).toBeNull();
      expect(animations).toHaveLength(0);
    });
  });

  describe("the sound underneath", () => {
    const rainy: TranceScript = {
      ...script,
      lines: [
        { phase: "induction", text: "Hear the rain on the window." },
        { phase: "deepener", text: "Every drop of rain takes you deeper." },
        { phase: "wake", text: "Ten. Wide awake." },
      ],
    };
    const latest = () => ambience.calls.at(-1)!;
    const soundButton = () =>
      container.querySelector<HTMLButtonElement>('button[aria-label$="sound: on"], button[aria-label$="sound: off"]');

    it("plays the sound the session talks about, named on a button so it can be found and turned off", () => {
      render(vi.fn(), rainy, { ambience: "auto", ambienceVolume: 0.3 });
      expect(latest()).toEqual({ soundscape: "rain", volume: 0.3, mode: "on" });
      expect(soundButton()?.textContent).toBe("Rain");
      act(() => soundButton()!.click());
      expect(latest().mode).toBe("off");
      expect(soundButton()?.getAttribute("aria-label")).toBe("Rain sound: off");
      act(() => soundButton()!.click());
      expect(latest().mode).toBe("on");
    });

    it("keeps playing through a way out but stops for Just stop and the after-check", () => {
      render(vi.fn(), rainy, { ambience: "pad" });
      act(() => button(/I need out/).click());
      act(() => button(/Wake me gently/).click());
      expect(latest()).toMatchObject({ soundscape: "pad", mode: "on" });
      act(() => button(/I need out/).click());
      act(() => button(/Just stop/).click());
      expect(latest().mode).toBe("off");
      next();
      expect(container.textContent).toContain("How do you feel now?");
      expect(latest().mode).toBe("off");
    });

    it("drifts away on the sleep screen", () => {
      act(() => {
        root ??= createRoot(container);
        root.render(
          <TrancePlayer
            script={rainy}
            ending="sleep"
            saving={false}
            saveError={null}
            onFinish={vi.fn()}
            ambience="ocean"
          />,
        );
      });
      next();
      next();
      next();
      expect(button("I'm back")).toBeTruthy();
      expect(latest()).toMatchObject({ soundscape: "ocean", mode: "sleep" });
    });

    it("plays nothing and shows no button when the sound is off", () => {
      render(vi.fn(), rainy, { ambience: "off" });
      expect(latest().soundscape).toBeNull();
      expect(soundButton()).toBeNull();
    });
  });
});
