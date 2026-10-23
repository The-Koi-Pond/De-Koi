import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    promise.catch(() => undefined);
    return { promise, resolve, reject };
  };
  type Listen = {
    stream: string;
    options: { onSpeechStart?: () => void; guarded?: () => boolean };
    resolve: (audio: Blob | null) => void;
  };
  const state = {
    abortControllers: new Map<string, AbortController>(),
    streamBuffers: new Map<string, string>(),
  };
  const storeListeners = new Set<(s: typeof state) => void>();
  return {
    deferred,
    opened: [] as string[],
    stopped: [] as string[],
    listens: [] as Listen[],
    transcripts: [] as Array<ReturnType<typeof deferred<string>>>,
    runnerJobs: [] as Array<Array<{ status: string }>>,
    state,
    storeListeners,
    setStore(mutate: (s: typeof state) => void) {
      mutate(state);
      for (const listener of [...storeListeners]) listener(state);
    },
  };
});

vi.mock("../../../../shared/lib/voice-recorder", () => ({
  VOICE_NEEDS_HTTPS_MESSAGE: "https",
  loadSpeechConfig: async () => ({ enabled: false, source: "elevenlabs", baseUrl: "", speechInputProvider: true }),
  providerSpeechInputEnabled: () => true,
  canRecordAudio: () => true,
  openMicrophone: async () => {
    const id = `mic-${h.opened.length + 1}`;
    h.opened.push(id);
    return { id, getAudioTracks: () => [{ readyState: "live", addEventListener() {}, removeEventListener() {} }] };
  },
  recordUtterance: (stream: { id: string }, signal: AbortSignal, options: object) =>
    new Promise((resolve, reject) => {
      h.listens.push({ stream: stream.id, options, resolve });
      signal.addEventListener("abort", () => reject(new DOMException("stopped", "AbortError")), { once: true });
    }),
  stopStream: (stream: { id: string } | null) => {
    if (stream) h.stopped.push(stream.id);
  },
}));
vi.mock("../../../../shared/api/tts-api", () => ({
  ttsApi: {
    transcribe: () => {
      const transcript = h.deferred<string>();
      h.transcripts.push(transcript);
      return transcript.promise;
    },
  },
}));
vi.mock("../../../../shared/api/storage-api", () => ({ storageApi: { listChatMessages: async () => [] } }));
vi.mock("../../../../shared/api/generation-runner-api", () => ({
  generationRunnerAvailable: async () => true,
  generationRunnerApi: { list: async () => h.runnerJobs.shift() ?? [] },
}));
vi.mock("../../../../shared/lib/tts-service", () => ({
  ttsService: {
    stop: () => {},
    pause: () => {},
    resume: () => {},
    getState: () => "idle",
    speakSequence: async () => {},
    generateAudio: async () => new Blob(),
  },
}));
vi.mock("../../../../shared/stores/chat.store", () => ({
  useChatStore: {
    getState: () => h.state,
    subscribe: (listener: (s: typeof h.state) => void) => {
      h.storeListeners.add(listener);
      return () => h.storeListeners.delete(listener);
    },
  },
}));

import { chatAutoplayHeld } from "../../../../shared/lib/chat-autoplay-hold";
import { useVoiceCall, type VoiceCall } from "./use-voice-call";

let call: VoiceCall | null = null;
function Harness({ chatId, sendText }: { chatId: string; sendText: (text: string) => Promise<boolean> }) {
  call = useVoiceCall({ chatId, character: { id: "c1", name: "Freddy" }, sendText });
  return null;
}

const settle = async () => {
  for (let i = 0; i < 6; i += 1) await act(async () => await new Promise((resolve) => setTimeout(resolve, 0)));
};

/** Talks into the latest listen and lets the words be transcribed. */
async function say(words: string) {
  const listen = h.listens.at(-1)!;
  act(() => listen.options.onSpeechStart?.());
  listen.resolve(new Blob([words]));
  await settle();
  h.transcripts.at(-1)!.resolve(words);
  await settle();
}

