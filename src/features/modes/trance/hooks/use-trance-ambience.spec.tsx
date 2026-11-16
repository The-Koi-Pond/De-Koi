import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranceSoundscape } from "../../../../shared/stores/ui/model";
import { useTranceAmbience, type TranceAmbienceMode } from "./use-trance-ambience";

const scape = vi.hoisted(() => ({ started: [] as string[], fills: 0, stops: 0 }));
vi.mock("../lib/trance-ambience", () => ({
  startSoundscape: (_context: unknown, kind: string) => {
    scape.started.push(kind);
    return {
      fill: () => {
        scape.fills += 1;
      },
      stop: () => {
        scape.stops += 1;
      },
    };
  },
}));

// Records every ramp on the master gain and every state change, like a real context but without sound.
class FakeContext extends EventTarget {
  static made: FakeContext[] = [];
  state: AudioContextState = "running";
  currentTime = 0;
  ramps: { level: number; at: number }[] = [];
  closed = false;
  destination = {};
  constructor() {
    super();
    FakeContext.made.push(this);
  }
  createGain() {
    const ramps = this.ramps;
    return {
      connect: () => undefined,
      gain: {
        value: 0,
        cancelScheduledValues: () => undefined,
        setValueAtTime: () => undefined,
        linearRampToValueAtTime: (level: number, at: number) => ramps.push({ level, at }),
      },
    };
  }
  setState(state: AudioContextState) {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
  resume() {
    this.setState("running");
    return Promise.resolve();
  }
  suspend() {
    this.setState("suspended");
    return Promise.resolve();
  }
  close() {
    this.closed = true;
    return Promise.resolve();
  }
}

function Probe(props: { soundscape: TranceSoundscape | null; volume: number; mode: TranceAmbienceMode }) {
  const { waitingForTap } = useTranceAmbience(props);
  return <span data-waiting={waitingForTap ? "yes" : "no"} />;
}

describe("useTranceAmbience", () => {
  let container: HTMLDivElement;
  let root: Root;
  const render = (props: { soundscape: TranceSoundscape | null; volume: number; mode: TranceAmbienceMode }) =>
    act(() => root.render(<Probe {...props} />));
  const context = () => FakeContext.made.at(-1)!;
  const lastRamp = () => context().ramps.at(-1)!;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeContext.made = [];
    scape.started = [];
    scape.fills = 0;
    scape.stops = 0;
    (window as unknown as { AudioContext: unknown }).AudioContext = FakeContext;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete (window as { AudioContext?: unknown }).AudioContext;
    vi.useRealTimers();
  });

  it("fades the chosen sound in over a few seconds and keeps it scheduled ahead", () => {
    render({ soundscape: "rain", volume: 0.5, mode: "on" });
    expect(scape.started).toEqual(["rain"]);
    // 0.5 on the slider is 0.5 squared x 0.6; the opening fade isn't cut short by the level update after it.
    expect(lastRamp()).toEqual({ level: 0.15, at: 4 });
    const fillsAtStart = scape.fills;
    act(() => vi.advanceTimersByTime(3000));
    expect(scape.fills).toBe(fillsAtStart + 3);
  });

  it("fades out when turned off, rests the device once silent, and comes back when turned on", () => {
    render({ soundscape: "pad", volume: 1, mode: "on" });
    render({ soundscape: "pad", volume: 1, mode: "off" });
    expect(lastRamp().level).toBe(0);
    act(() => vi.advanceTimersByTime(2800));
    expect(context().state).toBe("suspended");
    // Asleep on purpose: nothing asks for a tap.
    expect(container.querySelector("span")?.dataset.waiting).toBe("no");
    render({ soundscape: "pad", volume: 1, mode: "on" });
    expect(context().state).toBe("running");
    expect(lastRamp().level).toBeCloseTo(0.6);
  });

  it("drifts away slowly on the sleep screen", () => {
    render({ soundscape: "ocean", volume: 0.5, mode: "on" });
    render({ soundscape: "ocean", volume: 0.5, mode: "sleep" });
    expect(lastRamp()).toEqual({ level: 0, at: 180 });
    act(() => vi.advanceTimersByTime(60_000));
    expect(context().state).toBe("running");
    act(() => vi.advanceTimersByTime(121_000));
    expect(context().state).toBe("suspended");
  });

  it("waits for a tap when the browser holds sound back, then starts", () => {
    class HeldContext extends FakeContext {
      constructor() {
        super();
        this.state = "suspended";
      }
      resume() {
        return Promise.reject(new DOMException("No gesture yet", "NotAllowedError"));
      }
    }
    (window as unknown as { AudioContext: unknown }).AudioContext = HeldContext;
    render({ soundscape: "wind", volume: 0.5, mode: "on" });
    expect(container.querySelector("span")?.dataset.waiting).toBe("yes");
    act(() => context().setState("running"));
    expect(container.querySelector("span")?.dataset.waiting).toBe("no");
  });

  it("stops and closes the sound when the session ends or the sound changes", () => {
    render({ soundscape: "rain", volume: 0.5, mode: "on" });
    const rain = context();
    render({ soundscape: "chimes", volume: 0.5, mode: "on" });
    act(() => vi.advanceTimersByTime(600));
    expect(rain.closed).toBe(true);
    expect(scape.stops).toBe(1);
    expect(scape.started).toEqual(["rain", "chimes"]);
    render({ soundscape: null, volume: 0.5, mode: "on" });
    act(() => vi.advanceTimersByTime(600));
    expect(context().closed).toBe(true);
    expect(scape.stops).toBe(2);
  });
});
