import { describe, expect, it, vi } from "vitest";
import type {
  VoiceListenOptions,
  VoiceMicrophone,
  VoiceReplyHandle,
  VoiceReplySpeaker,
  VoiceSessionPorts,
  VoiceSessionSetup,
} from "../../capabilities/voice";
import { soundsLikeReplyEcho, soundsLikeThinkingSound } from "./echo";
import { createVoiceSession, type VoiceSessionEvent } from "./voice-session";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

const settle = async () => {
  for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

const abortError = () => new DOMException("The operation was aborted.", "AbortError");

class FakeMic implements VoiceMicrophone<string> {
  listens: Array<{ options: VoiceListenOptions; resolve: (utterance: string | null) => void }> = [];
  closed = false;
  private endedListeners = new Set<() => void>();
  listen(options: VoiceListenOptions): Promise<string | null> {
    return new Promise((resolve, reject) => {
      this.listens.push({ options, resolve });
      options.signal.addEventListener("abort", () => reject(abortError()), { once: true });
    });
  }
  onEnded(listener: () => void) {
    this.endedListeners.add(listener);
    return () => this.endedListeners.delete(listener);
  }
  close() {
    this.closed = true;
  }
  unplug() {
    for (const listener of this.endedListeners) listener();
  }
  get current() {
    return this.listens.at(-1)!;
  }
}

class FakeSpeaker implements VoiceReplySpeaker {
  started = false;
  pushed: string[] = [];
  paused = false;
  stopped = false;
  audible = false;
  finishedWith: Array<string | null> = [];
  finishing = deferred<void>();
  /** What the session asked to hear about the reply's first sound. */
  firstSound: () => void = () => undefined;
  push(text: string) {
    this.pushed.push(text);
    if (/[.!?]/.test(text)) this.started = true;
  }
  finish(saved: string | null) {
    this.finishedWith.push(saved);
    if (saved) this.started = true;
    return this.finishing.promise;
  }
  pause = vi.fn(() => {
    this.paused = true;
  });
  resume = vi.fn(() => {
    this.paused = false;
  });
  stop = vi.fn(() => {
    this.stopped = true;
    this.finishing.resolve();
  });
  isAudible() {
    return this.audible;
  }
}

interface SentReply {
  text: string;
  onText: (text: string) => void;
  done: ReturnType<typeof deferred<string | null>>;
  cancelled: ReturnType<typeof deferred<void>>;
  cancel: ReturnType<typeof vi.fn>;
}

class FakeThinkingSound {
  playing = deferred<void>();
  constructor(readonly text: string) {}
  play = vi.fn(() => this.playing.promise);
  stop = vi.fn(() => this.playing.resolve());
}

function harness(
  options: {
    setup?: () => Promise<VoiceSessionSetup<string>>;
    voice?: boolean;
    thinkingSounds?: boolean;
    thinkingSoundDelayMs?: number;
  } = {},
) {
  const mics: FakeMic[] = [];
  const thinkingSounds: FakeThinkingSound[] = [];
  const opens: Array<ReturnType<typeof deferred<FakeMic>>> = [];
  const transcripts: Array<ReturnType<typeof deferred<string>>> = [];
  const replies: SentReply[] = [];
  const speakers: FakeSpeaker[] = [];
  const events: VoiceSessionEvent[] = [];
  let autoOpen = true;
  const ports: VoiceSessionPorts<string> = {
    setup:
      options.setup ??
      (async () => ({
        voiceReplies: options.voice !== false,
        input: {
          kind: "recorder",
          destination: "ElevenLabs",
          open: () => {
            const opening = deferred<FakeMic>();
            opens.push(opening);
            if (autoOpen) {
              const mic = new FakeMic();
              mics.push(mic);
              opening.resolve(mic);
            }
            return opening.promise;
          },
          transcribe: () => {
            const transcript = deferred<string>();
            transcripts.push(transcript);
            return transcript.promise;
          },
        },
      })),
    reply: {
      send: (text, onText): VoiceReplyHandle => {
        const done = deferred<string | null>();
        const cancelled = deferred<void>();
        const cancel = vi.fn(() => cancelled.promise);
        replies.push({ text, onText, done, cancelled, cancel });
        return { done: done.promise, cancel };
      },
    },
    speech: {
      begin: (_turnKey, onFirstSound) => {
        if (options.voice === false) return null;
        const speaker = new FakeSpeaker();
        speaker.firstSound = onFirstSound;
        speakers.push(speaker);
        return speaker;
      },
    },
  };
  if (options.thinkingSounds) {
    ports.speech.thinkingSound = () => {
      const sound = new FakeThinkingSound("Hmm...");
      thinkingSounds.push(sound);
      return sound;
    };
  }
  const session = createVoiceSession(ports, { thinkingSoundDelayMs: options.thinkingSoundDelayMs ?? 0 });
  session.onEvent((event) => events.push(event));
  return {
    session,
    mics,
    opens,
    transcripts,
    replies,
    speakers,
    events,
    thinkingSounds,
    holdOpen: () => {
      autoOpen = false;
    },
    snap: () => session.getSnapshot(),
  };
}

/** Says `words` into the open mic and lets them be transcribed. */
async function say(h: ReturnType<typeof harness>, words: string) {
  await settle();
  const mic = h.mics.at(-1)!;
  mic.current.options.onSpeechStart();
  mic.current.resolve(`audio:${words}`);
  await settle();
  h.transcripts.at(-1)!.resolve(words);
  await settle();
}

describe("voice session", () => {
  it("runs a turn: listening, transcribing, thinking, speaking, then listening again", async () => {
    const h = harness();
    h.session.start();
    await settle();
    expect(h.snap()).toMatchObject({
      phase: "listening",
      mic: "listening",
      destination: "ElevenLabs",
      bargeIn: "voice",
    });

    const mic = h.mics[0]!;
    mic.current.options.onSpeechStart();
    mic.current.resolve("audio");
    await settle();
    expect(h.snap()).toMatchObject({ phase: "transcribing", mic: "sending" });

    h.transcripts[0]!.resolve(" hey Freddy ");
    await settle();
    expect(h.replies.map((reply) => reply.text)).toEqual(["hey Freddy"]);
    expect(h.snap()).toMatchObject({ phase: "thinking", heard: "hey Freddy", mic: "listening" });

    h.replies[0]!.onText("Hey kid.");
    expect(h.speakers[0]!.pushed).toEqual(["Hey kid."]);
    expect(h.snap()).toMatchObject({ phase: "speaking", said: "Hey kid." });

    h.replies[0]!.done.resolve("Hey kid. Gravy?");
    await settle();
    expect(h.speakers[0]!.finishedWith).toEqual(["Hey kid. Gravy?"]);
    h.speakers[0]!.finishing.resolve();
    await settle();
    expect(h.snap()).toMatchObject({ phase: "listening", said: "Hey kid. Gravy?" });
    expect(h.events.filter((event) => event.type === "phase").map((event) => event.phase)).toEqual([
      "listening",
      "transcribing",
      "thinking",
      "speaking",
      "listening",
    ]);
    // The reply's words as they streamed, then as saved, for whatever shows the character's reactions.
    expect(h.events.filter((event) => event.type === "reply")).toEqual([
      { type: "reply", sessionId: h.session.id, turn: 1, text: "Hey kid." },
      { type: "reply", sessionId: h.session.id, turn: 1, text: "Hey kid. Gravy?" },
    ]);
  });

  it("keeps listening while the character talks, more warily while the voice is audible", async () => {
    const h = harness();
    h.session.start();
    await say(h, "hi");
    h.replies[0]!.onText("Hello there.");
    const listen = h.mics[0]!.current;
    expect(listen.options.guarded()).toBe(false);
    h.speakers[0]!.audible = true;
    expect(listen.options.guarded()).toBe(true);
  });

  it("barge-in: pauses the voice at once, then stops the reply and sends the words once it has stopped", async () => {
    const h = harness();
    h.session.start();
    await say(h, "tell me a story");
    h.replies[0]!.onText("Once upon a time.");
    const speaker = h.speakers[0]!;

    h.mics[0]!.current.options.onSpeechStart();
    expect(speaker.pause).toHaveBeenCalledTimes(1);
    expect(h.snap().phase).toBe("interrupted");
    expect(h.replies[0]!.cancel).not.toHaveBeenCalled();

    h.mics[0]!.current.resolve("audio");
    await settle();
    h.transcripts.at(-1)!.resolve("wait, a scary one");
    await settle();
    expect(speaker.stop).toHaveBeenCalled();
    expect(h.replies[0]!.cancel).toHaveBeenCalledTimes(1);
    expect(h.snap()).toMatchObject({ phase: "interrupted", stopping: true, heard: "wait, a scary one" });
    expect(h.replies).toHaveLength(1); // not sent until the old reply has fully stopped

    h.replies[0]!.cancelled.resolve();
    await settle();
    expect(h.replies.map((reply) => reply.text)).toEqual(["tell me a story", "wait, a scary one"]);
    expect(h.snap()).toMatchObject({ phase: "thinking", stopping: false });
    expect(h.events).toContainEqual(expect.objectContaining({ type: "interrupted", turn: 1, by: "voice" }));
  });

  it("words said while the old reply is still stopping go out together as one message", async () => {
    const h = harness();
    h.session.start();
    await say(h, "hi");
    h.replies[0]!.onText("Hello.");
    await say(h, "wait");
    expect(h.snap().stopping).toBe(true);
    await say(h, "tell me a joke instead");
    h.replies[0]!.cancelled.resolve();
    await settle();
    expect(h.replies.map((reply) => reply.text)).toEqual(["hi", "wait tell me a joke instead"]);
  });

  it("noise resumes the voice instead of cutting the reply off", async () => {
    const h = harness();
    h.session.start();
    await say(h, "hi");
    h.replies[0]!.onText("Hello there.");
    await say(h, "");
    expect(h.speakers[0]!.resume).toHaveBeenCalledTimes(1);
    expect(h.replies[0]!.cancel).not.toHaveBeenCalled();
    expect(h.snap().phase).toBe("speaking");
    expect(h.events).toContainEqual(expect.objectContaining({ type: "resumed", reason: "silence" }));
  });

  it("the speakers' own echo resumes the voice instead of being sent as the user's words", async () => {
    const h = harness();
    h.session.start();
    await say(h, "hi");
    h.replies[0]!.onText("I was born ready for this moment, kid.");
    await say(h, "born ready for this moment");
    expect(h.speakers[0]!.resume).toHaveBeenCalledTimes(1);
    expect(h.replies[0]!.cancel).not.toHaveBeenCalled();
    expect(h.replies).toHaveLength(1);
    expect(h.events).toContainEqual(expect.objectContaining({ type: "resumed", reason: "echo" }));
  });

  it("echo that began under the reply and ended after it is not sent as the user's words", async () => {
    const h = harness();
    h.session.start();
    await say(h, "hi");
    h.replies[0]!.onText("Gravy is lumpy today, kid.");
    const listen = h.mics[0]!.current;
    listen.options.onSpeechStart(); // the reply's last words leaking into the mic
    h.replies[0]!.done.resolve("Gravy is lumpy today, kid.");
    await settle();
    h.speakers[0]!.resume(); // (the session resumes it once the words are in; the reply then finishes)
    h.speakers[0]!.finishing.resolve();
    listen.resolve("audio");
    await settle();
    h.transcripts.at(-1)!.resolve("lumpy today kid");
    await settle();
    expect(h.replies).toHaveLength(1);
    expect(h.snap().phase).toBe("listening");
    // Real words after a finished reply still go out.
    await say(h, "tell me more");
    expect(h.replies.map((reply) => reply.text)).toEqual(["hi", "tell me more"]);
  });

  it("a mic that keeps hearing the speakers turns talking-over off for the call instead of stuttering", async () => {
    const h = harness();
    h.session.start();
    await say(h, "hi");
    h.replies[0]!.onText("I was born ready for this moment, kid. The gravy machine never sleeps.");
    const speaker = h.speakers[0]!;
    speaker.audible = true;
    await say(h, "born ready for this moment");
    expect(h.snap().bargeIn).toBe("voice");
    await say(h, "the gravy machine never sleeps");
    expect(h.snap().bargeIn).toBe("speakers");
    expect(speaker.pause).toHaveBeenCalledTimes(2);

    // From now on sound heard while the voice plays is neither paused for nor sent anywhere.
    const transcribed = h.transcripts.length;
    const listen = h.mics[0]!.current;
    listen.options.onSpeechStart();
    listen.resolve("audio");
    await settle();
    expect(speaker.pause).toHaveBeenCalledTimes(2);
    expect(h.transcripts).toHaveLength(transcribed);
    expect(h.snap().phase).toBe("speaking");
    // Interrupt still works.
    h.session.interrupt();
    expect(h.replies[0]!.cancel).toHaveBeenCalled();
  });

  it("Interrupt cancels the reply (not just its voice) and goes back to listening", async () => {
    const h = harness();
    h.session.start();
    await say(h, "hi");
    h.replies[0]!.onText("Hello.");
    h.session.interrupt();
    expect(h.speakers[0]!.stop).toHaveBeenCalled();
    expect(h.replies[0]!.cancel).toHaveBeenCalledTimes(1);
    h.replies[0]!.cancelled.resolve();
    await settle();
    expect(h.snap()).toMatchObject({ phase: "listening", stopping: false });
    expect(h.events).toContainEqual(expect.objectContaining({ type: "interrupted", by: "button" }));
  });

  it("ignores everything a stopped turn does afterwards", async () => {
    const h = harness();
    h.session.start();
    await say(h, "hi");
    h.replies[0]!.onText("Hello.");
    h.session.interrupt();
    h.replies[0]!.cancelled.resolve();
    await settle();
    const before = h.snap();
    h.replies[0]!.onText("Hello. More words nobody asked for.");
    h.replies[0]!.done.resolve("Hello. More words nobody asked for.");
    await settle();
    expect(h.snap()).toBe(before);
    expect(h.speakers[0]!.pushed).toEqual(["Hello."]);
    expect(h.speakers[0]!.finishedWith).toEqual([]);
  });

  it("a reply stopped from elsewhere ends the turn, not the call", async () => {
    const h = harness();
    h.session.start();
    await say(h, "hi");
    h.replies[0]!.done.reject(abortError());
    await settle();
    expect(h.snap()).toMatchObject({ phase: "listening", error: null, mic: "listening" });
    await say(h, "still there?");
    expect(h.replies.map((reply) => reply.text)).toEqual(["hi", "still there?"]);
  });

  it("hanging up mid-reply closes the mic and stops the voice at once, and leaves the reply's text running", async () => {
    const h = harness();
    h.session.start();
    await say(h, "hi");
    h.replies[0]!.onText("Hello.");
    h.session.end();
    expect(h.mics[0]!.closed).toBe(true);
    expect(h.speakers[0]!.stop).toHaveBeenCalled();
    expect(h.replies[0]!.cancel).not.toHaveBeenCalled();
    expect(h.snap()).toMatchObject({ phase: "ended", mic: "off" });

    const ended = h.snap();
    h.replies[0]!.onText("Hello. And more.");
    h.replies[0]!.done.resolve("Hello. And more.");
    await settle();
    expect(h.snap()).toBe(ended);
    expect(h.events.at(-1)).toMatchObject({ type: "ended" });
  });

  it("hanging up while the browser is still opening the mic closes it as soon as it opens", async () => {
    const h = harness();
    h.holdOpen();
    h.session.start();
    await settle();
    expect(h.snap().mic).toBe("opening");
    h.session.end();
    const late = new FakeMic();
    h.opens[0]!.resolve(late);
    await settle();
    expect(late.closed).toBe(true);
    expect(late.listens).toEqual([]);
    expect(h.snap()).toMatchObject({ phase: "ended", mic: "off" });
  });

  it("a blocked microphone shows as an error with the mic off", async () => {
    const h = harness();
    h.holdOpen();
    h.session.start();
    await settle();
    h.opens[0]!.reject(new Error("De-Koi can't use the microphone: it's blocked for this site."));
    await settle();
    expect(h.snap()).toMatchObject({
      phase: "error",
      mic: "off",
      error: "De-Koi can't use the microphone: it's blocked for this site.",
    });
  });

  it("a setup that can't work here (no https) shows its reason", async () => {
    const h = harness({
      setup: async () => {
        throw new Error("Voice needs De-Koi on an https:// address (or localhost).");
      },
    });
    h.session.start();
    await settle();
    expect(h.snap()).toMatchObject({
      phase: "error",
      error: "Voice needs De-Koi on an https:// address (or localhost).",
    });
  });

  it("a transcription failure ends the call visibly and releases the mic", async () => {
    const h = harness();
    h.session.start();
    await settle();
    h.mics[0]!.current.options.onSpeechStart();
    h.mics[0]!.current.resolve("audio");
    await settle();
    h.transcripts[0]!.reject(new Error("ElevenLabs couldn't transcribe that (401)."));
    await settle();
    expect(h.snap()).toMatchObject({ phase: "error", error: "ElevenLabs couldn't transcribe that (401).", mic: "off" });
    expect(h.mics[0]!.closed).toBe(true);
  });

  it("a reply or voice failure ends the call visibly", async () => {
    const reply = harness();
    reply.session.start();
    await say(reply, "hi");
    reply.replies[0]!.done.reject(new Error("The model connection failed."));
    await settle();
    expect(reply.snap()).toMatchObject({ phase: "error", error: "The model connection failed.", mic: "off" });

    const voice = harness();
    voice.session.start();
    await say(voice, "hi");
    voice.replies[0]!.done.resolve("Hello.");
    await settle();
    voice.speakers[0]!.finishing.reject(new Error("ElevenLabs voice is not selected"));
    await settle();
    expect(voice.snap()).toMatchObject({ phase: "error", error: "ElevenLabs voice is not selected" });
  });

  it("a mic that stops on its own (unplugged) ends the call visibly", async () => {
    const h = harness();
    h.session.start();
    await settle();
    h.mics[0]!.unplug();
    expect(h.snap()).toMatchObject({ phase: "error", mic: "off" });
    expect(h.snap().error).toContain("microphone stopped");
  });

  it("mute releases the microphone and unmute opens it again", async () => {
    const h = harness();
    h.session.start();
    await settle();
    h.session.setMuted(true);
    await settle();
    expect(h.mics[0]!.closed).toBe(true);
    expect(h.snap()).toMatchObject({ muted: true, mic: "off" });
    h.session.setMuted(false);
    await settle();
    expect(h.mics).toHaveLength(2);
    expect(h.snap()).toMatchObject({ muted: false, mic: "listening", phase: "listening" });
  });

  it("muting while talking over the reply lets the voice carry on", async () => {
    const h = harness();
    h.session.start();
    await say(h, "hi");
    h.replies[0]!.onText("Hello.");
    h.mics[0]!.current.options.onSpeechStart();
    h.session.setMuted(true);
    expect(h.speakers[0]!.resume).toHaveBeenCalled();
    expect(h.snap().phase).toBe("speaking");
  });

  it("text-only replies: no speaker, and talking still cuts the reply off", async () => {
    const h = harness({ voice: false });
    h.session.start();
    await say(h, "hi");
    expect(h.snap().voiceReplies).toBe(false);
    h.replies[0]!.onText("Hello.");
    await say(h, "never mind");
    expect(h.replies[0]!.cancel).toHaveBeenCalled();
  });

  it("a recognizer input listens only between replies and offers the button instead of barge-in", async () => {
    const recognitions: Array<ReturnType<typeof deferred<string>>> = [];
    const h = harness({
      setup: async () => ({
        voiceReplies: true,
        input: {
          kind: "recognizer",
          destination: "your browser's speech service",
          recognize: () => {
            const recognition = deferred<string>();
            recognitions.push(recognition);
            return recognition.promise;
          },
        },
      }),
    });
    h.session.start();
    await settle();
    expect(h.snap()).toMatchObject({ bargeIn: "button", mic: "sending", phase: "listening" });
    recognitions[0]!.resolve("hello");
    await settle();
    expect(h.snap()).toMatchObject({ phase: "thinking", mic: "off" });
    expect(recognitions).toHaveLength(1); // not listening during the reply

    h.replies[0]!.onText("Hi.");
    h.session.interrupt();
    expect(h.replies[0]!.cancel).toHaveBeenCalled();
    h.replies[0]!.cancelled.resolve();
    await settle();
    expect(recognitions).toHaveLength(2);
    expect(h.snap()).toMatchObject({ phase: "listening", mic: "sending" });
  });

  it("a recognizer call waits for a cut-off reply to stop without freezing the page", async () => {
    // The reply is saved (its turn is over) while the cancel still waits on the server: the loop used to spin on
    // the finished turn and starve the very timers and requests that cancel was waiting for.
    const recognitions: Array<ReturnType<typeof deferred<string>>> = [];
    const h = harness({
      setup: async () => ({
        voiceReplies: true,
        input: {
          kind: "recognizer",
          destination: "your browser's speech service",
          recognize: () => {
            const recognition = deferred<string>();
            recognitions.push(recognition);
            return recognition.promise;
          },
        },
      }),
    });
    h.session.start();
    await settle();
    recognitions[0]!.resolve("tell me a story");
    await settle();
    h.replies[0]!.onText("Once upon a time.");
    h.session.interrupt();
    h.replies[0]!.done.resolve("Once upon a time.");
    await settle(); // timers still run
    expect(recognitions).toHaveLength(1);
    h.replies[0]!.cancelled.resolve();
    await settle();
    expect(recognitions).toHaveLength(2);
    expect(h.snap()).toMatchObject({ phase: "listening", stopping: false });
  });

  it("times a turn from when the user stopped talking to the reply's first sound, stage by stage", async () => {
    let clock = 10_000;
    const now = vi.spyOn(Date, "now").mockImplementation(() => clock);
    try {
      const h = harness();
      h.session.start();
      await settle();
      const listen = h.mics[0]!.current;
      listen.options.onSpeechStart();
      clock = 12_000;
      listen.options.onSpeechEnd(1_100); // quiet since 10_900
      listen.resolve("audio");
      await settle();
      clock = 12_400;
      h.transcripts[0]!.resolve("hey");
      await settle();
      clock = 13_400;
      h.replies[0]!.onText("Hey");
      clock = 13_600;
      h.replies[0]!.onText("Hey kid. ");
      clock = 14_100;
      h.speakers[0]!.firstSound();
      h.speakers[0]!.firstSound(); // later parts don't report again

      const timing = {
        turn: 1,
        totalMs: 3_200,
        endOfSpeechMs: 1_100,
        transcribeMs: 400,
        sendMs: 0,
        firstWordsMs: 1_000,
        firstSentenceMs: 200,
        voiceMs: 500,
      };
      expect(h.snap().timing).toEqual(timing);
      expect(h.events.filter((event) => event.type === "timing")).toEqual([
        { type: "timing", sessionId: h.session.id, turn: 1, timing },
      ]);
    } finally {
      now.mockRestore();
    }
  });

  it("doesn't time a reply whose voice was held for the user before it made a sound", async () => {
    const h = harness();
    h.session.start();
    await say(h, "hi");
    h.replies[0]!.onText("Hello there. ");
    h.mics[0]!.current.options.onSpeechStart();
    h.mics[0]!.current.resolve("audio:cough");
    await settle();
    h.transcripts.at(-1)!.resolve(""); // just noise: the voice resumes
    await settle();
    h.speakers[0]!.firstSound();
    expect(h.snap().timing).toBeNull();
    expect(h.events.some((event) => event.type === "timing")).toBe(false);
  });

  describe("thinking sounds", () => {
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const finishTurn = async (h: ReturnType<typeof harness>, index: number, saved: string) => {
      h.replies[index]!.done.resolve(saved);
      await settle();
      h.speakers[index]!.finishing.resolve();
      await settle();
    };

    it("fills a silent reply with one sound, and never on two turns in a row", async () => {
      const h = harness({ thinkingSounds: true });
      h.session.start();
      await say(h, "hey Freddy");
      expect(h.thinkingSounds).toHaveLength(1);
      expect(h.thinkingSounds[0]!.play).toHaveBeenCalledTimes(1);
      expect(h.events.filter((event) => event.type === "thinking_sound")).toEqual([
        { type: "thinking_sound", sessionId: h.session.id, turn: 1, text: "Hmm..." },
      ]);
      await finishTurn(h, 0, "Hey kid.");

      await say(h, "what's up");
      expect(h.thinkingSounds).toHaveLength(1);
      await finishTurn(h, 1, "Nothing much.");

      await say(h, "cool");
      expect(h.thinkingSounds).toHaveLength(2);
    });

    it("stays quiet once the reply has started speaking", async () => {
      const h = harness({ thinkingSounds: true, thinkingSoundDelayMs: 250 });
      h.session.start();
      await say(h, "hi");
      h.replies[0]!.onText("Hello there. ");
      await wait(350);
      expect(h.thinkingSounds).toHaveLength(0);
    });

    it("never plays while the user is talking, and stops the moment they start", async () => {
      const quiet = harness({ thinkingSounds: true, thinkingSoundDelayMs: 250 });
      quiet.session.start();
      await say(quiet, "so I was thinking");
      quiet.mics[0]!.current.options.onSpeechStart(); // still talking
      await wait(350);
      expect(quiet.thinkingSounds).toHaveLength(0);

      const h = harness({ thinkingSounds: true });
      h.session.start();
      await say(h, "hi");
      const sound = h.thinkingSounds[0]!;
      expect(sound.stop).not.toHaveBeenCalled();
      h.mics[0]!.current.options.onSpeechStart();
      expect(sound.stop).toHaveBeenCalledTimes(1);
    });

    it("its own echo in the microphone doesn't cut the reply off", async () => {
      const h = harness({ thinkingSounds: true });
      h.session.start();
      await say(h, "hi");
      const mic = h.mics[0]!;
      mic.current.options.onSpeechStart(); // the speakers' "Hmm" set it off
      mic.current.resolve("audio:hm");
      await settle();
      h.transcripts.at(-1)!.resolve("Hm.");
      await settle();
      expect(h.replies[0]!.cancel).not.toHaveBeenCalled();
      expect(h.events.filter((event) => event.type === "resumed")).toEqual([
        { type: "resumed", sessionId: h.session.id, turn: 1, reason: "echo" },
      ]);
    });

    it("stops at once on hang-up and on Interrupt", async () => {
      const h = harness({ thinkingSounds: true });
      h.session.start();
      await say(h, "hi");
      h.session.interrupt();
      expect(h.thinkingSounds[0]!.stop).toHaveBeenCalled();

      const call = harness({ thinkingSounds: true });
      call.session.start();
      await say(call, "hi");
      call.session.end();
      expect(call.thinkingSounds[0]!.stop).toHaveBeenCalled();
    });
  });

  it("start is idempotent and every event names its session", async () => {
    const h = harness();
    h.session.start();
    h.session.start();
    await settle();
    expect(h.mics).toHaveLength(1);
    expect(h.events.every((event) => event.sessionId === h.session.id)).toBe(true);
  });
});

describe("soundsLikeThinkingSound", () => {
  it("matches the sound coming back however the transcriber spells a hum", () => {
    expect(soundsLikeThinkingSound("Hmm.", "Hmm...")).toBe(true);
    expect(soundsLikeThinkingSound("Mm", "Hmm...")).toBe(true);
    expect(soundsLikeThinkingSound("hm okay", "Hm, okay...")).toBe(true);
  });

  it("does not swallow the user's own words", () => {
    expect(soundsLikeThinkingSound("Hmm, wait, actually", "Hmm...")).toBe(false);
    expect(soundsLikeThinkingSound("okay", "Hmm...")).toBe(false);
    expect(soundsLikeThinkingSound("", "Hmm...")).toBe(false);
  });
});

describe("soundsLikeReplyEcho", () => {
  const reply = "I was BORN ready, kid. Ready for what though? The gravy machine never sleeps.";

  it("matches a run of the reply's own words", () => {
    expect(soundsLikeReplyEcho("born ready kid ready for what", reply)).toBe(true);
    expect(soundsLikeReplyEcho("the gravy machine never sleeps", reply)).toBe(true);
  });

  it("does not match the user's own words", () => {
    expect(soundsLikeReplyEcho("can you stop talking about gravy", reply)).toBe(false);
    expect(soundsLikeReplyEcho("what's for dinner tonight", reply)).toBe(false);
  });

  it("always lets short phrases through as the user", () => {
    expect(soundsLikeReplyEcho("ready", reply)).toBe(false);
    expect(soundsLikeReplyEcho("wait kid", reply)).toBe(false);
  });
});
