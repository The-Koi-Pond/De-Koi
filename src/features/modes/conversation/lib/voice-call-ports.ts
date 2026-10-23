// ──────────────────────────────────────────────
// Voice calls: binds the voice session's ports for a Conversation chat
// ──────────────────────────────────────────────
// Microphone → the browser's audio APIs (voice-recorder). Transcription → the Text to Speech provider, or the
// browser's own speech recognition when provider voice input is off. Reply → the normal send pipeline, followed
// through the chat store. Speaker → Text to Speech with the character's voice, piece by piece as the reply streams.
import type {
  VoiceMicrophone,
  VoiceRecorderInput,
  VoiceReplyHandle,
  VoiceReplySpeaker,
  VoiceSessionPorts,
} from "../../../../engine/capabilities/voice";
import type { TTSConfig } from "../../../../engine/contracts/types/tts";
import { generationRunnerApi, generationRunnerAvailable } from "../../../../shared/api/generation-runner-api";
import { hasEmbeddedTauriRuntime } from "../../../../shared/api/remote-runtime";
import { storageApi } from "../../../../shared/api/storage-api";
import { holdChatAutoplay } from "../../../../shared/lib/chat-autoplay-hold";
import { ttsApi } from "../../../../shared/api/tts-api";
import { getOrCreateCachedTTSAudioBlob } from "../../../../shared/lib/tts-audio-cache";
import {
  buildTTSVoiceRequests,
  clientSidePlaybackRate,
  withTTSVoiceRequestCacheKeys,
} from "../../../../shared/lib/tts-dialogue";
import { ttsService } from "../../../../shared/lib/tts-service";
import {
  VOICE_NEEDS_HTTPS_MESSAGE,
  canRecordAudio,
  loadSpeechConfig,
  openMicrophone,
  providerSpeechInputEnabled,
  recordUtterance,
  stopStream,
} from "../../../../shared/lib/voice-recorder";
import { useChatStore } from "../../../../shared/stores/chat.store";
import { StreamingSpeaker } from "./voice-call-streaming-speech";

export interface VoiceCallCharacter {
  id: string | null;
  name: string;
}

export interface VoiceCallContext {
  chatId: string;
  character: VoiceCallCharacter;
  /** Sends the words as a text. Resolves once the reply has finished: false when no reply came. */
  sendText: (text: string) => Promise<boolean>;
}

interface StoredMessage {
  id: string;
  role?: string;
  content?: string;
  createdAt?: string;
}

/** A fresh recording starts after this long with nobody talking, so a recording never carries much silence. */
const LISTEN_WINDOW_MS = 15_000;
/** Pieces of the reply whose audio is fetched ahead of the one playing. */
const PREFETCH_AHEAD = 2;
const RUNNER_STOP_TIMEOUT_MS = 15_000;
const RUNNER_STOP_POLL_MS = 200;

const MIC_BLOCKED_MESSAGE =
  "De-Koi can't use the microphone: it's blocked for this site. Allow it in the browser's site settings, then call again.";
const NO_RECOGNITION_MESSAGE =
  "Voice calls need voice input: turn it on in Connections → Text to Speech, or use a browser with speech recognition.";
const DESKTOP_NEEDS_PROVIDER_INPUT_MESSAGE =
  "Voice calls in the desktop app need voice input from your Text to Speech provider: turn it on in Connections → Text to Speech.";

// ── Input ─────────────────────────────────────

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

function recognitionErrorMessage(code: string | undefined): string {
  if (code === "not-allowed" || code === "service-not-allowed") {
    return typeof window !== "undefined" && !window.isSecureContext ? VOICE_NEEDS_HTTPS_MESSAGE : MIC_BLOCKED_MESSAGE;
  }
  return `Speech recognition failed (${code ?? "unknown"})`;
}

/** One utterance through the browser's speech recognition. */
function recognizeOnce(Recognition: new () => SpeechRecognitionLike, signal: AbortSignal): Promise<string> {
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
      reject(new Error(recognitionErrorMessage(event.error)));
    };
    recognition.onend = () => resolve(transcript.trim());
    signal.addEventListener("abort", () => recognition.abort(), { once: true });
    recognition.start();
  });
}

/** Who hears recorded speech, for the mic indicator. */
function speechDestination(config: TTSConfig): string {
  if (config.source === "elevenlabs") return "ElevenLabs";
  try {
    const host = new URL(config.baseUrl).hostname;
    return host === "api.openai.com" ? "OpenAI" : host;
  } catch {
    return "your speech provider";
  }
}

