// ──────────────────────────────────────────────
// Scene sound player: a looping ambient bed and one-shot effects, mixed with Web Audio
// ──────────────────────────────────────────────
import { ttsApi } from "../api/tts-api";
import { soundEffectCacheKey } from "./sound-effects";
import { getOrCreateCachedTTSAudioBlob } from "./tts-audio-cache";

interface SceneSoundRequest {
  /** Stable id of the sound (an ambient bed or effect id). */
  id: string;
  /** What the provider is asked to make. */
  description: string;
  /** Fixed clip length for ambient beds. */
  durationSeconds?: number;
}

interface SceneSoundPlayerState {
  /** The browser hasn't allowed sound yet (autoplay rules): it starts on the next tap or key press. */
  locked: boolean;
  /** The ambient bed that should be playing, once it has loaded and the page may play sound. */
  ambientId: string | null;
  /** Why sounds can't be made right now. The player makes no more requests until `retry()`. */
  error: unknown;
}

/** How long one bed takes to fade into the next. */
const AMBIENT_FADE_SECONDS = 3;
/** Overlap between the end of an ambient clip and its next repeat, so the loop has no seam. */
const LOOP_CROSSFADE_SECONDS = 2;
/** Schedule the next repeat this far ahead. */
const LOOP_LOOKAHEAD_SECONDS = 4;
const MAX_DECODED_SOUNDS = 24;

function equalPowerCurve(direction: "in" | "out"): Float32Array {
  const points = 64;
  const curve = new Float32Array(points);
  for (let index = 0; index < points; index += 1) {
    const angle = (index / (points - 1)) * (Math.PI / 2);
    curve[index] = direction === "in" ? Math.sin(angle) : Math.cos(angle);
  }
  return curve;
}

const FADE_IN = equalPowerCurve("in");
const FADE_OUT = equalPowerCurve("out");

