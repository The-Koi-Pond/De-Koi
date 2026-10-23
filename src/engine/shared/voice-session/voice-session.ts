// ──────────────────────────────────────────────
// Voice session: one hands-free conversation by voice
// ──────────────────────────────────────────────
// Listen → transcribe → send → speak the reply while it streams → listen again. With a recorder input the
// microphone keeps listening while the character talks: speech pauses the reply's voice at once, and when the
// user's words come back as text the reply is cut off (its unsaid audio dropped, its generation cancelled if it is
// still being written) and the words are sent. Noise or the speakers' own echo just resumes the voice.
//
// Every callback is tied to its session and turn, so nothing from an ended session or an earlier turn can change
// what is shown or start audio. Ending the session closes the microphone and stops playback at once.
import type {
  VoiceInput,
  VoiceMicrophone,
  VoiceRecognizerInput,
  VoiceRecorderInput,
  VoiceReplyHandle,
  VoiceReplySpeaker,
  VoiceSessionPorts,
} from "../../capabilities/voice";
import { soundsLikeReplyEcho } from "./echo";

export type VoiceSessionPhase =
  | "connecting"
  | "listening"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "interrupted"
  | "ended"
  | "error";

/** What the microphone is doing. "sending" means audio is on its way to `destination`. */
export type VoiceMicState = "off" | "opening" | "listening" | "sending";

export interface VoiceSessionSnapshot {
  readonly sessionId: number;
  readonly phase: VoiceSessionPhase;
  readonly mic: VoiceMicState;
  /** Who receives the user's speech (for example "ElevenLabs"); empty until the input is known. */
  readonly destination: string;
  /**
   * "voice": talking over the reply interrupts it. "button": only Interrupt can, because the input can't listen
   * while the reply plays. "speakers": talking over was turned off for this call because the microphone kept
   * picking up the reply's own voice.
   */
  readonly bargeIn: "voice" | "button" | "speakers";
  readonly level: number;
  readonly heard: string;
  readonly said: string;
  readonly error: string | null;
  readonly muted: boolean;
  readonly voiceReplies: boolean;
  /** True while a cut-off reply is being stopped, before the user's words are sent. */
  readonly stopping: boolean;
}

export type VoiceSessionEvent =
  | { type: "phase"; sessionId: number; phase: VoiceSessionPhase }
  | { type: "mic"; sessionId: number; mic: VoiceMicState }
  | { type: "heard"; sessionId: number; turn: number; text: string }
  /** The turn's reply so far: as it streams, then as saved. */
  | { type: "reply"; sessionId: number; turn: number; text: string }
  | { type: "interrupted"; sessionId: number; turn: number; by: "voice" | "button" }
  | { type: "resumed"; sessionId: number; turn: number; reason: "silence" | "echo" }
  | { type: "error"; sessionId: number; message: string }
  | { type: "ended"; sessionId: number };

type VoiceSessionEventBody = VoiceSessionEvent extends infer Event
  ? Event extends { sessionId: number }
    ? Omit<Event, "sessionId">
    : never
  : never;

export interface VoiceSession {
  readonly id: number;
  /** Opens the microphone and starts listening. Calling it again does nothing. */
  start(): void;
  getSnapshot(): VoiceSessionSnapshot;
  /** Called whenever the snapshot changes. */
  subscribe(listener: () => void): () => void;
  onEvent(listener: (event: VoiceSessionEvent) => void): () => void;
  /** Muting closes the microphone (the device is released); unmuting opens it again. */
  setMuted(muted: boolean): void;
  /** Cuts the character off (cancelling the reply if it is still being written) and goes back to listening. */
  interrupt(): void;
  /** Hangs up: the microphone closes and playback stops at once. A reply still being written finishes as text. */
  end(): void;
}