function microphoneErrorMessage(error: unknown): string {
  const name = typeof error === "object" && error !== null ? (error as { name?: unknown }).name : undefined;
  if (name === "NotAllowedError" || name === "SecurityError") return MIC_BLOCKED_MESSAGE;
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone was found on this device.";
  if (name === "NotReadableError" || name === "AbortError") {
    return "The microphone couldn't start (another app may be using it).";
  }
  return error instanceof Error && error.message ? error.message : "The microphone couldn't start.";
}

function microphoneFor(stream: MediaStream): VoiceMicrophone<Blob> {
  return {
    listen: ({ signal, guarded, onLevel, onSpeechStart }) =>
      recordUtterance(stream, signal, { guarded, onLevel, onSpeechStart, maxWaitMs: LISTEN_WINDOW_MS }),
    onEnded: (listener) => {
      const tracks = stream.getAudioTracks();
      const onEnded = () => listener();
      for (const track of tracks) track.addEventListener("ended", onEnded);
      return () => {
        for (const track of tracks) track.removeEventListener("ended", onEnded);
      };
    },
    close: () => stopStream(stream),
  };
}

function recorderInput(config: TTSConfig): VoiceRecorderInput<Blob> {
  return {
    kind: "recorder",
    destination: speechDestination(config),
    open: async () => {
      let stream: MediaStream;
      try {
        stream = await openMicrophone();
      } catch (error) {
        throw new Error(microphoneErrorMessage(error));
      }
      return microphoneFor(stream);
    },
    transcribe: (audio, signal) => ttsApi.transcribe(audio, signal),
  };
}

// ── Reply ─────────────────────────────────────

async function latestReply(chatId: string, sentAt: number): Promise<StoredMessage | null> {
  const messages = await storageApi.listChatMessages<StoredMessage>(chatId);
  const replies = messages.filter(
    (message) => message.role === "assistant" && Date.parse(message.createdAt ?? "") >= sentAt - 2_000,
  );
  return replies.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).at(-1) ?? null;
}

/** Resolves once no reply is being written in this chat in this tab. */
function chatReplyFinished(chatId: string): Promise<void> {
  if (!useChatStore.getState().abortControllers.has(chatId)) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = useChatStore.subscribe((state) => {
      if (state.abortControllers.has(chatId)) return;
      stop();
      resolve();
    });
  });
}

/**
 * A cancelled reply on the hosted runner keeps running there until it has saved what it wrote, and the runner
 * refuses a new reply for the chat until then. Wait for that instead of failing the next message.
 */
async function runnerReplyStopped(chatId: string): Promise<void> {
  if (!(await generationRunnerAvailable())) return;
  const deadline = Date.now() + RUNNER_STOP_TIMEOUT_MS;
  for (;;) {
    const jobs = await generationRunnerApi.list(chatId);
    if (!jobs.some((job) => job.status === "running")) return;
    if (Date.now() >= deadline) {
      throw new Error("The cut-off reply is still stopping on the De-Koi server. Hang up and call again in a moment.");
    }
    await new Promise((resolve) => setTimeout(resolve, RUNNER_STOP_POLL_MS));
  }
}

function sendReply(
  context: () => VoiceCallContext,
  text: string,
  onText: (streamed: string) => void,
): VoiceReplyHandle {
  const { chatId, sendText } = context();
  const before = useChatStore.getState();
  const earlierController = before.abortControllers.get(chatId) ?? null;
  // Text left in the buffer from an earlier reply isn't this one: follow only once it has been cleared.
  let armed = !before.streamBuffers.get(chatId);
  let lastStreamed = "";
  let replyController: AbortController | null = null;
  let cancelRequested = false;
  let cancelledHere = false;

  const abortReply = (controller: AbortController) => {
    if (controller.signal.aborted) return;
    controller.abort();
    cancelledHere = true;
  };
  const follow = (state: ReturnType<typeof useChatStore.getState>) => {
    const controller = state.abortControllers.get(chatId) ?? null;
    if (controller && controller !== earlierController && !replyController) {
      replyController = controller;
      if (cancelRequested) abortReply(controller);
    }
    const streamed = state.streamBuffers.get(chatId) ?? "";
    if (!armed) {
      armed = !streamed;
      return;
    }
    if (!streamed || streamed === lastStreamed) return;
    lastStreamed = streamed;
    onText(streamed);
  };
  const unfollow = useChatStore.subscribe(follow);
  // The call voices this reply itself; the chat's autoplay must not read it again, even after a hang-up.
  const releaseAutoplay = holdChatAutoplay(chatId);

  const done = (async () => {
    const sentAt = Date.now();
    try {
      // A reply already being written here (sent just before the call started) goes first.
      await chatReplyFinished(chatId);
      const replied = await sendText(text);
      if (!replied) return null;
    } finally {
      unfollow();
    }
    const reply = await latestReply(chatId, sentAt);
    return reply?.content ?? null;
  })();
  done.catch(() => undefined).finally(releaseAutoplay); // the session reads the outcome itself

  return {
    done,
    cancel: async () => {
      cancelRequested = true;
      // Only a reply still being written holds the chat's controller; a saved one has nothing left to cancel.
      const current = useChatStore.getState().abortControllers.get(chatId) ?? null;
      if (replyController && current === replyController) abortReply(replyController);
      await done.catch(() => undefined);
      if (cancelledHere) await runnerReplyStopped(chatId);
    },
  };
}

