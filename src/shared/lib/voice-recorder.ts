// ──────────────────────────────────────────────
// Voice capture for dictation and voice calls
// ──────────────────────────────────────────────
// Records the microphone with MediaRecorder for provider speech-to-text (ttsApi.transcribe). Voice calls use
// `recordUtterance`, which waits for speech and stops after a pause, measured with a WebAudio level meter.
import type { TTSConfig } from "../../engine/contracts/types/tts";
import { ttsApi } from "../api/tts-api";

const CONFIG_CACHE_MS = 30_000;
let configCache: { at: number; config: TTSConfig | null } | null = null;

export async function loadSpeechConfig(force = false): Promise<TTSConfig | null> {
  if (!force && configCache && Date.now() - configCache.at < CONFIG_CACHE_MS) return configCache.config;
  let config: TTSConfig | null = null;
  try {
    config = await ttsApi.config();
  } catch (error) {
    console.warn("[voice] could not read speech settings; using the browser's speech recognition", error);
  }
  configCache = { at: Date.now(), config };
  return config;
}

/** True when voice input should go to the Text to Speech provider (set in Connections → Text to Speech). */
export function providerSpeechInputEnabled(config: TTSConfig | null): boolean {
  return Boolean(config?.speechInputProvider && config.source !== "pockettts" && config.apiKey);
}

/** Microphone recording needs a secure page (https or localhost) and MediaRecorder. */
export function canRecordAudio(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof MediaRecorder !== "undefined"
  );
}

export const VOICE_NEEDS_HTTPS_MESSAGE =
  "Voice needs De-Koi on an https:// address (or localhost). Plain http pages can't use the microphone.";

function preferredMimeType(): string | undefined {
  for (const type of ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"]) {
    if (MediaRecorder.isTypeSupported?.(type)) return type;
  }
  return undefined;
}

export async function openMicrophone(): Promise<MediaStream> {
  if (!canRecordAudio()) throw new Error(VOICE_NEEDS_HTTPS_MESSAGE);
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
}

export function stopStream(stream: MediaStream | null | undefined): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

/** Starts recording; `stop()` resolves with the audio. Used by the dictation button. */
export function startRecording(stream: MediaStream): { stop: () => Promise<Blob> } {
  const mimeType = preferredMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.start(250);
  return {
    stop: () =>
      new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" }));
        if (recorder.state !== "inactive") recorder.stop();
        else resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
      }),
  };
}

export interface UtteranceOptions {
  /** Level (0-1 RMS) that counts as speech. */
  speechLevel?: number;
  /** Silence after speech that ends the utterance. */
  endSilenceMs?: number;
  /** Give up when nobody speaks for this long (resolves null). */
  maxWaitMs?: number;
  maxUtteranceMs?: number;
  /** Live input level for the call screen's meter. */
  onLevel?: (level: number) => void;
  /** Fires when speech starts (the call screen uses it to interrupt the character). */
  onSpeechStart?: () => void;
  /**
   * Checked on every frame until speech starts. While it returns true (the character's voice is playing), speech
   * has to be louder and last longer to count, so the speakers don't start an utterance.
   */
  guarded?: () => boolean;
}

/** While guarded, speech has to be this many times louder than `speechLevel`... */
const GUARDED_LEVEL_FACTOR = 2;
/**
 * ...in this many of the last `GUARDED_WINDOW_FRAMES` frames (50 ms each). Not in a row: real speech dips between
 * words, and "8 in a row" took 2.5 s to notice someone talking.
 */
const GUARDED_LOUD_FRAMES = 4;
const GUARDED_WINDOW_FRAMES = 6;
/** Unguarded, speech starts after this many loud frames in a row. */
const LOUD_FRAMES = 4;

/**
 * Fed one level per 50 ms frame; returns true on the frame where speech counts as started. Guarded frames (the
 * reply's voice is playing) need louder speech in most of a short window; others need a few loud frames in a row.
 */
export function createSpeechStartDetector(speechLevel: number): (level: number, guarded: boolean) => boolean {
  let loudInARow = 0;
  const recentGuardedLoud: boolean[] = [];
  return (level, guarded) => {
    loudInARow = level >= speechLevel ? loudInARow + 1 : 0;
    recentGuardedLoud.push(level >= speechLevel * GUARDED_LEVEL_FACTOR);
    if (recentGuardedLoud.length > GUARDED_WINDOW_FRAMES) recentGuardedLoud.shift();
    return guarded ? recentGuardedLoud.filter(Boolean).length >= GUARDED_LOUD_FRAMES : loudInARow >= LOUD_FRAMES;
  };
}

/**
 * Waits for the user to speak, records until they pause, and resolves with the audio (or null if they never
 * spoke within `maxWaitMs`). Rejects with an AbortError when `signal` aborts.
 */
export function recordUtterance(
  stream: MediaStream,
  signal: AbortSignal,
  options: UtteranceOptions = {},
): Promise<Blob | null> {
  const speechLevel = options.speechLevel ?? 0.035;
  const endSilenceMs = options.endSilenceMs ?? 1_100;
  const maxWaitMs = options.maxWaitMs ?? 60_000;
  const maxUtteranceMs = options.maxUtteranceMs ?? 45_000;
  return new Promise((resolve, reject) => {
    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const recording = startRecording(stream);
    const startedAt = performance.now();
    let speechStartedAt: number | null = null;
    let lastSpeechAt = 0;
    const speechStarts = createSpeechStartDetector(speechLevel);
    let settled = false;

    const finish = async (result: "speech" | "silence" | "abort") => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      signal.removeEventListener("abort", onAbort);
      const audio = await recording.stop();
      source.disconnect();
      void context.close();
      if (result === "abort") reject(new DOMException("Voice capture stopped", "AbortError"));
      else resolve(result === "speech" ? audio : null);
    };
    const onAbort = () => void finish("abort");
    signal.addEventListener("abort", onAbort, { once: true });

    const tick = () => {
      if (settled) return;
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      const level = Math.sqrt(sum / samples.length);
      options.onLevel?.(Math.min(1, level * 8));
      const now = performance.now();
      if (level >= speechLevel) lastSpeechAt = now;
      // A few loud frames, so a click or a cough doesn't start an utterance.
      const started = speechStarts(level, speechStartedAt === null && options.guarded?.() === true);
      if (speechStartedAt === null && started) {
        speechStartedAt = now;
        options.onSpeechStart?.();
      }
      if (speechStartedAt !== null && (now - lastSpeechAt > endSilenceMs || now - speechStartedAt > maxUtteranceMs)) {
        void finish("speech");
        return;
      }
      if (speechStartedAt === null && now - startedAt > maxWaitMs) {
        void finish("silence");
      }
    };
    // A timer rather than animation frames, which stop while the page is in the background.
    const timer = setInterval(tick, 50);
  });
}
