import { Mic, MicOff, PhoneOff, SkipForward } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "../../../../shared/lib/utils";
import { useChatStore } from "../../../../shared/stores/chat.store";
import { useReplyWait } from "../../shared/chat-ui/index";
import { useVoiceCall, type VoiceCallCharacter, type VoiceCallPhase } from "../hooks/use-voice-call";

const PHASE_TEXT: Record<VoiceCallPhase, string> = {
  connecting: "Connecting…",
  listening: "Listening",
  transcribing: "Catching that…",
  thinking: "Thinking…",
  speaking: "Talking",
  ended: "Call ended",
  error: "Call dropped",
};

export interface VoiceCallOverlayProps {
  chatId: string;
  character: VoiceCallCharacter & { avatarUrl?: string | null };
  sendText: (text: string) => Promise<unknown>;
  onClose: () => void;
}

/** Full-screen voice call with one Conversation character. Every turn is also saved in the chat as texts. */
export function VoiceCallOverlay({ chatId, character, sendText, onClose }: VoiceCallOverlayProps) {
  const call = useVoiceCall({ chatId, character, sendText });
  const { hangUp, phase } = call;
  // While the character is "thinking", the reply is waiting on the model: show how long once it drags.
  const stepStartedAt = useChatStore((s) => s.generationPhaseStartedAtByChatId.get(chatId) ?? null);
  const wait = useReplyWait(phase === "thinking" ? stepStartedAt : null);
  // Long replies scroll instead of being cut off; follow the newest words unless the user scrolled up to reread.
  const transcriptRef = useRef<HTMLDivElement>(null);
  const followTranscriptRef = useRef(true);
  useEffect(() => {
    followTranscriptRef.current = true; // each new turn starts at the newest words again
  }, [call.heard]);
  useEffect(() => {
    const box = transcriptRef.current;
    if (box && followTranscriptRef.current) box.scrollTop = box.scrollHeight;
  }, [call.heard, call.said]);

  useEffect(() => {
    if (phase === "ended") onClose();
  }, [onClose, phase]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        hangUp();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hangUp]);

  const ring = phase === "listening" ? 1 + call.level * 0.35 : phase === "speaking" ? 1.12 : 1;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Voice call with ${character.name}`}
      className="fixed inset-0 z-[120] flex flex-col items-center justify-between bg-[var(--background)]/95 px-6 py-10 backdrop-blur-md"
    >
      <div className="flex flex-col items-center gap-2 pt-6 text-center">
        <p className="text-xs uppercase tracking-widest text-[var(--muted-foreground)]">Voice call</p>
        <h2 className="text-2xl font-semibold text-[var(--foreground)]">{character.name}</h2>
        <p aria-live="polite" className="text-sm text-[var(--muted-foreground)]">
          {PHASE_TEXT[phase]}
          {call.muted && phase === "listening" ? " (muted)" : ""}
          {wait.elapsed ? (
            <span className="tabular-nums" aria-hidden="true">
              {" "}
              {wait.elapsed}
            </span>
          ) : null}
        </p>
        {wait.slow && (
          <p className="text-xs text-[var(--muted-foreground)]">Still waiting on the model. Hang up to cancel.</p>
        )}
      </div>

      <div className="relative flex items-center justify-center">
        <div
          aria-hidden
          className={cn(
            "absolute h-44 w-44 rounded-full bg-[var(--primary)]/20 transition-transform duration-100",
            phase === "thinking" && "animate-pulse",
          )}
          style={{ transform: `scale(${ring})` }}
        />
        {character.avatarUrl ? (
          <img src={character.avatarUrl} alt="" className="relative h-36 w-36 rounded-full object-cover shadow-lg" />
        ) : (
          <div className="relative flex h-36 w-36 items-center justify-center rounded-full bg-[var(--secondary)] text-4xl font-semibold text-[var(--foreground)]">
            {character.name.slice(0, 1)}
          </div>
        )}
      </div>

      <div
        ref={transcriptRef}
        data-testid="voice-call-transcript"
        onScroll={(event) => {
          const box = event.currentTarget;
          followTranscriptRef.current = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
        }}
        className="flex max-h-[35dvh] min-h-0 w-full max-w-md flex-col gap-2 overflow-y-auto text-center text-sm"
      >
        {call.error ? (
          <p role="alert" className="text-[var(--destructive)]">
            {call.error}
          </p>
        ) : (
          <>
            {call.heard && (
              <p className="text-[var(--muted-foreground)]">
                <span className="font-medium text-[var(--foreground)]/80">You: </span>
                {call.heard}
              </p>
            )}
            {call.said && (
              <p className="whitespace-pre-line text-[var(--foreground)]">
                <span className="font-medium">{character.name}: </span>
                {call.said}
              </p>
            )}
            {!call.voiceReplies && (
              <p className="text-xs text-[var(--muted-foreground)]">
                Replies show as text: turn on Text to Speech in Connections to hear them.
              </p>
            )}
          </>
        )}
      </div>

      <div className="flex items-center gap-6 pb-4">
        <button
          type="button"
          onClick={() => call.setMuted((value) => !value)}
          aria-pressed={call.muted}
          aria-label={call.muted ? "Unmute" : "Mute"}
          className={cn(
            "flex h-14 w-14 items-center justify-center rounded-full transition-colors",
            call.muted
              ? "bg-[var(--foreground)] text-[var(--background)]"
              : "bg-[var(--secondary)] text-[var(--foreground)]",
          )}
        >
          {call.muted ? <MicOff size="1.4rem" /> : <Mic size="1.4rem" />}
        </button>
        <button
          type="button"
          onClick={hangUp}
          aria-label="Hang up"
          className="flex h-16 w-16 items-center justify-center rounded-full bg-red-600 text-white shadow-lg transition-transform active:scale-95"
        >
          <PhoneOff size="1.6rem" />
        </button>
        <button
          type="button"
          onClick={call.interrupt}
          disabled={phase !== "speaking"}
          aria-label="Interrupt"
          className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--secondary)] text-[var(--foreground)] transition-opacity disabled:opacity-30"
        >
          <SkipForward size="1.4rem" />
        </button>
      </div>
    </div>
  );
}
