// ──────────────────────────────────────────────
// Voice calls: thinking sounds in the character's voice
// ──────────────────────────────────────────────
// While a reply is being written the call would be silent for several seconds. A short "Hmm…" in the character's
// own voice fills that like a person on the line would. The sounds are made through Text to Speech when the call
// connects and kept in the voice-line cache, so each voice pays for them once; one is only offered once its audio
// is ready, because a sound that arrives late would land on top of the reply.
import type { VoiceThinkingSound } from "../../../../engine/capabilities/voice";
import type { TTSConfig } from "../../../../engine/contracts/types/tts";
import { getOrCreateCachedTTSAudioBlob } from "../../../../shared/lib/tts-audio-cache";
import {
  buildTTSVoiceRequests,
  clientSidePlaybackRate,
  withTTSVoiceRequestCacheKeys,
  type CachedTTSVoiceRequest,
} from "../../../../shared/lib/tts-dialogue";
import { ttsService } from "../../../../shared/lib/tts-service";

const THINKING_SOUND_TEXTS = ["Hmm...", "Mm...", "Hm, okay..."] as const;
/** Fixed, so each voice's sounds keep the same cache entry across calls. */
const CACHE_MESSAGE_ID = "voice-call-thinking-sound";

export interface VoiceCallThinkingSounds {
  /** A sound whose audio is ready, or null. Never the same one twice in a row when there's a choice. */
  next(): VoiceThinkingSound | null;
  /** Resolves once no thinking sound is playing (at once when none is). */
  idle(): Promise<void>;
}

let nextPlayId = 1;

/** Plays one cached line through the shared player; resolves when it ends or is stopped. */
function playLine(request: CachedTTSVoiceRequest, id: string, config: TTSConfig): Promise<void> {
  return new Promise((resolve) => {
    let seen = false;
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      unsubscribe();
      resolve();
    };
    // The player reports this id while it loads and plays the line; once it reports anything else, it's over.
    const unsubscribe = ttsService.subscribe((_state, activeId) => {
      if (activeId === id) seen = true;
      else if (seen) done();
    });
    void ttsService
      .speak(request.text, id, {
        speaker: request.speaker,
        tone: request.tone,
        voice: request.voice,
        cacheKey: request.cacheKey,
        cacheAliases: request.cacheAliases,
        playbackRate: clientSidePlaybackRate(config),
      })
      .then(() => {
        if (ttsService.getActiveId() !== id) done();
      });
  });
}

/**
 * Starts making `character`'s thinking sounds and offers them once ready. `signal` ends the preparation (hang-up);
 * sounds already made stay cached for the next call.
 */
export function prepareThinkingSounds(
  config: TTSConfig,
  character: { id: string | null; name: string },
  signal: AbortSignal,
): VoiceCallThinkingSounds {
  const ready: CachedTTSVoiceRequest[] = [];
  for (const text of THINKING_SOUND_TEXTS) {
    const [request] = withTTSVoiceRequestCacheKeys(
      buildTTSVoiceRequests(text, config, character.name, character.id).filter((line) => line.text.trim()),
      config,
      `${CACHE_MESSAGE_ID}:${text}`,
    );
    // Settings that leave nothing to say for a plain "Hmm" (dialogue-only reading) offer no sounds.
    if (!request) continue;
    void getOrCreateCachedTTSAudioBlob(
      request.cacheKey,
      (shared) => ttsService.generateAudio(request.text, { ...request, signal: shared }),
      request.cacheAliases,
      signal,
    ).then(
      () => ready.push(request),
      (error: unknown) => {
        if (!signal.aborted)
          console.warn("[voice call] a thinking sound couldn't be made; the call goes on without it", error);
      },
    );
  }

  let lastText = "";
  let playing: Promise<void> = Promise.resolve();
  return {
    next: () => {
      if (signal.aborted || ready.length === 0) return null;
      const choices = ready.length > 1 ? ready.filter((request) => request.text !== lastText) : ready;
      const request = choices[Math.floor(Math.random() * choices.length)]!;
      lastText = request.text;
      const id = `voice-call-thinking:${nextPlayId++}`;
      return {
        text: request.text,
        play: () => {
          playing = playLine(request, id, config);
          return playing;
        },
        stop: () => ttsService.stop(id),
      };
    },
    idle: () => playing,
  };
}
