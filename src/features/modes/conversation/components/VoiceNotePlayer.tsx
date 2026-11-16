import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { resolveVoiceNoteFileUrl } from "../../../../shared/api/local-file-api";
import { cn } from "../../../../shared/lib/utils";

function formatSeconds(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const whole = Math.round(value);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** A character's voice note: plays the saved audio (no new Text to Speech request), with the transcript on demand. */
export function VoiceNotePlayer({
  chatId,
  filename,
  url,
  transcript,
  className,
}: {
  chatId: string;
  filename: string | null | undefined;
  url: string | null | undefined;
  transcript: string;
  className?: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showTranscript, setShowTranscript] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    void resolveVoiceNoteFileUrl(chatId, filename, url)
      .then((resolved) => {
        if (cancelled) return;
        setSrc(resolved);
        if (!resolved) setFailed(true);
      })
      .catch((error: unknown) => {
        console.warn("[voice-note] could not resolve the audio file", error);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [chatId, filename, url]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio || !src) return;
    if (audio.paused) {
      audio.play().catch((error: unknown) => {
        console.warn("[voice-note] playback failed", error);
        setFailed(true);
      });
    } else {
      audio.pause();
    }
  };

  const progress = duration > 0 ? Math.min(1, position / duration) : 0;

  return (
    <div className={cn("flex min-w-[12rem] flex-col gap-1.5", className)}>
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            toggle();
          }}
          disabled={!src || failed}
          aria-label={playing ? "Pause voice message" : "Play voice message"}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] transition-opacity disabled:opacity-40"
        >
          {playing ? <Pause size="0.875rem" /> : <Play size="0.875rem" className="translate-x-px" />}
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="h-1 w-full overflow-hidden rounded-full bg-current/20" aria-hidden="true">
            <div className="h-full rounded-full bg-current/70" style={{ width: `${progress * 100}%` }} />
          </div>
          <span className="text-[0.6875rem] tabular-nums opacity-70">
            {failed
              ? "Voice message unavailable"
              : playing || position > 0
                ? `${formatSeconds(position)} / ${formatSeconds(duration)}`
                : formatSeconds(duration)}
          </span>
        </div>
      </div>
      {transcript.trim() && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setShowTranscript((value) => !value);
          }}
          aria-expanded={showTranscript}
          className="self-start text-[0.6875rem] underline-offset-2 opacity-70 hover:underline"
        >
          {showTranscript ? "Hide transcript" : "Show transcript"}
        </button>
      )}
      {showTranscript && <p className="text-[0.8125rem] whitespace-pre-wrap opacity-90">{transcript}</p>}
      {src && (
        <audio
          ref={audioRef}
          src={src}
          preload="metadata"
          onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
          onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setPosition(0);
          }}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
