// ──────────────────────────────────────────────
// TTS Service — Server-proxied audio playback
// ──────────────────────────────────────────────
import { ttsApi } from "../api/integration-utility-api";

export type TTSState = "idle" | "loading" | "playing" | "paused" | "error";

type StateListener = (state: TTSState, activeId: string | null) => void;

export interface TTSSpeakOptions {
  speaker?: string;
  tone?: string;
  voice?: string;
  signal?: AbortSignal;
  throwOnError?: boolean;
  playbackRate?: number;
}

class TTSService {
  private audio: HTMLAudioElement | null = null;
  private currentObjectUrl: string | null = null;
  private abortController: AbortController | null = null;
  private state: TTSState = "idle";
  private lastError: string | null = null;
  private sequence = 0;
  /** ID of the entity (e.g. message id) currently being spoken */
  private activeId: string | null = null;
  private listeners = new Set<StateListener>();

  // ── Listeners ─────────────────────────────────

  subscribe(fn: StateListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getState(): TTSState {
    return this.state;
  }

  getActiveId(): string | null {
    return this.activeId;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  private setState(s: TTSState, id: string | null = this.activeId) {
    this.state = s;
    this.activeId = s === "idle" || s === "error" ? null : id;
    this.listeners.forEach((fn) => fn(this.state, this.activeId));
  }

  private isCurrentSequence(sequence: number): boolean {
    return this.sequence === sequence;
  }

  // ── Playback ──────────────────────────────────

  async generateAudio(text: string, options: TTSSpeakOptions = {}): Promise<Blob> {
    return ttsApi.speak(
      {
        text,
        ...(options.speaker ? { speaker: options.speaker } : {}),
        ...(options.tone ? { tone: options.tone } : {}),
        ...(options.voice ? { voice: options.voice } : {}),
      },
      options.signal,
    );
  }

  /** Speak the given text. `id` is an optional caller-supplied key (e.g. message id) so callers can track which item is active. */
  async speak(text: string, id?: string, options: TTSSpeakOptions = {}): Promise<void> {
    this.stop();
    const sequence = ++this.sequence;
    this.lastError = null;

    this.setState("loading", id ?? null);
    const abortController = new AbortController();
    this.abortController = abortController;

    let blob: Blob;
    try {
      blob = await this.generateAudio(text, { ...options, signal: abortController.signal });
    } catch (err) {
      if (!this.isCurrentSequence(sequence)) return;
      if (err instanceof Error && err.name === "AbortError") {
        this.setState("idle");
        return;
      }
      const error = err instanceof Error ? err : new Error("TTS request failed");
      this.lastError = error.message;
      this.setState("error");
      if (options.throwOnError) throw error;
      return;
    }

    if (!this.isCurrentSequence(sequence)) return;
    if (this.abortController === abortController) {
      this.abortController = null;
    }

    const objectUrl = URL.createObjectURL(blob);
    if (!this.isCurrentSequence(sequence)) {
      URL.revokeObjectURL(objectUrl);
      return;
    }
    this.currentObjectUrl = objectUrl;

    const audio = new Audio(objectUrl);
    if (options.playbackRate && options.playbackRate > 0 && options.playbackRate !== 1) {
      audio.playbackRate = options.playbackRate;
    }
    this.audio = audio;

    audio.onended = () => {
      if (!this.isCurrentSequence(sequence) || this.audio !== audio) return;
      this.cleanup();
      this.setState("idle");
    };
    audio.onerror = () => {
      if (!this.isCurrentSequence(sequence) || this.audio !== audio) return;
      this.cleanup();
      this.setState("error");
    };

    this.setState("playing", id ?? null);
    try {
      await audio.play();
    } catch (err) {
      if (!this.isCurrentSequence(sequence) || this.audio !== audio) return;
      this.cleanup();
      const error = err instanceof Error ? err : new Error("Browser blocked audio playback");
      this.lastError = error.message;
      this.setState("error");
      if (options.throwOnError) throw error;
    }
  }

  /** Stop any in-progress fetch or playback. */
  stop(): void {
    this.sequence += 1;
    this.abortController?.abort();
    this.abortController = null;

    if (this.audio) {
      this.audio.pause();
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio = null;
    }

    this.cleanup();
    this.lastError = null;
    this.setState("idle");
  }

  /** Pause the current generated audio without clearing it. */
  pause(): void {
    if (this.state !== "playing" || !this.audio) return;
    this.audio.pause();
    this.setState("paused");
  }

  /** Resume paused generated audio. */
  resume(): void {
    if (this.state !== "paused" || !this.audio) return;
    const audio = this.audio;
    this.setState("playing");
    void audio.play().catch((err) => {
      if (this.audio !== audio) return;
      this.cleanup();
      const error = err instanceof Error ? err : new Error("Browser blocked audio playback");
      this.lastError = error.message;
      this.setState("error");
    });
  }

  /** Restart the current generated audio from the beginning. */
  restart(): void {
    if (!this.audio || (this.state !== "playing" && this.state !== "paused")) return;
    const audio = this.audio;
    audio.currentTime = 0;
    this.setState("playing");
    void audio.play().catch((err) => {
      if (this.audio !== audio) return;
      this.cleanup();
      const error = err instanceof Error ? err : new Error("Browser blocked audio playback");
      this.lastError = error.message;
      this.setState("error");
    });
  }

  private cleanup(): void {
    if (this.currentObjectUrl) {
      URL.revokeObjectURL(this.currentObjectUrl);
      this.currentObjectUrl = null;
    }
  }
}

export const ttsService = new TTSService();
