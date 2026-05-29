import { useEffect, useRef } from "react";
import type { TTSConfig } from "../../../../../engine/contracts/types/tts";
import { useChatStore } from "../../../../../shared/stores/chat.store";
import { ttsService } from "../../../../../shared/lib/tts-service";
import { buildTTSVoiceRequests, clientSidePlaybackRate } from "../../../../../shared/lib/tts-dialogue";
import { createChunkerState, extractNewSentences, extractRemainder } from "../../../../../shared/lib/sentence-chunker";

interface UseStreamingTTSOptions {
  enabled: boolean;
  chatId: string | null;
  ttsConfig: TTSConfig | undefined;
  fallbackSpeaker?: string | null;
  fallbackCharacterId?: string | null;
  resolveCharacterIdForSpeaker?: (speaker?: string | null) => string | null | undefined;
}

type StreamingTTSActiveListener = (active: boolean) => void;

let activeStopHandler: (() => void) | null = null;
const activeListeners = new Set<StreamingTTSActiveListener>();

function notifyActiveChange(): void {
  const active = activeStopHandler !== null;
  for (const listener of activeListeners) {
    listener(active);
  }
}

export function stopStreamingTTS(): void {
  activeStopHandler?.();
}

export function isStreamingTTSActive(): boolean {
  return activeStopHandler !== null;
}

export function subscribeStreamingTTSActive(listener: StreamingTTSActiveListener): () => void {
  activeListeners.add(listener);
  return () => {
    activeListeners.delete(listener);
  };
}

interface StreamingTTSSession {
  chatId: string;
  chunker: ReturnType<typeof createChunkerState>;
  chain: Promise<void>;
  abort: AbortController;
  externalSignal: AbortSignal | null;
  externalAbortListener: (() => void) | null;
  objectUrls: Set<string>;
  audios: Set<HTMLAudioElement>;
}

