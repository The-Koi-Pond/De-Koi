// ──────────────────────────────────────────────
// Hook: speak a trance session's lines with the Text to Speech voice
// ──────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTTSConfig } from "../../../../shared/hooks/use-tts";
import { getOrCreateCachedTTSAudioBlob } from "../../../../shared/lib/tts-audio-cache";
import { clientSidePlaybackRate, resolveTTSVoiceForSpeaker } from "../../../../shared/lib/tts-dialogue";
import { ttsService } from "../../../../shared/lib/tts-service";

/** Lines fetched ahead of the one being spoken, so the next one starts without a wait. */
const LOOKAHEAD = 2;
const ID_PREFIX = "trance-line:";

function hash(text: string): string {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value.toString(16);
}

export interface TranceVoiceSetup {
  /** Text to Speech is turned on in Connections. */
  available: boolean;
  /** The character has their own voice assigned (otherwise the default voice reads). */
  ownVoice: boolean;
  isLoading: boolean;
}

/** Whether read-aloud can be used, and whose voice it would be. */
export function useTranceVoiceSetup(characterId: string | null, characterName: string): TranceVoiceSetup {
  const { data: config, isLoading } = useTTSConfig();
  const available = !!config?.enabled;
  const ownVoice =
    available &&
    config.voiceMode === "per-character" &&
    (config.voiceAssignments ?? []).some(
      (entry) =>
        !!entry.voice &&
        ((!!characterId && entry.characterId === characterId) ||
          entry.characterName.trim().toLowerCase() === characterName.trim().toLowerCase()),
    );
  return { available, ownVoice, isLoading };
}

/**
 * Speaks one line at a time. `speak` starts a line (stopping the one before) and calls `onEnded` once it has played to
 * the end; a line that is stopped or replaced never calls it. Spoken lines are cached on the device, so a replayed
 * session costs nothing. `error` says why the voice stopped.
 */
export function useTranceVoice({
  enabled,
  characterId,
  characterName,
}: {
  enabled: boolean;
  characterId: string | null;
  characterName: string;
}) {
  const { data: config } = useTTSConfig();
  const active = enabled && !!config?.enabled;
  const voice = config ? resolveTTSVoiceForSpeaker(config, characterName, characterId) : "";
  const playbackRate = clientSidePlaybackRate(config);
  const keyBase = useMemo(
    () => (config ? `${config.source}|${config.baseUrl}|${config.model}|${voice}|` : ""),
    [config, voice],
  );
  const [error, setError] = useState<string | null>(null);
  const expectedId = useRef<string | null>(null);
  const playingId = useRef<string | null>(null);
  const onEnded = useRef<(() => void) | null>(null);
  const prefetch = useRef<AbortController | null>(null);
  const counter = useRef(0);

  useEffect(
    () =>
      ttsService.subscribe((state, id) => {
        if (state === "loading" || state === "playing" || state === "paused") {
          if (id) playingId.current = id;
          return;
        }
        const was = playingId.current;
        playingId.current = null;
        if (!was || was !== expectedId.current) return;
        expectedId.current = null;
        if (state === "error") {
          setError(ttsService.getLastError() ?? "The voice couldn't play.");
          return;
        }
        const done = onEnded.current;
        onEnded.current = null;
        done?.();
      }),
    [],
  );

  const cacheKey = useCallback((text: string) => `trance:${hash(keyBase + text)}:${text.length}`, [keyBase]);

  const stop = useCallback(() => {
    expectedId.current = null;
    onEnded.current = null;
    prefetch.current?.abort();
    prefetch.current = null;
    if (ttsService.getActiveId()?.startsWith(ID_PREFIX)) ttsService.stop();
  }, []);

  const speak = useCallback(
    (text: string, upcoming: readonly string[], whenEnded?: () => void) => {
      if (!active) return;
      setError(null);
      const id = `${ID_PREFIX}${(counter.current += 1)}`;
      expectedId.current = id;
      playingId.current = null;
      onEnded.current = whenEnded ?? null;
      void ttsService.speak(text, id, { voice, playbackRate, cacheKey: cacheKey(text) });
      // Fetch the next lines while this one plays; a failure there shows up when that line is spoken.
      prefetch.current?.abort();
      const controller = new AbortController();
      prefetch.current = controller;
      for (const next of upcoming.slice(0, LOOKAHEAD)) {
        getOrCreateCachedTTSAudioBlob(
          cacheKey(next),
          (signal) => ttsService.generateAudio(next, { voice, signal }),
          [],
          controller.signal,
        ).catch(() => undefined);
      }
    },
    [active, cacheKey, playbackRate, voice],
  );

  // Leaving the session stops its voice; other speech in the app is left alone.
  useEffect(() => stop, [stop]);

  return { active, speak, stop, error };
}
