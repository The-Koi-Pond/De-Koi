// ──────────────────────────────────────────────
// Capability ports for voice sessions
// ──────────────────────────────────────────────
// What a voice session needs from the app: a microphone (or a recognizer that owns one), a way to send the
// user's words as a message and follow the reply, and a speaker for the reply. The feature edge binds these to the
// browser's audio APIs, the generation pipeline and Text to Speech.

export interface VoiceListenOptions {
  signal: AbortSignal;
  /**
   * True while the character's voice is coming out of the speakers. Speech then has to be louder and longer to
   * count, so the speakers don't set it off.
   */
  guarded: () => boolean;
  /** Live input level (0-1) for the call screen's meter. */
  onLevel: (level: number) => void;
  /** Fires as soon as speech starts, before the utterance is over. */
  onSpeechStart: () => void;
}

/** An open microphone. `Utterance` is opaque to the engine: only the transcriber reads it. */
export interface VoiceMicrophone<Utterance> {
  /**
   * Waits for speech, records until a pause and resolves with it, or with null when nobody spoke for a while.
   * Rejects with an AbortError when `signal` aborts.
   */
  listen(options: VoiceListenOptions): Promise<Utterance | null>;
  /** Called when the device stops on its own. Returns an unsubscribe function. */
  onEnded(listener: () => void): () => void;
  close(): void;
}

/** Records speech and has a provider transcribe it. Can listen while the reply plays, so you can talk over it. */
export interface VoiceRecorderInput<Utterance> {
  kind: "recorder";
  /** Who receives recorded speech, for the mic indicator (for example "ElevenLabs"). */
  destination: string;
  open(): Promise<VoiceMicrophone<Utterance>>;
  transcribe(utterance: Utterance, signal: AbortSignal): Promise<string>;
}

/** A recognizer that owns the microphone itself (browser speech recognition). It can't listen while a reply plays. */
export interface VoiceRecognizerInput {
  kind: "recognizer";
  destination: string;
  /** One utterance; resolves with "" when nothing was said. */
  recognize(signal: AbortSignal): Promise<string>;
}

export type VoiceInput<Utterance> = VoiceRecorderInput<Utterance> | VoiceRecognizerInput;

export interface VoiceSessionSetup<Utterance> {
  input: VoiceInput<Utterance>;
  /** False when replies can only be shown as text (no voice set up). */
  voiceReplies: boolean;
}

/** One reply to the user's words. */
export interface VoiceReplyHandle {
  /**
   * Settles once the reply has been saved and its generation has fully ended: the saved text, or null when nothing
   * was saved. Rejects when generation fails, with an AbortError when it was cancelled.
   */
  readonly done: Promise<string | null>;
  /**
   * Cancels the reply if it is still being written (the part written so far is kept), then resolves once its
   * generation has fully stopped everywhere, so the next message can be sent safely. A reply that was already saved
   * isn't touched: this just waits for its remaining background work.
   */
  cancel(): Promise<void>;
}

interface VoiceReplyPort {
  /** Sends the words as the user's message. `onText` receives the reply streamed so far. */
  send(text: string, onText: (streamedSoFar: string) => void): VoiceReplyHandle;
}

/** Voices one reply, piece by piece as it streams. */
export interface VoiceReplySpeaker {
  /** True once any piece has been queued to speak. */
  readonly started: boolean;
  push(streamedSoFar: string): void;
  /** Speaks what is left of the saved reply and resolves once everything queued has been said. */
  finish(savedText: string | null): Promise<void>;
  /** Holds playback (mid-word if needed) until `resume()`. */
  pause(): void;
  resume(): void;
  /** Stops for good: drops pieces not yet said and their pending audio requests. */
  stop(): void;
  /** True while voice audio is actually playing. */
  isAudible(): boolean;
}

interface VoiceSpeechPort {
  /** A speaker for one reply, or null when replies are text only (no voice set up). */
  begin(turnKey: string): VoiceReplySpeaker | null;
}

export interface VoiceSessionPorts<Utterance> {
  /** Reads settings and picks the input. Throws a user-facing error when voice can't work here. */
  setup(signal: AbortSignal): Promise<VoiceSessionSetup<Utterance>>;
  reply: VoiceReplyPort;
  speech: VoiceSpeechPort;
}
