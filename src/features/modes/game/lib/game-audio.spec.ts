// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const audioElements: AudioElementStub[] = [];

class AudioElementStub {
  currentTime = 0;
  muted = false;
  preload = "";
  src = "";
  volume = 1;

  load = vi.fn();
  pause = vi.fn();
  play = vi.fn(() => Promise.resolve());
  removeAttribute = vi.fn();

  constructor() {
    audioElements.push(this);
  }
}

function createAudioContextStub(initialState: AudioContextState = "running") {
  const context = {
    state: initialState,
    sampleRate: 48_000,
    destination: {},
    createBuffer: vi.fn(() => ({})),
    createBufferSource: vi.fn(() => ({
      connect: vi.fn(),
      start: vi.fn(),
    })),
    resume: vi.fn(function (this: { state: AudioContextState }) {
      this.state = "running";
      return Promise.resolve();
    }),
    suspend: vi.fn(function (this: { state: AudioContextState }) {
      this.state = "suspended";
      return Promise.resolve();
    }),
  };

  return context;
}

describe("game audio disposal", () => {
  beforeEach(() => {
    vi.resetModules();
    audioElements.length = 0;
    vi.stubGlobal("Audio", AudioElementStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not construct an AudioContext solely to dispose it", async () => {
    const AudioContextStub = vi.fn();
    vi.stubGlobal("AudioContext", AudioContextStub);
    const { audioManager } = await import("./game-audio");

    audioManager.dispose();

    expect(AudioContextStub).not.toHaveBeenCalled();
  });

  it("suspends an existing running AudioContext on disposal", async () => {
    const context = createAudioContextStub();
    const AudioContextStub = vi.fn(function () {
      return context;
    });
    vi.stubGlobal("AudioContext", AudioContextStub);
    const { audioManager } = await import("./game-audio");
    audioManager.unlock();

    audioManager.dispose();

    expect(context.suspend).toHaveBeenCalledOnce();
  });

  it("resumes and primes the same context through the next public unlock", async () => {
    const context = createAudioContextStub();
    const AudioContextStub = vi.fn(function () {
      return context;
    });
    vi.stubGlobal("AudioContext", AudioContextStub);
    const { audioManager } = await import("./game-audio");
    audioManager.unlock();
    audioManager.dispose();

    audioManager.unlock();

    expect(AudioContextStub).toHaveBeenCalledOnce();
    expect(context.resume).toHaveBeenCalledOnce();
    expect(context.createBufferSource).toHaveBeenCalledTimes(2);
  });

  it.each(["suspended", "closed"] as const)("does not redundantly suspend a %s context", async (state) => {
    const context = createAudioContextStub(state);
    const AudioContextStub = vi.fn(function () {
      return context;
    });
    vi.stubGlobal("AudioContext", AudioContextStub);
    const { audioManager } = await import("./game-audio");
    audioManager.unlock();
    context.state = state;

    audioManager.dispose();

    expect(context.suspend).not.toHaveBeenCalled();
  });

  it("contains suspend rejection after releasing existing audio resources", async () => {
    const context = createAudioContextStub();
    context.suspend.mockImplementation(() => Promise.reject(new Error("device unavailable")));
    vi.stubGlobal("AudioContext", vi.fn(function () {
      return context;
    }));
    const { audioManager } = await import("./game-audio");
    audioManager.unlock();

    expect(() => audioManager.dispose()).not.toThrow();
    await Promise.resolve();

    expect(audioElements.slice(0, 8).every((audio) => audio.pause.mock.calls.length === 1)).toBe(true);
  });
});
