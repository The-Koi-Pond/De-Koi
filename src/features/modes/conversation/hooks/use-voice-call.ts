// ──────────────────────────────────────────────
// Hook: Voice call with a Conversation character
// ──────────────────────────────────────────────
// Hands-free loop: listen until you pause → transcribe → send as your text → the character replies → read the
// reply aloud with the character's Text to Speech voice (each piece as soon as it has streamed) → listen again. Everything said stays in the chat as
// normal texts. Transcription uses the Text to Speech provider when "voice input" is on there, otherwise the
// browser's speech recognition.
import { useCallback, useEffect, useRef, useState } from "react";
import type { TTSConfig } from "../../../../engine/contracts/types/tts";
import { storageApi } from "../../../../shared/api/storage-api";
import { ttsApi } from "../../../../shared/api/tts-api";
import { getOrCreateCachedTTSAudioBlob } from "../../../../shared/lib/tts-audio-cache";
import {
  buildTTSVoiceRequests,
  clientSidePlaybackRate,
  withTTSVoiceRequestCacheKeys,
} from "../../../../shared/lib/tts-dialogue";
import { ttsService } from "../../../../shared/lib/tts-service";
import { useChatStore } from "../../../../shared/stores/chat.store";
import { StreamingSpeaker } from "../lib/voice-call-streaming-speech";
import {
  VOICE_NEEDS_HTTPS_MESSAGE,
  canRecordAudio,
  loadSpeechConfig,
  openMicrophone,
  providerSpeechInputEnabled,
  recordUtterance,
  stopStream,
} from "../../../../shared/lib/voice-recorder";

export type VoiceCallPhase = "connecting" | "listening" | "transcribing" | "thinking" | "speaking" | "ended" | "error";

export interface VoiceCallCharacter {
  id: string | null;
  name: string;
}

interface StoredMessage {
  id: string;
  role?: string;
  content?: string;
  characterId?: string | null;
  createdAt?: string;
}

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((event: { results: ArrayLike<ArrayLike<{ transcript?: string }> & { isFinal?: boolean }> }) => void)
    | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  abort: () => void;
};

function browserRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

/** One utterance through the browser's speech recognition (used when no provider transcription is set up). */
function recognizeOnce(signal: AbortSignal): Promise<string> {
  const Recognition = browserRecognition();
  if (!Recognition)
    return Promise.reject(
      new Error("This browser can't recognize speech. Turn on voice input in Connections → Text to Speech."),
    );
  return new Promise((resolve, reject) => {
    const recognition = new Recognition();
    let transcript = "";
    recognition.lang = navigator.language || "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      for (let index = 0; index < event.results.length; index += 1) {
        transcript += event.results[index]?.[0]?.transcript ?? "";
      }
    };
    recognition.onerror = (event) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      reject(new Error(`Speech recognition failed (${event.error ?? "unknown"})`));
    };
    recognition.onend = () => resolve(transcript.trim());
    signal.addEventListener("abort", () => recognition.abort(), { once: true });
    recognition.start();
  });
}