/** Plays `buffer` on repeat, each repeat crossfading into the next. Returns a stop function. */
function startCrossfadeLoop(context: AudioContext, buffer: AudioBuffer, destination: AudioNode): () => void {
  const fade = Math.min(LOOP_CROSSFADE_SECONDS, buffer.duration / 4);
  const period = Math.max(0.1, buffer.duration - fade);
  const sources = new Set<AudioBufferSourceNode>();
  let nextStart = context.currentTime + 0.05;
  let first = true;

  const scheduleRepeat = () => {
    const source = context.createBufferSource();
    source.buffer = buffer;
    const gain = context.createGain();
    source.connect(gain).connect(destination);
    const start = nextStart;
    if (first) gain.gain.setValueAtTime(1, start);
    else gain.gain.setValueCurveAtTime(FADE_IN, start, fade);
    gain.gain.setValueCurveAtTime(FADE_OUT, start + buffer.duration - fade, fade);
    source.start(start);
    source.stop(start + buffer.duration);
    source.onended = () => {
      sources.delete(source);
      gain.disconnect();
    };
    sources.add(source);
    first = false;
    nextStart = start + period;
  };
  const pump = () => {
    while (nextStart - context.currentTime < LOOP_LOOKAHEAD_SECONDS) scheduleRepeat();
  };
  pump();
  const timer = setInterval(pump, 1000);

  return () => {
    clearInterval(timer);
    for (const source of sources) {
      source.onended = null;
      source.stop();
      source.disconnect();
    }
    sources.clear();
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

interface PlayingBed {
  id: string;
  gain: GainNode;
  stop: () => void;
}

class SceneSoundPlayer {
  private context: AudioContext | null = null;
  private ambientBus: GainNode | null = null;
  private effectsBus: GainNode | null = null;
  private volumes = { ambient: 0.35, effects: 0.6 };
  private wantedAmbient: SceneSoundRequest | null = null;
  private ambientLoad: AbortController | null = null;
  private bed: PlayingBed | null = null;
  private decoded = new Map<string, AudioBuffer>();
  private state: SceneSoundPlayerState = { locked: false, ambientId: null, error: null };
  private listeners = new Set<() => void>();
  private gestureListening = false;

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): SceneSoundPlayerState {
    return this.state;
  }

  private update(patch: Partial<SceneSoundPlayerState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  setVolumes(ambient: number, effects: number) {
    this.volumes = { ambient, effects };
    const context = this.context;
    if (!context) return;
    this.ambientBus?.gain.setTargetAtTime(ambient, context.currentTime, 0.1);
    this.effectsBus?.gain.setTargetAtTime(effects, context.currentTime, 0.1);
  }

  /** Fades to `request`'s bed, or to silence. Asking for the bed already playing does nothing. */
  setAmbient(request: SceneSoundRequest | null) {
    if ((request?.id ?? null) === (this.wantedAmbient?.id ?? null)) return;
    this.wantedAmbient = request;
    this.ambientLoad?.abort();
    this.ambientLoad = null;
    this.update({ ambientId: request?.id ?? null });
    if (!request) {
      this.fadeOutBed();
      return;
    }
    if (this.state.error) return;
    void this.startBed(request);
  }

  /** Plays one effect over the bed. Skipped while the browser hasn't allowed sound, so it never plays late. */
  playEffect(request: SceneSoundRequest) {
    if (this.state.error) return;
    const context = this.ensureContext();
    if (!context || context.state !== "running") return;
    void this.load(request)
      .then((buffer) => {
        if (!this.effectsBus || context.state !== "running") return;
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(this.effectsBus);
        source.onended = () => source.disconnect();
        source.start();
      })
      .catch((error: unknown) => this.fail(error));
  }

  /** Starts sound after the browser blocked it. Call from a tap or click. */
  async unlock(): Promise<void> {
    const context = this.ensureContext();
    if (!context) return;
    await context.resume();
    this.update({ locked: context.state !== "running" });
  }

  /** Clears an error and tries the wanted bed again. */
  retry() {
    this.update({ error: null });
    const wanted = this.wantedAmbient;
    if (wanted && this.bed?.id !== wanted.id) void this.startBed(wanted);
  }

  /** Silences everything (leaving a roleplay or turning scene sound off). */
  stop() {
    this.wantedAmbient = null;
    this.ambientLoad?.abort();
    this.ambientLoad = null;
    this.fadeOutBed();
    this.update({ ambientId: null, error: null });
  }

  private ensureContext(): AudioContext | null {
    if (this.context) return this.context;
    if (typeof AudioContext === "undefined") {
      this.fail(new Error("This browser can't play scene sound."));
      return null;
    }
    const context = new AudioContext();
    this.ambientBus = context.createGain();
    this.ambientBus.gain.value = this.volumes.ambient;
    this.ambientBus.connect(context.destination);
    this.effectsBus = context.createGain();
    this.effectsBus.gain.value = this.volumes.effects;
    this.effectsBus.connect(context.destination);
    context.onstatechange = () => {
      const locked = context.state !== "running" && context.state !== "closed";
      if (locked) this.listenForGesture();
      this.update({ locked });
    };
    this.context = context;
    if (context.state !== "running") {
      this.update({ locked: true });
      this.listenForGesture();
      // Allowed without a tap on most desktops; on phones it waits for the gesture listener or the "tap" chip.
      void context.resume();
    }
    return context;
  }

  /** Any tap or key press on the page counts as permission to play, so sending a message also starts the sound. */
  private listenForGesture() {
    if (this.gestureListening || typeof window === "undefined") return;
    this.gestureListening = true;
    const onGesture = () => {
      window.removeEventListener("pointerdown", onGesture, true);
      window.removeEventListener("keydown", onGesture, true);
      this.gestureListening = false;
      void this.unlock();
    };
    window.addEventListener("pointerdown", onGesture, true);
    window.addEventListener("keydown", onGesture, true);
  }

  private async startBed(request: SceneSoundRequest) {
    const context = this.ensureContext();
    if (!context || !this.ambientBus) return;
    const controller = new AbortController();
    this.ambientLoad = controller;
    let buffer: AudioBuffer;
    try {
      buffer = await this.load(request, controller.signal);
    } catch (error) {
      if (!controller.signal.aborted && !isAbortError(error)) this.fail(error);
      return;
    }
    if (controller.signal.aborted || this.wantedAmbient?.id !== request.id) return;
    this.ambientLoad = null;
    this.fadeOutBed();
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, context.currentTime);
    gain.gain.linearRampToValueAtTime(1, context.currentTime + AMBIENT_FADE_SECONDS);
    gain.connect(this.ambientBus);
    this.bed = { id: request.id, gain, stop: startCrossfadeLoop(context, buffer, gain) };
  }

  private fadeOutBed() {
    const bed = this.bed;
    const context = this.context;
    if (!bed || !context) return;
    this.bed = null;
    const now = context.currentTime;
    bed.gain.gain.cancelScheduledValues(now);
    bed.gain.gain.setValueAtTime(bed.gain.gain.value, now);
    bed.gain.gain.linearRampToValueAtTime(0, now + AMBIENT_FADE_SECONDS);
    setTimeout(
      () => {
        bed.stop();
        bed.gain.disconnect();
      },
      AMBIENT_FADE_SECONDS * 1000 + 100,
    );
  }

  private async load(request: SceneSoundRequest, signal?: AbortSignal): Promise<AudioBuffer> {
    const context = this.ensureContext();
    if (!context) throw new Error("This browser can't play scene sound.");
    const key = soundEffectCacheKey(request.description, request.durationSeconds);
    const ready = this.decoded.get(key);
    if (ready) return ready;
    const blob = await getOrCreateCachedTTSAudioBlob(
      key,
      (requestSignal) =>
        ttsApi.speak(
          {
            text: request.description,
            kind: "sound_effect",
            ...(request.durationSeconds ? { durationSeconds: request.durationSeconds } : {}),
          },
          requestSignal,
        ),
      [],
      signal,
    );
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    this.decoded.set(key, buffer);
    while (this.decoded.size > MAX_DECODED_SOUNDS) {
      const oldest = this.decoded.keys().next().value;
      if (oldest === undefined) break;
      this.decoded.delete(oldest);
    }
    return buffer;
  }

  private fail(error: unknown) {
    this.update({ error });
  }
}

export const sceneSoundPlayer = new SceneSoundPlayer();