describe("useVoiceCall", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    h.opened.length = 0;
    h.stopped.length = 0;
    h.listens.length = 0;
    h.transcripts.length = 0;
    h.runnerJobs.length = 0;
    h.state.abortControllers.clear();
    h.state.streamBuffers.clear();
    h.storeListeners.clear();
    call = null;
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(async () => {
    act(() => root.unmount());
    await settle();
  });

  it("switching chats mid-reply ends the old call's mic at once and leaves the new call's mic alone", async () => {
    const replyA = h.deferred<boolean>();
    act(() => root.render(<Harness chatId="a" sendText={() => replyA.promise} />));
    await settle();
    await say("hello");
    expect(h.opened).toEqual(["mic-1"]);

    act(() => root.render(<Harness chatId="b" sendText={async () => true} />));
    await settle();
    expect(h.opened).toEqual(["mic-1", "mic-2"]);
    expect(h.stopped).toEqual(["mic-1"]);
    expect(h.listens.at(-1)!.stream).toBe("mic-2");

    replyA.resolve(true); // the old chat's reply lands after the switch
    await settle();
    expect(h.stopped).toEqual(["mic-1"]);
    expect(call!.mic).toBe("listening");
  });

  it("hanging up mid-reply closes the mic right away, not when the reply finishes", async () => {
    const reply = h.deferred<boolean>();
    act(() => root.render(<Harness chatId="a" sendText={() => reply.promise} />));
    await settle();
    await say("hello");
    act(() => call!.hangUp());
    expect(h.stopped).toEqual(["mic-1"]);
    expect(call!.mic).toBe("off");

    // The reply still being written belongs to the call: the chat's autoplay must not read it out after the hang-up.
    act(() => root.unmount());
    root = createRoot(container);
    await settle();
    expect(chatAutoplayHeld("a")).toBe(true);
    reply.resolve(true);
    await settle();
    expect(chatAutoplayHeld("a")).toBe(false);
  });

  it("keeps the chat's own autoplay quiet while the call is open", async () => {
    act(() => root.render(<Harness chatId="a" sendText={async () => true} />));
    await settle();
    expect(chatAutoplayHeld("a")).toBe(true);
    expect(chatAutoplayHeld("b")).toBe(false);
    act(() => root.unmount());
    root = createRoot(container);
    await settle();
    expect(chatAutoplayHeld("a")).toBe(false);
  });

  it("a remount (React's development double-mount) keeps one call and one microphone", async () => {
    act(() =>
      root.render(
        <StrictMode>
          <Harness chatId="a" sendText={async () => true} />
        </StrictMode>,
      ),
    );
    await settle();
    expect(h.opened).toEqual(["mic-1"]);
    expect(h.stopped).toEqual([]);
    act(() => root.unmount());
    await settle();
    expect(h.stopped).toEqual(["mic-1"]);
    root = createRoot(container);
  });

  it("cutting in cancels the reply still being written and waits for the server to stop it before sending", async () => {
    const sent: string[] = [];
    const sendText = (text: string) => {
      sent.push(text);
      const controller = new AbortController();
      h.setStore((state) => {
        state.abortControllers.set("a", controller);
        state.streamBuffers.set("a", "");
      });
      return new Promise<boolean>((resolve, reject) => {
        controller.signal.addEventListener("abort", () => {
          h.setStore((state) => state.abortControllers.delete("a"));
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
        if (text !== "hello") resolve(true);
      });
    };
    act(() => root.render(<Harness chatId="a" sendText={sendText} />));
    await settle();
    await say("hello");
    const controller = h.state.abortControllers.get("a")!;
    act(() => h.setStore((state) => state.streamBuffers.set("a", "Once upon a time.")));
    expect(call!.said).toBe("Once upon a time.");

    h.runnerJobs.push([{ status: "running" }], [{ status: "running" }]); // the server is still saving the cut-off part
    await say("wait, a scary one");
    expect(controller.signal.aborted).toBe(true);
    expect(sent).toEqual(["hello"]);
    expect(call!.stopping).toBe(true);

    await act(async () => await new Promise((resolve) => setTimeout(resolve, 650)));
    await settle();
    expect(sent).toEqual(["hello", "wait, a scary one"]);
    expect(call!.stopping).toBe(false);
  });
});