interface Turn {
  id: number;
  speaker: VoiceReplySpeaker | null;
  handle: VoiceReplyHandle | null;
  /** The reply as streamed (then saved) so far, for telling echo from the user. */
  replyText: string;
  /** Speech started over this turn: its voice is held until the words are in. */
  pausedForUser: boolean;
  /** Times this turn's voice was held for speech that turned out to be noise or its own echo. */
  falseAlarms: number;
  cancelled: boolean;
  /** Resolves once the turn has finished or been stopped. */
  over: Promise<void>;
  markOver: () => void;
}

/** False alarms in one reply after which talking over the voice is turned off for the rest of the call. */
const FALSE_ALARMS_BEFORE_SPEAKER_GUARD = 2;

const MIC_STOPPED_MESSAGE = "The microphone stopped (it was unplugged, or its permission was taken away).";

let nextSessionId = 1;

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
}

function linkAbort(parent: AbortSignal, child: AbortController): () => void {
  if (parent.aborted) {
    child.abort();
    return () => undefined;
  }
  const onAbort = () => child.abort();
  parent.addEventListener("abort", onAbort, { once: true });
  return () => parent.removeEventListener("abort", onAbort);
}

class Session<Utterance> implements VoiceSession {
  readonly id = nextSessionId++;
  private snapshot: VoiceSessionSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly eventListeners = new Set<(event: VoiceSessionEvent) => void>();
  private readonly life = new AbortController();
  private started = false;
  private mic: VoiceMicrophone<Utterance> | null = null;
  private stopWatchingMic: (() => void) | null = null;
  private listenController: AbortController | null = null;
  private turn: Turn | null = null;
  private turnCount = 0;
  /** Words said while a cut-off reply is being stopped; sent together once it has. */
  private queued = "";
  private stopping: Promise<void> | null = null;
  private speechActive = false;
  /** The turn whose reply was playing when the current speech began (its echo can outlast the turn). */
  private speechBeganDuring: Turn | null = null;
  /** The current utterance began while the voice was playing after talking over it was turned off: drop it. */
  private discardUtterance = false;
  private speechIdleWaiters: Array<() => void> = [];
  private unmuteWaiters: Array<() => void> = [];

  constructor(private readonly ports: VoiceSessionPorts<Utterance>) {
    this.snapshot = {
      sessionId: this.id,
      phase: "connecting",
      mic: "off",
      destination: "",
      bargeIn: "voice",
      level: 0,
      heard: "",
      said: "",
      error: null,
      muted: false,
      voiceReplies: true,
      stopping: false,
    };
  }

  private get over(): boolean {
    return this.life.signal.aborted;
  }

