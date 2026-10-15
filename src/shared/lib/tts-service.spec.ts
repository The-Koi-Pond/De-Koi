// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const speak = vi.fn<(input: { text: string }) => Promise<Blob>>();

vi.mock("../api/tts-api", () => ({ ttsApi: { speak: (input: { text: string }) => speak(input) } }));

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
});