export function useStreamingTTS({
  enabled,
  chatId,
  ttsConfig,
  fallbackSpeaker,
  fallbackCharacterId,
  resolveCharacterIdForSpeaker,
}: UseStreamingTTSOptions): void {
  const sessionRef = useRef<StreamingTTSSession | null>(null);
  const isStreamingRef = useRef(false);
  const enabledRef = useRef(enabled);
  const configRef = useRef(ttsConfig);
  const fallbackSpeakerRef = useRef(fallbackSpeaker);
  const fallbackCharacterIdRef = useRef(fallbackCharacterId);
  const resolveCharacterIdRef = useRef(resolveCharacterIdForSpeaker);

  enabledRef.current = enabled;
  configRef.current = ttsConfig;
  fallbackSpeakerRef.current = fallbackSpeaker;
  fallbackCharacterIdRef.current = fallbackCharacterId;
  resolveCharacterIdRef.current = resolveCharacterIdForSpeaker;

  useEffect(() => {
    if (!enabled || !chatId) {
      stopStreamingTTS();
    }
  }, [enabled, chatId]);

  useEffect(() => {
    const stopSession = (): void => {
      const session = sessionRef.current;
      if (!session) return;
      sessionRef.current = null;
      if (activeStopHandler === stopSession) {
        activeStopHandler = null;
        notifyActiveChange();
      }
      if (session.externalSignal && session.externalAbortListener) {
        session.externalSignal.removeEventListener("abort", session.externalAbortListener);
      }
      session.abort.abort();
      for (const audio of session.audios) {
        audio.pause();
        audio.onended = null;
        audio.onerror = null;
        audio.src = "";
      }
      session.audios.clear();
      for (const objectUrl of session.objectUrls) {
        URL.revokeObjectURL(objectUrl);
      }
      session.objectUrls.clear();
    };

    const finishSessionAfterQueue = (session: StreamingTTSSession): void => {
      session.chain = session.chain.then(() => {
        if (sessionRef.current !== session) return;
        if (session.externalSignal && session.externalAbortListener) {
          session.externalSignal.removeEventListener("abort", session.externalAbortListener);
        }
        sessionRef.current = null;
        if (activeStopHandler === stopSession) {
          activeStopHandler = null;
          notifyActiveChange();
        }
      });
    };

    const pushText = (text: string): void => {
      const session = sessionRef.current;
      const config = configRef.current;
      if (!session || !config || !text.trim()) return;

      const requests = buildTTSVoiceRequests(
        text,
        config,
        fallbackSpeakerRef.current,
        fallbackCharacterIdRef.current,
        resolveCharacterIdRef.current,
      ).filter((request) => request.text.trim().length > 0);

      const playbackRate = clientSidePlaybackRate(config);
      for (const request of requests) {
        const fetchPromise = ttsService
          .generateAudio(request.text, {
            speaker: request.speaker,
            tone: request.tone,
            voice: request.voice,
            signal: session.abort.signal,
          })
          .catch((error: unknown) => {
            if (error instanceof Error && error.name === "AbortError") return null;
            console.warn("[streaming-tts] fetch failed:", error);
            return null;
          });

        session.chain = session.chain.then(async () => {
          if (sessionRef.current !== session) return;
          const blob = await fetchPromise;
          if (!blob || sessionRef.current !== session) return;

          const objectUrl = URL.createObjectURL(blob);
          session.objectUrls.add(objectUrl);

          const audio = new Audio(objectUrl);
          if (playbackRate > 0 && playbackRate !== 1) {
            audio.playbackRate = playbackRate;
          }
          session.audios.add(audio);

          let onAbort: (() => void) | null = null;
          try {
            await audio.play();
          } catch (error) {
            if (sessionRef.current === session) {
              console.warn("[streaming-tts] play() rejected:", error);
            }
            session.audios.delete(audio);
            URL.revokeObjectURL(objectUrl);
            session.objectUrls.delete(objectUrl);
            return;
          }

          await new Promise<void>((resolve) => {
            const cleanup = () => {
              if (onAbort) session.abort.signal.removeEventListener("abort", onAbort);
              audio.onended = null;
              audio.onerror = null;
              resolve();
            };
            audio.onended = cleanup;
            audio.onerror = cleanup;
            onAbort = () => {
              audio.pause();
              cleanup();
            };
            if (session.abort.signal.aborted) {
              onAbort();
            } else {
              session.abort.signal.addEventListener("abort", onAbort, { once: true });
            }
          });

          session.audios.delete(audio);
          URL.revokeObjectURL(objectUrl);
          session.objectUrls.delete(objectUrl);
        });
      }
    };

    const unsubscribe = useChatStore.subscribe((state) => {
      const streamingThisChat = state.isStreaming && state.streamingChatId === chatId;
      const wasStreaming = isStreamingRef.current;
      isStreamingRef.current = streamingThisChat;

      if (!enabledRef.current || !chatId) {
        stopSession();
        return;
      }

      const buffer = state.streamBuffers.get(chatId) ?? state.streamBuffer ?? "";

      if (streamingThisChat && !wasStreaming) {
        stopSession();
        const externalController = state.abortControllers.get(chatId) ?? null;
        const chunker = createChunkerState();
        chunker.cursor = buffer.length;

        const session: StreamingTTSSession = {
          chatId,
          chunker,
          chain: Promise.resolve(),
          abort: new AbortController(),
          externalSignal: externalController?.signal ?? null,
          externalAbortListener: null,
          objectUrls: new Set(),
          audios: new Set(),
        };
        sessionRef.current = session;
        activeStopHandler = stopSession;
        notifyActiveChange();

        if (session.externalSignal && !session.externalSignal.aborted) {
          const listener = () => {
            if (sessionRef.current === session) stopSession();
          };
          session.externalAbortListener = listener;
          session.externalSignal.addEventListener("abort", listener, { once: true });
        }
      }

      if (!streamingThisChat && wasStreaming) {
        const session = sessionRef.current;
        if (!session) return;
        if (session.externalSignal?.aborted) {
          stopSession();
          return;
        }
        const tail = extractRemainder(buffer, session.chunker);
        if (tail) pushText(tail);
        finishSessionAfterQueue(session);
        return;
      }

      if (streamingThisChat) {
        const session = sessionRef.current;
        if (!session) return;
        const newSentences = extractNewSentences(buffer, session.chunker);
        if (newSentences) pushText(newSentences);
      }
    });

    return () => {
      unsubscribe();
      stopSession();
    };
  }, [chatId]);
}
