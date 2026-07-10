// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { loadUrlArrayBufferMock, resolveGameAssetFileUrlMock } = vi.hoisted(() => ({
  loadUrlArrayBufferMock: vi.fn(),
  resolveGameAssetFileUrlMock: vi.fn(),
}));

vi.mock("../../../../shared/api/local-file-api", () => ({
  resolveGameAssetFileUrl: resolveGameAssetFileUrlMock,
}));

vi.mock("../../../../shared/lib/url-blob", () => ({
  loadUrlArrayBuffer: loadUrlArrayBufferMock,
}));

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
      buffer: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
      onended: null,
      start: vi.fn(),
      stop: vi.fn(),
    })),
    createGain: vi.fn(() => ({
      connect: vi.fn(),
      context,
      disconnect: vi.fn(),
      gain: { setValueAtTime: vi.fn() },
    })),
    decodeAudioData: vi.fn(() => Promise.resolve({})),
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
    loadUrlArrayBufferMock.mockReset();
    loadUrlArrayBufferMock.mockResolvedValue(new ArrayBuffer(0));
    resolveGameAssetFileUrlMock.mockReset();
    resolveGameAssetFileUrlMock.mockResolvedValue("asset://default");
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
    context.suspend.mockImplementation(function (this: { state: AudioContextState }) {
      expect(audioElements.slice(0, 8).every((audio) => audio.pause.mock.calls.length === 1)).toBe(true);
      this.state = "suspended";
      return Promise.resolve();
    });
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

    await expect.poll(() => context.state).toBe("running");
    expect(AudioContextStub).toHaveBeenCalledOnce();
    expect(context.resume).toHaveBeenCalledOnce();
    expect(context.createBufferSource).toHaveBeenCalledTimes(2);
  });

  it("waits for pending suspension before resuming the same context", async () => {
    const context = createAudioContextStub();
    let resolveSuspend!: () => void;
    context.suspend.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSuspend = () => {
            context.state = "suspended";
            resolve();
          };
        }),
    );
    const AudioContextStub = vi.fn(function () {
      return context;
    });
    vi.stubGlobal("AudioContext", AudioContextStub);
    const { audioManager } = await import("./game-audio");
    audioManager.unlock();
    audioManager.dispose();

    audioManager.unlock();
    resolveSuspend();

    await expect.poll(() => context.state).toBe("running");
    expect(AudioContextStub).toHaveBeenCalledOnce();
    expect(context.resume).toHaveBeenCalledOnce();
  });

  it("does not resume an unlock invalidated while it waits for pending suspension", async () => {
    const context = createAudioContextStub();
    let resolveSuspend!: () => void;
    context.suspend.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSuspend = () => {
            context.state = "suspended";
            resolve();
          };
        }),
    );
    vi.stubGlobal("AudioContext", vi.fn(function () {
      return context;
    }));
    const { audioManager } = await import("./game-audio");
    audioManager.unlock();
    audioManager.dispose();
    audioManager.unlock();

    audioManager.dispose();
    resolveSuspend();
    for (let index = 0; index < 6; index++) await Promise.resolve();

    expect(context.state).toBe("suspended");
    expect(context.resume).not.toHaveBeenCalled();
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

  it("does not retain a document interaction listener after disposal", async () => {
    const AudioContextStub = vi.fn(function () {
      return createAudioContextStub();
    });
    vi.stubGlobal("AudioContext", AudioContextStub);
    const firstModule = await import("./game-audio");
    firstModule.audioManager.dispose();
    vi.resetModules();
    const secondModule = await import("./game-audio");

    document.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(AudioContextStub).toHaveBeenCalledOnce();
    secondModule.audioManager.dispose();
  });

  it("does not resume or play an SFX request whose asset resolves after disposal", async () => {
    let resolveAsset!: (url: string) => void;
    resolveGameAssetFileUrlMock.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveAsset = resolve;
      }),
    );
    const context = createAudioContextStub();
    vi.stubGlobal("AudioContext", vi.fn(function () {
      return context;
    }));
    const { audioManager } = await import("./game-audio");
    audioManager.unlock();
    audioManager.playSfx("custom:old-request");

    audioManager.dispose();
    resolveAsset("asset://old-request");
    for (let index = 0; index < 6; index++) await Promise.resolve();

    expect(context.resume).not.toHaveBeenCalled();
    expect(audioElements.slice(0, 8).every((audio) => audio.play.mock.calls.length === 0)).toBe(true);
  });

  it("allows a new post-disposal SFX request to resume and play", async () => {
    const context = createAudioContextStub();
    vi.stubGlobal("AudioContext", vi.fn(function () {
      return context;
    }));
    const { audioManager } = await import("./game-audio");
    audioManager.unlock();
    audioManager.dispose();

    audioManager.playSfx("custom:new-request");

    await expect.poll(() => audioElements[0]?.play.mock.calls.length).toBe(1);
    expect(context.resume).toHaveBeenCalledOnce();
  });

  it("re-suspends when a buffered one-shot resume settles after disposal", async () => {
    const context = createAudioContextStub();
    let resolveResume!: () => void;
    context.resume.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveResume = () => {
            context.state = "running";
            resolve();
          };
        }),
    );
    vi.stubGlobal("AudioContext", vi.fn(function () {
      return context;
    }));
    const { audioManager } = await import("./game-audio");
    audioManager.unlock();
    context.state = "suspended";
    const onStarted = vi.fn();
    const layer = audioManager.playOneShot("asset://old-buffered-request", { volume: 1, onStarted });
    await expect.poll(() => context.resume.mock.calls.length).toBe(1);

    audioManager.dispose();
    resolveResume();
    await layer.ready;

    expect(context.state).toBe("suspended");
    expect(onStarted).not.toHaveBeenCalled();
  });

  it("keeps a new same-tag ambient layer owned when the old generation resolves later", async () => {
    const context = createAudioContextStub();
    let resolveOldDecode!: (buffer: object) => void;
    context.decodeAudioData.mockImplementationOnce(
      () =>
        new Promise<object>((resolve) => {
          resolveOldDecode = resolve;
        }),
    );
    vi.stubGlobal("AudioContext", vi.fn(function () {
      return context;
    }));
    const { audioManager } = await import("./game-audio");
    audioManager.unlock();
    audioManager.playAmbient("ambient:same-tag");
    await expect.poll(() => context.decodeAudioData.mock.calls.length).toBe(1);

    audioManager.dispose();
    audioManager.playAmbient("ambient:same-tag");
    await expect.poll(() => context.createBufferSource.mock.calls.length).toBe(2);
    for (let index = 0; index < 3; index++) await Promise.resolve();

    resolveOldDecode({});
    for (let index = 0; index < 6; index++) await Promise.resolve();
    audioManager.dispose();

    const liveNewSource = context.createBufferSource.mock.results[1]!.value;
    expect(liveNewSource.stop).toHaveBeenCalledOnce();
  });
});