export function useVoiceCall({
  chatId,
  character,
  sendText,
}: {
  chatId: string;
  character: VoiceCallCharacter;
  /** Sends your words as a text and resolves when the character's reply is saved. */
  sendText: (text: string) => Promise<unknown>;
}) {
  const [phase, setPhase] = useState<VoiceCallPhase>("connecting");
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState("");
  const [said, setSaid] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [voiceReplies, setVoiceReplies] = useState(true);
  const controllerRef = useRef<AbortController | null>(null);
  const turnRef = useRef<AbortController | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mutedRef = useRef(false);
  mutedRef.current = muted;

  const latestReply = useCallback(
    async (sentAt: number): Promise<StoredMessage | null> => {
      const messages = await storageApi.listChatMessages<StoredMessage>(chatId);
      const replies = messages.filter(
        (message) => message.role === "assistant" && Date.parse(message.createdAt ?? "") >= sentAt - 2_000,
      );
      return replies.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).at(-1) ?? null;
    },
    [chatId],
  );

  /** A speaker for one reply: voices pieces with the character's voice as they arrive, in order. */
  const createSpeaker = useCallback(
    (config: TTSConfig | null, turnKey: string, signal: AbortSignal) =>
      new StreamingSpeaker({
        signal,
        toRequests: (text, pieceIndex) =>
          config?.enabled
            ? withTTSVoiceRequestCacheKeys(
                buildTTSVoiceRequests(text, config, character.name, character.id).filter(
                  (request) => request.text.trim().length > 0,
                ),
                config,
                `${turnKey}:${pieceIndex}`,
              )
            : [],
        prefetch: (request) => {
          void getOrCreateCachedTTSAudioBlob(
            request.cacheKey,
            () => ttsService.generateAudio(request.text, { ...request, signal }),
            request.cacheAliases,
          ).catch(() => undefined); // Reported when the piece plays and fetches it again.
        },
        play: (requests) =>
          ttsService.speakSequence(requests, turnKey, {
            signal,
            playbackRate: config ? clientSidePlaybackRate(config) : 1,
            lookahead: 1,
          }),
      }),
    [character.id, character.name],
  );

  const run = useCallback(async () => {
    const controller = new AbortController();
    controllerRef.current = controller;
    const { signal } = controller;
    try {
      const config = await loadSpeechConfig(true);
      const useProvider = providerSpeechInputEnabled(config);
      setVoiceReplies(Boolean(config?.enabled));
      if (useProvider) {
        if (!canRecordAudio()) throw new Error(VOICE_NEEDS_HTTPS_MESSAGE);
        streamRef.current = await openMicrophone();
      } else if (!browserRecognition()) {
        throw new Error(
          "Voice calls need voice input: turn it on in Connections → Text to Speech, or use a browser with speech recognition.",
        );
      }
      while (!signal.aborted) {
        if (mutedRef.current) {
          setPhase("listening");
          await new Promise((resolve) => setTimeout(resolve, 250));
          continue;
        }
        setPhase("listening");
        let text = "";
        if (useProvider && streamRef.current) {
          const audio = await recordUtterance(streamRef.current, signal, { onLevel: setLevel });
          setLevel(0);
          if (!audio) continue;
          setPhase("transcribing");
          text = await ttsApi.transcribe(audio, signal);
        } else {
          text = await recognizeOnce(signal);
        }
        if (signal.aborted) return;
        if (!text) continue;
        setHeard(text);
        setSaid("");
        setPhase("thinking");
        const sentAt = Date.now();
        // One turn can be cut off (Interrupt) without ending the call.
        const turn = new AbortController();
        turnRef.current = turn;
        const stopTurn = () => turn.abort();
        signal.addEventListener("abort", stopTurn, { once: true });
        const speaker = createSpeaker(config, `voice-call:${chatId}:${sentAt}`, turn.signal);
        // Text left in the buffer from an earlier reply isn't this one: follow only once it has been cleared.
        let armed = !useChatStore.getState().streamBuffers.get(chatId);
        const unfollow = useChatStore.subscribe((state) => {
          const streamed = state.streamBuffers.get(chatId);
          if (!armed) {
            armed = !streamed;
            return;
          }
          if (!streamed) return;
          setSaid(streamed);
          speaker.push(streamed);
          if (speaker.started && !turn.signal.aborted) setPhase("speaking");
        });
        try {
          await sendText(text);
        } catch (caught) {
          turn.abort(); // Nothing already queued keeps talking over the error.
          throw caught;
        } finally {
          unfollow();
        }
        if (signal.aborted) return;
        const reply = await latestReply(sentAt);
        if (reply?.content) setSaid(reply.content);
        if ((reply || speaker.started) && !turn.signal.aborted) setPhase("speaking");
        await speaker.finish(reply?.content ?? null);
        signal.removeEventListener("abort", stopTurn);
      }
    } catch (caught) {
      if (signal.aborted || (caught instanceof DOMException && caught.name === "AbortError")) return;
      setError(caught instanceof Error ? caught.message : "The call dropped.");
      setPhase("error");
    } finally {
      stopStream(streamRef.current);
      streamRef.current = null;
    }
  }, [chatId, createSpeaker, latestReply, sendText]);

  useEffect(() => {
    void run();
    return () => {
      controllerRef.current?.abort();
      ttsService.stop();
    };
  }, [run]);

  const hangUp = useCallback(() => {
    controllerRef.current?.abort();
    ttsService.stop();
    setPhase("ended");
  }, []);

  /** Cut the character off (including pieces still waiting to be said) and go back to listening. */
  const interrupt = useCallback(() => {
    turnRef.current?.abort();
    ttsService.stop();
    // The rest of the reply may still be arriving (it is saved as a text); it just won't be read out.
    setPhase((current) => (current === "speaking" ? "thinking" : current));
  }, []);

  return { phase, level, heard, said, error, muted, setMuted, voiceReplies, hangUp, interrupt };
}