// ── Speaker ───────────────────────────────────

function speakerFor(config: TTSConfig, character: VoiceCallCharacter, turnKey: string): VoiceReplySpeaker {
  const controller = new AbortController();
  const { signal } = controller;
  const speaker = new StreamingSpeaker({
    signal,
    prefetchAhead: PREFETCH_AHEAD,
    toRequests: (text, pieceIndex) =>
      withTTSVoiceRequestCacheKeys(
        buildTTSVoiceRequests(text, config, character.name, character.id).filter(
          (request) => request.text.trim().length > 0,
        ),
        config,
        `${turnKey}:${pieceIndex}`,
      ),
    prefetch: (request) => {
      // Waits with this reply's signal: cutting the reply off cancels the request unless someone else (a read-aloud
      // of the same line) is waiting for it too.
      void getOrCreateCachedTTSAudioBlob(
        request.cacheKey,
        (shared) => ttsService.generateAudio(request.text, { ...request, signal: shared }),
        request.cacheAliases,
        signal,
      ).catch(() => undefined); // Reported when the piece plays and fetches it again.
    },
    play: (requests) =>
      ttsService.speakSequence(requests, turnKey, {
        signal,
        playbackRate: clientSidePlaybackRate(config),
        lookahead: 1,
        throwOnError: true,
      }),
  });
  return {
    get started() {
      return speaker.started;
    },
    push: (text) => speaker.push(text),
    finish: (savedText) => speaker.finish(savedText),
    // Only this reply's own audio: anything else playing (a read-aloud started meanwhile) is left alone.
    pause: () => {
      speaker.pause();
      ttsService.pause(turnKey);
    },
    resume: () => {
      speaker.resume();
      ttsService.resume(turnKey);
    },
    stop: () => {
      controller.abort();
      ttsService.stop(turnKey);
    },
    isAudible: () => ttsService.getState() === "playing",
  };
}

// ── Ports ─────────────────────────────────────

/** `context` is read on every use, so the session follows the latest character and send function. */
export function createVoiceCallPorts(context: () => VoiceCallContext): VoiceSessionPorts<Blob> {
  let config: TTSConfig | null = null;
  return {
    setup: async () => {
      config = await loadSpeechConfig(true);
      const voiceReplies = Boolean(config?.enabled);
      if (config && providerSpeechInputEnabled(config)) {
        if (!canRecordAudio()) throw new Error(VOICE_NEEDS_HTTPS_MESSAGE);
        return { voiceReplies, input: recorderInput(config) };
      }
      // The desktop app's webview has a speech recognizer that starts and then never hears anything or reports an
      // error, so a call there would listen forever.
      if (hasEmbeddedTauriRuntime()) throw new Error(DESKTOP_NEEDS_PROVIDER_INPUT_MESSAGE);
      const Recognition = browserRecognition();
      if (!Recognition) throw new Error(NO_RECOGNITION_MESSAGE);
      return {
        voiceReplies,
        input: {
          kind: "recognizer",
          destination: "your browser's speech service",
          recognize: (signal) => recognizeOnce(Recognition, signal),
        },
      };
    },
    reply: { send: (text, onText) => sendReply(context, text, onText) },
    speech: {
      begin: (turnKey) => {
        if (!config?.enabled) return null;
        const { chatId, character } = context();
        return speakerFor(config, character, `voice-call:${chatId}:${Date.now()}:${turnKey}`);
      },
    },
  };
}
