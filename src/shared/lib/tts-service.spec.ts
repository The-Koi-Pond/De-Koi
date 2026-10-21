// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const speak = vi.fn<(input: { text: string; kind?: string }) => Promise<Blob>>();

vi.mock("../api/tts-api", () => ({ ttsApi: { speak: (input: { text: string; kind?: string }) => speak(input) } }));

const { ttsService } = await import("./tts-service");

class FakeAudio {
  static playing: FakeAudio[] = [];
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  playbackRate = 1;
  constructor(readonly src: string) {}
  play() {
    FakeAudio.playing.push(this);
    return Promise.resolve();
  }
  pause() {}
}

function deferred() {
  let resolve!: (blob: Blob) => void;
  const promise = new Promise<Blob>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flush() {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

describe("ttsService.speakSequence", () => {
  beforeEach(() => {
    FakeAudio.playing = [];
    speak.mockReset();
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:fake", revokeObjectURL: () => undefined });
  });

  afterEach(() => {
    ttsService.stop();
    vi.unstubAllGlobals();
  });

  it("fetches each part only when it is reached by default", async () => {
    speak.mockResolvedValue(new Blob(["a"]));
    void ttsService.speakSequence([{ text: "one" }, { text: "two" }, { text: "three" }], "seq");
    await flush();

    expect(FakeAudio.playing).toHaveLength(1);
    expect(speak.mock.calls.map(([input]) => input.text)).toEqual(["one"]);
  });

  it("fetches upcoming parts while the current part plays and reports each part as it starts", async () => {
    const pending = new Map<string, ReturnType<typeof deferred>>();
    speak.mockImplementation(({ text }) => {
      const next = deferred();
      pending.set(text, next);
      return next.promise;
    });
    const started: number[] = [];
    const done = ttsService.speakSequence(
      [{ text: "one" }, { text: "  " }, { text: "two" }, { text: "three" }],
      "seq",
      { lookahead: 1, onPartStart: (index) => started.push(index) },
    );

    await flush();
    expect([...pending.keys()]).toEqual(["one"]);
    pending.get("one")!.resolve(new Blob(["1"]));
    await flush();

    // "one" is playing, so "two" is already on its way, but not "three".
    expect(started).toEqual([0]);
    expect([...pending.keys()]).toEqual(["one", "two"]);

    pending.get("two")!.resolve(new Blob(["2"]));
    await flush();
    FakeAudio.playing[0]!.onended?.();
    await flush();

    // Indexes point into the original list, past the skipped blank part.
    expect(started).toEqual([0, 2]);
    expect([...pending.keys()]).toEqual(["one", "two", "three"]);

    pending.get("three")!.resolve(new Blob(["3"]));
    await flush();
    FakeAudio.playing[1]!.onended?.();
    await flush();
    FakeAudio.playing[2]!.onended?.();
    await done;

    expect(started).toEqual([0, 2, 3]);
    expect(speak).toHaveBeenCalledTimes(3);
    expect(ttsService.getState()).toBe("idle");
  });

  it("reports a failed prefetch when its part is reached, not before", async () => {
    speak.mockImplementation(({ text }) =>
      text === "two" ? Promise.reject(new Error("quota exceeded")) : Promise.resolve(new Blob(["a"])),
    );
    const started: number[] = [];
    const done = ttsService.speakSequence([{ text: "one" }, { text: "two" }], "seq", {
      lookahead: 1,
      throwOnError: true,
      onPartStart: (index) => started.push(index),
    });
    await flush();

    expect(started).toEqual([0]);
    expect(ttsService.getState()).toBe("playing");

    FakeAudio.playing[0]!.onended?.();
    await expect(done).rejects.toThrow("quota exceeded");
    expect(ttsService.getState()).toBe("error");
  });

  it("asks for sound effect parts as sounds and plays them at normal speed", async () => {
    speak.mockResolvedValue(new Blob(["a"]));
    void ttsService.speakSequence([{ text: "Rain on a window.", kind: "sound_effect" }], "seq", { playbackRate: 1.5 });
    await flush();

    expect(speak.mock.calls[0]![0]).toMatchObject({ text: "Rain on a window.", kind: "sound_effect" });
    expect(FakeAudio.playing[0]!.playbackRate).toBe(1);
  });

  it("keeps reading when a sound effect fails, reports it once, and skips the rest of the sounds", async () => {
    speak.mockImplementation(({ kind }) =>
      kind === "sound_effect" ? Promise.reject(new Error("missing_permissions")) : Promise.resolve(new Blob(["a"])),
    );
    const failures: string[] = [];
    const started: number[] = [];
    const done = ttsService.speakSequence(
      [
        { text: "Rain.", kind: "sound_effect" },
        { text: "Good evening." },
        { text: "A door.", kind: "sound_effect" },
        { text: "Come in." },
      ],
      "seq",
      {
        throwOnError: true,
        onPartStart: (index) => started.push(index),
        onSoundEffectsFailed: (error) => failures.push(error.message),
      },
    );
    await flush();
    await flush();
    FakeAudio.playing[0]!.onended?.();
    await flush();
    await flush();
    FakeAudio.playing[1]!.onended?.();
    await done;

    expect(failures).toEqual(["missing_permissions"]);
    expect(started).toEqual([1, 3]);
    expect(speak.mock.calls.filter(([input]) => input.kind === "sound_effect")).toHaveLength(1);
    expect(ttsService.getState()).toBe("idle");
  });

  it("still stops on a failed speech part", async () => {
    speak.mockRejectedValue(new Error("quota exceeded"));
    const failures: string[] = [];
    await expect(
      ttsService.speakSequence([{ text: "one" }], "seq", {
        throwOnError: true,
        onSoundEffectsFailed: (error) => failures.push(error.message),
      }),
    ).rejects.toThrow("quota exceeded");
    expect(failures).toEqual([]);
  });

  it("waits each part's pause before playing it, but never before the first part", async () => {
    vi.useFakeTimers();
    try {
      speak.mockResolvedValue(new Blob(["a"]));
      const started: number[] = [];
      void ttsService.speakSequence(
        [
          { text: "one", pauseBeforeMs: 900 },
          { text: "two", pauseBeforeMs: 700 },
        ],
        "seq",
        { onPartStart: (index) => started.push(index) },
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(started).toEqual([0]);

      FakeAudio.playing[0]!.onended?.();
      await vi.advanceTimersByTimeAsync(699);
      expect(started).toEqual([0]);
      expect(ttsService.getState()).toBe("playing");
      expect(speak.mock.calls.map(([input]) => input.text)).toEqual(["one", "two"]);

      await vi.advanceTimersByTimeAsync(1);
      expect(started).toEqual([0, 1]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops during a pause without playing the next part", async () => {
    vi.useFakeTimers();
    try {
      speak.mockResolvedValue(new Blob(["a"]));
      const done = ttsService.speakSequence([{ text: "one" }, { text: "two", pauseBeforeMs: 5000 }], "seq");
      await vi.advanceTimersByTimeAsync(0);
      FakeAudio.playing[0]!.onended?.();
      await vi.advanceTimersByTimeAsync(100);

      ttsService.stop();
      await vi.advanceTimersByTimeAsync(0);
      await done;
      expect(FakeAudio.playing).toHaveLength(1);
      expect(ttsService.getState()).toBe("idle");
    } finally {
      vi.useRealTimers();
    }
  });
});