  getSnapshot = (): VoiceSessionSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  onEvent(listener: (event: VoiceSessionEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  start(): void {
    if (this.started || this.over) return;
    this.started = true;
    void this.run().catch((error: unknown) => this.fail(error));
  }

  setMuted(muted: boolean): void {
    if (this.over || this.snapshot.muted === muted) return;
    this.update({ muted });
    if (!muted) {
      this.release("unmute");
      return;
    }
    this.listenController?.abort();
    this.closeMic();
    const turn = this.turn;
    if (turn && turn.pausedForUser && !turn.cancelled) this.resumeTurn(turn);
    this.release("speech");
  }

  interrupt(): void {
    if (this.over) return;
    const turn = this.turn;
    if (turn && !turn.cancelled) this.stopTurn(turn, "button");
  }

  end(): void {
    this.finish("ended", null);
  }

  // ── Loops ───────────────────────────────────

  private async run(): Promise<void> {
    const setup = await this.ports.setup(this.life.signal);
    if (this.over) return;
    const input: VoiceInput<Utterance> = setup.input;
    this.update({
      destination: input.destination,
      bargeIn: input.kind === "recorder" ? "voice" : "button",
      voiceReplies: setup.voiceReplies,
    });
    if (input.kind === "recorder") await this.recorderLoop(input);
    else await this.recognizerLoop(input);
  }

  /** Listens the whole time, including while the character talks. */
  private async recorderLoop(input: VoiceRecorderInput<Utterance>): Promise<void> {
    while (!this.over) {
      if (this.snapshot.muted) {
        await this.until("unmute");
        continue;
      }
      const mic = this.mic ?? (await this.openMic(input));
      if (!mic || this.over) continue;
      if (!this.turn && !this.stopping) this.update({ phase: "listening" });

      const listen = new AbortController();
      this.listenController = listen;
      const unlink = linkAbort(this.life.signal, listen);
      let utterance: Utterance | null;
      try {
        utterance = await mic.listen({
          signal: listen.signal,
          guarded: () => Boolean(this.turn?.speaker?.isAudible()),
          onLevel: (level) => {
            if (this.listenController === listen) this.update({ level });
          },
          onSpeechStart: () => {
            if (this.listenController === listen) this.onSpeechStart();
          },
        });
      } catch (error) {
        if (isAbortError(error) && listen.signal.aborted) continue; // muted or hung up
        throw error;
      } finally {
        unlink();
        if (this.listenController === listen) this.listenController = null;
        this.update({ level: 0 });
      }
      if (!utterance || this.discardUtterance) {
        // Nobody spoke for a while, or it was heard over the reply after talking over it was turned off.
        this.release("speech");
        continue;
      }

      if (!this.turn && !this.stopping) this.update({ phase: "transcribing" });
      this.update({ mic: "sending" });
      let text: string;
      try {
        text = (await input.transcribe(utterance, this.life.signal)).trim();
      } finally {
        this.update({ mic: this.mic ? "listening" : "off" });
      }
      if (this.over) return;
      this.dispatch(text);
      this.release("speech");
    }
  }

  /** The recognizer owns the microphone, so it listens only between replies. */
  private async recognizerLoop(input: VoiceRecognizerInput): Promise<void> {
    while (!this.over) {
      if (this.snapshot.muted) {
        await this.until("unmute");
        continue;
      }
      // A cut-off turn is over before the session lets go of it (that waits for its reply to fully stop), so wait
      // for the stop first: waiting on the finished turn again would spin without ever yielding.
      if (this.stopping) {
        await this.stopping.catch(() => undefined);
        continue;
      }
      if (this.turn) {
        await this.turn.over;
        continue;
      }
      this.update({ phase: "listening", mic: "sending" });
      const listen = new AbortController();
      this.listenController = listen;
      const unlink = linkAbort(this.life.signal, listen);
      let text: string;
      try {
        text = (await input.recognize(listen.signal)).trim();
      } catch (error) {
        if (isAbortError(error) && listen.signal.aborted) continue;
        throw error;
      } finally {
        unlink();
        if (this.listenController === listen) this.listenController = null;
        this.update({ mic: "off" });
      }
      // Muted (or hung up) mid-utterance: what was caught before that isn't sent.
      if (this.over || listen.signal.aborted || !text) continue;
      this.startTurn(text);
    }
  }

  // ── Speech over a reply ─────────────────────

  private onSpeechStart(): void {
    if (this.over) return;
    this.speechActive = true;
    const turn = this.turn;
    this.speechBeganDuring = turn;
    if (!turn || turn.cancelled || turn.pausedForUser) return;
    if (this.snapshot.bargeIn === "speakers" && turn.speaker?.isAudible()) {
      this.discardUtterance = true;
      return;
    }
    turn.pausedForUser = true;
    turn.speaker?.pause();
    this.update({ phase: "interrupted" });
  }

  private dispatch(text: string): void {
    if (this.stopping) {
      if (text) this.queue(text);
      return;
    }
    const turn = this.turn;
    if (!turn) {
      // Speech that began under the last reply and only ended after it: the tail of that reply's own echo?
      const earlier = this.speechBeganDuring;
      const echo = Boolean(earlier?.speaker && text && soundsLikeReplyEcho(text, earlier.replyText));
      if (text && !echo) this.startTurn(text);
      else this.update({ phase: "listening" });
      return;
    }
    if (!text || (turn.speaker && soundsLikeReplyEcho(text, turn.replyText))) {
      if (turn.pausedForUser) {
        this.resumeTurn(turn);
        this.emit({ type: "resumed", turn: turn.id, reason: text ? "echo" : "silence" });
        turn.falseAlarms += 1;
        // The mic keeps hearing the speakers: stop pausing (and uploading) for them for the rest of the call.
        if (turn.falseAlarms >= FALSE_ALARMS_BEFORE_SPEAKER_GUARD && this.snapshot.bargeIn === "voice") {
          this.update({ bargeIn: "speakers" });
        }
      }
      return;
    }
    this.queue(text);
    this.stopTurn(turn, "voice");
  }

  private resumeTurn(turn: Turn): void {
    turn.pausedForUser = false;
    turn.speaker?.resume();
    this.update({ phase: turn.speaker?.started ? "speaking" : "thinking" });
  }

  private queue(text: string): void {
    this.queued = this.queued ? `${this.queued} ${text}` : text;
    this.update({ heard: this.queued });
  }

  /** Cuts a turn off. Once its reply has fully stopped, sends whatever the user said meanwhile. */
  private stopTurn(turn: Turn, by: "voice" | "button"): void {
    if (turn.cancelled) return;
    turn.cancelled = true;
    turn.speaker?.stop();
    this.emit({ type: "interrupted", turn: turn.id, by });
    this.update({ phase: "interrupted", stopping: true });
    const handle = turn.handle;
    let stopping: Promise<void> | null = null;
    stopping = (async () => {
      try {
        await handle?.cancel();
      } finally {
        turn.markOver();
      }
      if (this.over) return;
      if (this.turn === turn) this.turn = null;
      // Still talking: wait for the end of the sentence so it goes out as one message.
      await this.until("speech");
      if (this.over || this.stopping !== stopping) return;
      this.stopping = null;
      const text = this.queued;
      this.queued = "";
      this.update({ stopping: false });
      if (text) this.startTurn(text);
      else this.update({ phase: "listening" });
    })();
    this.stopping = stopping;
    stopping.catch((error: unknown) => this.fail(error));
  }

  // ── Turns ───────────────────────────────────

  private startTurn(text: string): void {
    const id = ++this.turnCount;
    let markOver: () => void = () => undefined;
    const over = new Promise<void>((resolve) => {
      markOver = resolve;
    });
    const speaker = this.ports.speech.begin(`${this.id}:${id}`);
    const turn: Turn = {
      id,
      speaker,
      handle: null,
      replyText: "",
      pausedForUser: false,
      falseAlarms: 0,
      cancelled: false,
      over,
      markOver,
    };
    this.turn = turn;
    this.update({ phase: "thinking", heard: text, said: "" });
    this.emit({ type: "heard", turn: id, text });
    const live = () => this.turn === turn && !turn.cancelled && !this.over;
    turn.handle = this.ports.reply.send(text, (streamed) => {
      if (!live()) return;
      this.setReplyText(turn, streamed);
      speaker?.push(streamed);
      this.update(speaker?.started && !turn.pausedForUser ? { said: streamed, phase: "speaking" } : { said: streamed });
    });
    void this.followTurn(turn, live)
      .catch((error: unknown) => {
        if (live()) this.fail(error);
      })
      .finally(() => turn.markOver());
  }

  private async followTurn(turn: Turn, live: () => boolean): Promise<void> {
    let saved: string | null;
    try {
      saved = await turn.handle!.done;
    } catch (error) {
      if (!live()) return;
      if (!isAbortError(error)) throw error;
      // Stopped from somewhere else (not this call): the call goes on.
      turn.speaker?.stop();
      this.endTurn(turn);
      return;
    }
    if (!live()) return;
    if (saved) {
      this.setReplyText(turn, saved);
      this.update({ said: saved });
    }
    if (turn.speaker) {
      if ((saved || turn.speaker.started) && !turn.pausedForUser) this.update({ phase: "speaking" });
      await turn.speaker.finish(saved);
    }
    if (live()) this.endTurn(turn);
  }

  private setReplyText(turn: Turn, text: string): void {
    if (turn.replyText === text) return;
    turn.replyText = text;
    this.emit({ type: "reply", turn: turn.id, text });
  }

  private endTurn(turn: Turn): void {
    if (this.turn !== turn) return;
    this.turn = null;
    turn.markOver();
    if (!this.stopping) this.update({ phase: "listening" });
  }

  // ── Microphone ──────────────────────────────

  private async openMic(input: VoiceRecorderInput<Utterance>): Promise<VoiceMicrophone<Utterance> | null> {
    this.update({ mic: "opening" });
    const mic = await input.open();
    if (this.over || this.snapshot.muted) {
      mic.close(); // hung up or muted while the browser was still opening it
      this.update({ mic: "off" });
      return null;
    }
    this.mic = mic;
    this.stopWatchingMic = mic.onEnded(() => {
      if (this.mic === mic) this.fail(new Error(MIC_STOPPED_MESSAGE));
    });
    this.update({ mic: "listening" });
    return mic;
  }

  private closeMic(): void {
    this.stopWatchingMic?.();
    this.stopWatchingMic = null;
    this.mic?.close();
    this.mic = null;
    this.update({ mic: "off" });
  }

  // ── Waiting ─────────────────────────────────

  private until(what: "speech" | "unmute"): Promise<void> {
    if (this.over) return Promise.resolve();
    if (what === "speech" && !this.speechActive) return Promise.resolve();
    if (what === "unmute" && !this.snapshot.muted) return Promise.resolve();
    return new Promise((resolve) => {
      (what === "speech" ? this.speechIdleWaiters : this.unmuteWaiters).push(resolve);
    });
  }

  private release(what: "speech" | "unmute"): void {
    if (what === "speech") {
      this.speechActive = false;
      this.speechBeganDuring = null;
      this.discardUtterance = false;
    }
    const waiters = what === "speech" ? this.speechIdleWaiters : this.unmuteWaiters;
    if (what === "speech") this.speechIdleWaiters = [];
    else this.unmuteWaiters = [];
    for (const resolve of waiters) resolve();
  }

  // ── Ending ──────────────────────────────────

  private fail(error: unknown): void {
    if (this.over) return;
    const message = error instanceof Error && error.message ? error.message : "The call dropped.";
    this.emit({ type: "error", message });
    this.finish("error", message);
  }

  private finish(phase: "ended" | "error", error: string | null): void {
    if (this.over) return;
    this.closeMic();
    this.life.abort();
    this.listenController?.abort();
    const turn = this.turn;
    this.turn = null;
    turn?.speaker?.stop(); // the reply's text, if still coming, keeps arriving in the chat
    turn?.markOver();
    this.release("speech");
    this.release("unmute");
    this.snapshot = { ...this.snapshot, phase, error, mic: "off", level: 0, stopping: false };
    this.notify();
    this.emitEvent({ type: "phase", sessionId: this.id, phase });
    this.emitEvent({ type: "ended", sessionId: this.id });
  }

  // ── State ───────────────────────────────────

  /** Ignored once the session is over, so nothing late can change what an ended call shows. */
  private update(patch: Partial<Omit<VoiceSessionSnapshot, "sessionId">>): void {
    if (this.over) return;
    const previous = this.snapshot;
    let changed = false;
    for (const key of Object.keys(patch) as Array<keyof typeof patch>) {
      if (previous[key] !== patch[key]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.snapshot = { ...previous, ...patch };
    this.notify();
    if (patch.phase !== undefined && patch.phase !== previous.phase) this.emit({ type: "phase", phase: patch.phase });
    if (patch.mic !== undefined && patch.mic !== previous.mic) this.emit({ type: "mic", mic: patch.mic });
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }

  private emit(event: VoiceSessionEventBody): void {
    if (this.over) return;
    this.emitEvent({ ...event, sessionId: this.id } as VoiceSessionEvent);
  }

  private emitEvent(event: VoiceSessionEvent): void {
    for (const listener of [...this.eventListeners]) listener(event);
  }
}

export function createVoiceSession<Utterance>(ports: VoiceSessionPorts<Utterance>): VoiceSession {
  return new Session(ports);
}
