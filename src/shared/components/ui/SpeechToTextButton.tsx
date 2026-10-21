import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, MicOff } from "lucide-react";
import { ttsApi } from "../../api/tts-api";
import {
  VOICE_NEEDS_HTTPS_MESSAGE,
  canRecordAudio,
  loadSpeechConfig,
  openMicrophone,
  providerSpeechInputEnabled,
  startRecording,
  stopStream,
} from "../../lib/voice-recorder";
import { toast } from "sonner";
import { toUserMessage } from "../../lib/error-message";
import { cn } from "../../lib/utils";

type SpeechRecognitionAlternativeLike = {
  transcript?: string;
};

type SpeechRecognitionResultLike = {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternativeLike;
  [index: number]: SpeechRecognitionAlternativeLike | undefined;
};

type SpeechRecognitionResultListLike = {
  readonly length: number;
  item(index: number): SpeechRecognitionResultLike;
  [index: number]: SpeechRecognitionResultLike | undefined;
};

type SpeechRecognitionEventLike = Event & {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultListLike;
};

type SpeechRecognitionErrorEventLike = Event & {
  readonly error?: string;
};

type SpeechRecognitionLike = EventTarget & {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

interface SpeechToTextButtonProps {
  disabled?: boolean;
  onTranscript: (text: string) => void;
  className?: string;
  iconSize?: number;
}

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as SpeechRecognitionWindow;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

function readTranscript(result: SpeechRecognitionResultLike | undefined): string {
  return result?.[0]?.transcript ?? result?.item(0)?.transcript ?? "";
}

export function SpeechToTextButton({ disabled, onTranscript, className, iconSize = 16 }: SpeechToTextButtonProps) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  /** Voice input goes to the Text to Speech provider (Whisper / Scribe) instead of the browser. */
  const [providerMode, setProviderMode] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recordingRef = useRef<{ stop: () => Promise<Blob>; stream: MediaStream } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSupported(Boolean(getSpeechRecognitionCtor()));
    void loadSpeechConfig().then((config) => {
      if (cancelled || !providerSpeechInputEnabled(config)) return;
      setProviderMode(true);
      setSupported(canRecordAudio());
    });
    return () => {
      cancelled = true;
      recognitionRef.current?.abort();
      recognitionRef.current = null;
      if (recordingRef.current) stopStream(recordingRef.current.stream);
      recordingRef.current = null;
    };
  }, []);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    const recording = recordingRef.current;
    if (!recording) return;
    recordingRef.current = null;
    setListening(false);
    setTranscribing(true);
    void (async () => {
      try {
        const audio = await recording.stop();
        stopStream(recording.stream);
        const text = await ttsApi.transcribe(audio);
        if (text) onTranscript(text);
        else toast.error("Didn't catch any words. Try again a little closer to the mic.");
      } catch (error) {
        toast.error(toUserMessage(error, "speechRecognition"));
      } finally {
        setTranscribing(false);
      }
    })();
  }, [onTranscript]);

  const startProviderRecording = useCallback(async () => {
    if (!canRecordAudio()) {
      toast.error(VOICE_NEEDS_HTTPS_MESSAGE);
      return;
    }
    try {
      const stream = await openMicrophone();
      recordingRef.current = { stop: startRecording(stream).stop, stream };
      setListening(true);
    } catch (error) {
      toast.error(toUserMessage(error, "speechRecognition"));
    }
  }, []);

  const startListening = useCallback(() => {
    if (disabled || transcribing) return;
    if (listening) {
      stopListening();
      return;
    }
    if (providerMode) {
      void startProviderRecording();
      return;
    }

    const Recognition = getSpeechRecognitionCtor();
    if (!Recognition) {
      toast.error("This browser can't turn speech into text. Use Chrome or Edge, or type instead.");
      return;
    }

    const recognition = new Recognition();
    let finalTranscript = "";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";
    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index] ?? event.results.item(index);
        const transcript = readTranscript(result);
        if (result?.isFinal && transcript.trim()) {
          finalTranscript = `${finalTranscript} ${transcript}`.trim();
        }
      }
    };
    recognition.onerror = (event) => {
      const error = event.error ?? "unknown";
      setListening(false);
      if (!["aborted", "no-speech"].includes(error)) {
        toast.error(toUserMessage(event, "speechRecognition"));
      }
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
      if (finalTranscript.trim()) {
        onTranscript(finalTranscript.trim());
      }
    };

    recognitionRef.current = recognition;
    setListening(true);
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setListening(false);
      toast.error(toUserMessage(null, "speechRecognition"));
    }
  }, [disabled, listening, onTranscript, providerMode, startProviderRecording, stopListening, transcribing]);

  return (
    <button
      type="button"
      onClick={startListening}
      disabled={disabled || transcribing}
      className={cn(
        "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-all duration-200 active:scale-90 sm:h-8 sm:w-8",
        listening
          ? "bg-foreground/10 text-foreground/75 ring-1 ring-foreground/20"
          : supported
            ? "text-foreground/40 hover:bg-foreground/10 hover:text-foreground/70"
            : "text-foreground/25",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
      title={
        transcribing
          ? "Transcribing…"
          : listening
            ? "Stop dictation"
            : supported
              ? "Dictate message"
              : providerMode
                ? VOICE_NEEDS_HTTPS_MESSAGE
                : "Speech recognition is not supported in this browser"
      }
      aria-pressed={listening}
      aria-busy={transcribing}
      aria-label={transcribing ? "Transcribing" : listening ? "Stop dictation" : "Dictate message"}
    >
      {transcribing ? (
        <Loader2 size={iconSize} className="animate-spin" />
      ) : supported ? (
        <Mic size={iconSize} />
      ) : (
        <MicOff size={iconSize} />
      )}
    </button>
  );
}
