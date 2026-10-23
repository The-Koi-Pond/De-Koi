import { describe, expect, it } from "vitest";
import { StreamingSpeaker, completeSpeechEnd } from "./voice-call-streaming-speech";

describe("completeSpeechEnd", () => {
  it("ends after the last line break or sentence end", () => {
    expect(completeSpeechEnd("ready for what tho", 0)).toBe(0);
    expect(completeSpeechEnd("i was BORN ready.\n\nready for", 0)).toBe("i was BORN ready.\n\n".length);
    expect(completeSpeechEnd("R-R-READY?? kid i was", 0)).toBe("R-R-READY?? ".length);
    expect(completeSpeechEnd('"Hold still." *drip* more', 0)).toBe('"Hold still." '.length);
  });

  it("never cuts inside tags or effects", () => {
    expect(completeSpeechEnd("[react: wow. ok] hey", 0)).toBe(0);
    expect(completeSpeechEnd("{glitch:HAPPY. THANKSGIVING} kid", 0)).toBe(0);
    expect(completeSpeechEnd("[react: wow. ok] hey. more", 0)).toBe("[react: wow. ok] hey. ".length);
  });

  it("can stop at the first break so the opening piece is short", () => {
    expect(completeSpeechEnd("one. two. three\nfour", 0, true)).toBe("one. ".length);
    expect(completeSpeechEnd("\n\nhey kid. more", 0, true)).toBe("\n\nhey kid. ".length);
  });

  it("starts from where the last piece ended", () => {
    const text = "one. two. three";
    expect(completeSpeechEnd(text, "one. ".length)).toBe("one. two. ".length);
  });
});

function harness(prefetchAhead?: number) {
  const played: string[][] = [];
  const prefetched: string[] = [];
  let release: (() => void) | null = null;
  const controller = new AbortController();
  const speaker = new StreamingSpeaker<string>({
    signal: controller.signal,
    prefetchAhead,
    toRequests: (text) =>
      text
        .split(/\n+/)
        .map((part) => part.trim())
        .filter(Boolean),
    prefetch: (request) => prefetched.push(request),
    play: (requests) =>
      new Promise<void>((resolve) => {
        played.push(requests);
        release = resolve;
      }),
  });
  const finishPlaying = async () => {
    for (let guard = 0; guard < 20; guard += 1) {
      await Promise.resolve();
      if (release) {
        const done = release;
        release = null;
        done();
      }
    }
  };
  const releaseOne = async () => {
    for (let guard = 0; guard < 5 && !release; guard += 1) await Promise.resolve();
    const done = release;
    release = null;
    done?.();
    for (let guard = 0; guard < 5; guard += 1) await Promise.resolve();
  };
  return { speaker, played, prefetched, controller, finishPlaying, releaseOne };
}

describe("StreamingSpeaker", () => {
  it("speaks the first sentence while the rest is still streaming, then whole finished stretches", async () => {
    const { speaker, played, prefetched } = harness();
    speaker.push("i was BORN ");
    expect(speaker.started).toBe(false);
    speaker.push("i was BORN ready. well.\n\nready for");
    expect(speaker.started).toBe(true);
    expect(prefetched).toEqual(["i was BORN ready."]);
    await Promise.resolve();
    expect(played).toEqual([["i was BORN ready."]]);
    speaker.push("i was BORN ready. well.\n\nready for what tho.\n\nif");
    expect(prefetched).toEqual(["i was BORN ready.", "well.", "ready for what tho."]);
  });

  it("asks for the next piece's audio before the current one has finished playing", async () => {
    const { speaker, prefetched, played } = harness();
    speaker.push("one.\n");
    await Promise.resolve();
    speaker.push("one.\ntwo.\n");
    expect(prefetched).toEqual(["one.", "two."]);
    expect(played).toEqual([["one."]]);
  });

  it("plays pieces in order and finishes with the rest of the saved reply", async () => {
    const { speaker, played, finishPlaying } = harness();
    speaker.push("one.\ntw");
    const done = speaker.finish("one.\ntwo, the saved ending.");
    await finishPlaying();
    await done;
    expect(played).toEqual([["one."], ["two, the saved ending."]]);
  });

  it("speaks the whole saved reply when nothing streamed", async () => {
    const { speaker, played, finishPlaying } = harness();
    const done = speaker.finish("no stream here.\nsecond line");
    await finishPlaying();
    await done;
    expect(played).toEqual([["no stream here.", "second line"]]);
  });

  it("doesn't repeat what was said when the saved reply was tidied", async () => {
    const { speaker, played, finishPlaying } = harness();
    speaker.push("[react: 😂] haha kid.\n");
    const done = speaker.finish("haha kid.\nand then some");
    await finishPlaying();
    await done;
    expect(played).toEqual([["[react: 😂] haha kid."], ["and then some"]]);
  });

  it("stops queued pieces when the turn is cut off", async () => {
    const { speaker, played, controller, finishPlaying } = harness();
    speaker.push("one.\ntwo.\n");
    controller.abort();
    speaker.push("one.\ntwo.\nthree.\n");
    const done = speaker.finish("one.\ntwo.\nthree.\nfour.");
    await finishPlaying();
    await done;
    expect(played).toEqual([]);
  });

  it("with a limit, fetches audio only a couple of pieces ahead of the one playing", async () => {
    const { speaker, prefetched, releaseOne } = harness(2);
    let text = "";
    for (const line of ["one.", "two.", "three.", "four."]) {
      text += `${line}\n`;
      speaker.push(text);
    }
    expect(prefetched).toEqual(["one.", "two."]); // nothing playing yet: the first piece and the next
    await Promise.resolve();
    expect(prefetched).toEqual(["one.", "two.", "three."]); // "one." playing: two ahead, "four." waits
    await releaseOne();
    expect(prefetched).toEqual(["one.", "two.", "three.", "four."]);
  });

  it("holds the next piece while paused and plays it on resume", async () => {
    const { speaker, played, finishPlaying } = harness();
    speaker.pause();
    speaker.push("one.\n");
    await finishPlaying();
    expect(played).toEqual([]);
    speaker.resume();
    await finishPlaying();
    expect(played).toEqual([["one."]]);
  });

  it("a stop while paused drops what was waiting", async () => {
    const { speaker, played, controller, finishPlaying } = harness();
    speaker.pause();
    speaker.push("one.\ntwo.\n");
    const done = speaker.finish("one.\ntwo.");
    controller.abort();
    await finishPlaying();
    await done;
    expect(played).toEqual([]);
  });
});
