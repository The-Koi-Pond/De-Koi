import { describe, expect, it, vi } from "vitest";
import { getOrCreateCachedTTSAudioBlob } from "./tts-audio-cache";

/** A voice request that settles when the test says so, and remembers the signal it was made with. */
function voiceRequest() {
  let resolve!: (blob: Blob) => void;
  let signal: AbortSignal | null = null;
  const create = vi.fn((requestSignal: AbortSignal) => {
    signal = requestSignal;
    return new Promise<Blob>((done, fail) => {
      resolve = done;
      requestSignal.addEventListener("abort", () => fail(new DOMException("aborted", "AbortError")), { once: true });
    });
  });
  return { create, resolve: (blob: Blob) => resolve(blob), signal: () => signal };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const outcome = (promise: Promise<Blob>) =>
  promise.then(
    (blob) => `audio:${blob.size}`,
    (error: unknown) => (error as Error).name,
  );

describe("getOrCreateCachedTTSAudioBlob", () => {
  it("a caller that gives up stops only its own wait; the other caller of the same line still gets it", async () => {
    const call = new AbortController();
    const request = voiceRequest();
    // A call's reply asks for the line first; a read-aloud of the same text joins it through the text alias.
    const callLine = outcome(getOrCreateCachedTTSAudioBlob("call:1", request.create, ["text:hello"], call.signal));
    await tick();
    const readAloud = outcome(getOrCreateCachedTTSAudioBlob("msg:1", vi.fn(), ["text:hello"], undefined));
    await tick();

    call.abort();
    expect(await callLine).toBe("AbortError");
    expect(request.signal()?.aborted).toBe(false); // someone still wants it

    request.resolve(new Blob(["voice"]));
    expect(await readAloud).toBe("audio:5");
    expect(request.create).toHaveBeenCalledTimes(1);
  });

  it("cancels the request once every caller has given up, and the next caller starts a new one", async () => {
    const first = new AbortController();
    const second = new AbortController();
    const request = voiceRequest();
    const firstLine = outcome(getOrCreateCachedTTSAudioBlob("turn:1", request.create, ["text:bye"], first.signal));
    await tick();
    const secondLine = outcome(getOrCreateCachedTTSAudioBlob("turn:2", vi.fn(), ["text:bye"], second.signal));
    await tick();

    second.abort();
    expect(await secondLine).toBe("AbortError");
    expect(request.signal()?.aborted).toBe(false);
    first.abort();
    expect(await firstLine).toBe("AbortError");
    expect(request.signal()?.aborted).toBe(true);

    const retry = voiceRequest();
    const again = outcome(getOrCreateCachedTTSAudioBlob("turn:3", retry.create, ["text:bye"]));
    await tick();
    retry.resolve(new Blob(["new"]));
    expect(await again).toBe("audio:3");
    expect(retry.create).toHaveBeenCalledTimes(1);
  });
});
