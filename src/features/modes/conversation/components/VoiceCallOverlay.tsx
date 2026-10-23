import { Mic, MicOff, PhoneOff, SkipForward } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import type { VoiceMicState } from "../../../../engine/shared/voice-session/voice-session";
import { cn } from "../../../../shared/lib/utils";
import { holdNotificationPingsQuiet } from "../../../../shared/lib/notification-sound";
import { useChatStore } from "../../../../shared/stores/chat.store";
import { useReplyWait } from "../../shared/chat-ui/index";
import { useVoiceCall, type VoiceCallCharacter, type VoiceCallPhase } from "../hooks/use-voice-call";

const PHASE_TEXT: Record<VoiceCallPhase, string> = {
  connecting: "Connecting…",
  listening: "Listening",
  transcribing: "Catching that…",
  thinking: "Thinking…",
  speaking: "Talking",
  interrupted: "Paused for you",
  ended: "Call ended",
  error: "Call dropped",
};

export interface VoiceCallOverlayProps {
  chatId: string;
  character: VoiceCallCharacter & { avatarUrl?: string | null };
  sendText: (text: string) => Promise<boolean>;
  onClose: () => void;
}

const MIC_TEXT: Record<VoiceMicState, string> = {
  off: "Mic off",
  opening: "Turning the mic on…",
  listening: "Mic on · listening",
  sending: "Mic on · sending",
};

/** Always on screen: whether the microphone is open, and when your voice is on its way to someone. */
function MicIndicator({ mic, destination }: { mic: VoiceMicState; destination: string }) {
  const on = mic === "listening" || mic === "sending";
  const text = mic === "sending" && destination ? `Mic on · sending to ${destination}` : MIC_TEXT[mic];
  return (
    <p
      role="status"
      data-testid="voice-call-mic"
      data-mic={mic}
      title={
        destination
          ? `Your speech goes to ${destination} to be turned into text. De-Koi doesn't keep the audio.`
          : undefined
      }
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
        on ? "bg-red-600/15 text-red-700 dark:text-red-300" : "bg-[var(--secondary)] text-[var(--muted-foreground)]",
      )}
    >
      {on ? (
        <span aria-hidden className={cn("h-2 w-2 rounded-full bg-red-600", mic === "sending" && "animate-pulse")} />
      ) : (
        <MicOff aria-hidden size="0.8rem" />
      )}
      {text}
    </p>
  );
}

/** Full-screen voice call with one Conversation character. Every turn is also saved in the chat as texts. */
export function VoiceCallOverlay({ chatId, character, sendText, onClose }: VoiceCallOverlayProps) {
  const call = useVoiceCall({ chatId, character, sendText });
  const { hangUp, phase } = call;
  const endCall = useCallback(() => {
    hangUp();
    onClose();
  }, [hangUp, onClose]);
  const canInterrupt = !call.stopping && (phase === "thinking" || phase === "speaking" || phase === "interrupted");
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

  // No new-message chirp while on the call: the reply is being spoken out loud already.
  useEffect(() => holdNotificationPingsQuiet(), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        endCall();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [endCall]);

  const ring =
    phase === "listening" || phase === "interrupted" ? 1 + call.level * 0.35 : phase === "speaking" ? 1.12 : 1;
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
        <MicIndicator mic={call.mic} destination={call.destination} />
        <p aria-live="polite" className="text-sm text-[var(--muted-foreground)]">
          {call.stopping ? `Stopping ${character.name}…` : PHASE_TEXT[phase]}
          {call.muted && phase === "listening" ? " (muted)" : ""}
          {wait.elapsed ? (
            <span className="tabular-nums" aria-hidden="true">
              {" "}
              {wait.elapsed}
            </span>
          ) : null}
        </p>
        {wait.slow && (
          <p className="text-xs text-[var(--muted-foreground)]">Still waiting on the model. Interrupt to cancel.</p>
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
            {call.bargeIn === "button" && (phase === "thinking" || phase === "speaking") && (
              <p className="text-xs text-[var(--muted-foreground)]">
                Tap Interrupt to cut in: this voice input can't listen while {character.name} talks.
              </p>
            )}
            {call.bargeIn === "speakers" && (
              <p className="text-xs text-[var(--muted-foreground)]">
                Your mic kept hearing {character.name}'s voice, so talking over them is off for this call. Tap Interrupt
                to cut in, or use headphones.
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
          onClick={call.toggleMute}
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
          onClick={endCall}
          aria-label="Hang up"
          className="flex h-16 w-16 items-center justify-center rounded-full bg-red-600 text-white shadow-lg transition-transform active:scale-95"
        >
          <PhoneOff size="1.6rem" />
        </button>
        <button
          type="button"
          onClick={call.interrupt}
          disabled={!canInterrupt}
          aria-label="Interrupt"
          className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--secondary)] text-[var(--foreground)] transition-opacity disabled:opacity-30"
        >
          <SkipForward size="1.4rem" />
        </button>
      </div>
    </div>
  );
}
