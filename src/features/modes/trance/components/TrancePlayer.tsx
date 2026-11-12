import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { LifeBuoy, Volume2, VolumeX } from "lucide-react";
import type {
  TranceAfter,
  TranceEnding,
  TranceFinish,
  TranceLine,
  TrancePhase,
  TranceScript,
} from "../../../../engine/contracts/types/trance";
import { TRANCE_NOTE_LIMIT } from "../../../../engine/modes/trance/request";
import { TRANCE_STOP_LINE, tranceButtonLabel } from "../../../../engine/modes/trance/session";
import { cn } from "../../../../shared/lib/utils";
import type { TranceBackdrop as TranceBackdropKind, TranceVoiceMode } from "../../../../shared/stores/ui/model";
import { useTranceVoice } from "../hooks/use-trance-voice";
import { TranceBackdrop, type TranceShade } from "./TranceBackdrop";
import type { TranceCharacterColors } from "../lib/trance-colors";

type Track = "main" | "gentle" | "calm" | "stop" | "realert";

interface PlayerLine {
  text: string;
  button: string;
  /** Main session lines only: the part of the session the line is in. */
  phase?: TrancePhase;
}

/** Eyes closed: the quiet after a line is spoken before the next one starts. Longer while going deep. */
const PAUSE_AFTER_MS: Record<TrancePhase | "exit", number> = {
  pretalk: 900,
  induction: 1400,
  deepener: 1800,
  suggestions: 1600,
  wake: 900,
  sleep: 2200,
  exit: 1100,
};

const FADE_MS = 900;

function exitLines(lines: readonly string[], lastWord: string): PlayerLine[] {
  let previous: string | null = null;
  return lines.map((text, index) => {
    const button = index === lines.length - 1 ? lastWord : tranceButtonLabel("exit", text, previous);
    previous = button;
    return { text, button };
  });
}

function mainLines(lines: readonly TranceLine[], ending: TranceEnding): PlayerLine[] {
  let previous: string | null = null;
  return lines.map((line, index) => {
    const last = index === lines.length - 1;
    const button = last
      ? ending === "wake"
        ? "I'm awake"
        : "Goodnight"
      : tranceButtonLabel(line.phase, line.text, previous);
    previous = button;
    return { text: line.text, button, phase: line.phase };
  });
}

/** Fades a line in; skipped for people who asked for less motion. */
function useFadeIn(key: string) {
  const ref = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof element.animate !== "function") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const animation = element.animate(
      [
        { opacity: 0, transform: "translateY(0.35em)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: FADE_MS, easing: "ease-out" },
    );
    return () => animation.cancel();
  }, [key]);
  return ref;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function AfterCheck({
  finishedBy,
  realerted,
  saving,
  error,
  onRealert,
  onSave,
}: {
  finishedBy: TranceFinish;
  realerted: boolean;
  saving: boolean;
  error: string | null;
  onRealert: () => void;
  onSave: (after: Omit<TranceAfter, "finishedBy" | "at" | "seconds">) => void;
}) {
  const [rating, setRating] = useState<number | null>(null);
  const [awake, setAwake] = useState<boolean | null>(realerted ? true : null);
  const [note, setNote] = useState("");
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-6 text-[var(--foreground)]">
      <h2 className="text-center text-lg font-bold">
        {finishedBy === "completed" ? "Welcome back." : "You're out. Take your time."}
      </h2>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold">How do you feel now?</span>
        <div role="group" aria-label="How you feel, 1 to 10" className="grid grid-cols-5 gap-1.5 sm:grid-cols-10">
          {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={rating === value}
              onClick={() => setRating(rating === value ? null : value)}
              className={cn(
                "rounded-lg border py-2 text-sm",
                rating === value
                  ? "border-[var(--primary)] bg-[var(--primary)]/20 font-bold"
                  : "border-[var(--border)] bg-[var(--secondary)]/40",
              )}
            >
              {value}
            </button>
          ))}
        </div>
        <span className="flex justify-between text-xs text-[var(--muted-foreground)]">
          <span>Rough</span>
          <span>Wonderful</span>
        </span>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold">Fully awake?</span>
        <div className="flex gap-2">
          <button
            type="button"
            aria-pressed={awake === true}
            onClick={() => setAwake(true)}
            className={cn(
              "flex-1 rounded-lg border py-2 text-sm",
              awake === true ? "border-[var(--primary)] bg-[var(--primary)]/20 font-bold" : "border-[var(--border)]",
            )}
          >
            Yes
          </button>
          <button
            type="button"
            onClick={onRealert}
            className="flex-1 rounded-lg border border-[var(--border)] py-2 text-sm"
          >
            Not quite, wake me up more
          </button>
        </div>
      </div>
      <textarea
        className="min-h-[4.5rem] w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--secondary)]/45 px-3 py-2 text-sm"
        placeholder="What worked, what didn't? (optional)"
        aria-label="Notes about this session"
        maxLength={TRANCE_NOTE_LIMIT}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      {error && (
        <p role="alert" className="text-sm text-[var(--destructive)]">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={saving}
        onClick={() => onSave({ rating, fullyAwake: realerted ? false : awake, note })}
        className="rounded-lg bg-[var(--primary)] py-2.5 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
      >
        Done
      </button>
    </div>
  );
}

/** The guide's name in the card's name colour, as a gradient when the card has one. */
function guideNameStyle(colors: TranceCharacterColors): CSSProperties {
  if (!colors.name) return { color: colors.words };
  if (!colors.name.includes("gradient(")) return { color: colors.name };
  return {
    backgroundImage: colors.name,
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    WebkitTextFillColor: "transparent",
    color: "transparent",
  };
}

export function TrancePlayer({
  script,
  ending,
  saving,
  saveError,
  onFinish,
  backdrop = "plain",
  voiceMode = "off",
  characterId = null,
  characterName = "",
  colors = null,
}: {
  script: TranceScript;
  ending: TranceEnding;
  saving: boolean;
  saveError: string | null;
  onFinish: (after: TranceAfter) => void;
  backdrop?: TranceBackdropKind;
  voiceMode?: TranceVoiceMode;
  characterId?: string | null;
  characterName?: string;
  /** The guide's colours; null keeps the session's own. */
  colors?: TranceCharacterColors | null;
}) {
  const [track, setTrack] = useState<Track>("main");
  const [index, setIndex] = useState(0);
  const [finishedBy, setFinishedBy] = useState<TranceFinish | null>(null);
  const [sleeping, setSleeping] = useState(false);
  const [realerted, setRealerted] = useState(false);
  // Start of the run and the moment it ended, for how long the session really took.
  const startedAt = useRef(Date.now());
  const endedAt = useRef<number | null>(null);
  const [exitMenuOpen, setExitMenuOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const voice = useTranceVoice({ enabled: voiceMode !== "off" && !muted, characterId, characterName });
  const handsFree = voiceMode === "eyes-closed" && voice.active && !voice.error;

  const tracks = useMemo<Record<Track, PlayerLine[]>>(() => {
    const stop: PlayerLine[] = [{ text: TRANCE_STOP_LINE, button: "I'm back" }];
    // A saved script always has both exits; one without them (older or edited data) still gets a way out.
    const exit = (lines: readonly string[], lastWord: string) => (lines.length ? exitLines(lines, lastWord) : stop);
    return {
      main: mainLines(script.lines, ending),
      gentle: exit(script.exits.gentle, "I'm awake"),
      calm: exit(script.exits.calm, "I'm okay"),
      stop,
      realert: exit(script.exits.gentle, "I'm awake"),
    };
  }, [ending, script]);
  const lines = tracks[track];
  const line = lines[Math.min(index, lines.length - 1)]!;
  const previousLine = index > 0 ? lines[index - 1] : null;
  const showingAfter = finishedBy !== null && !sleeping && track !== "realert";
  const fadeRef = useFadeIn(`${track}:${index}`);

  const startTrack = useCallback((next: Track) => {
    setExitMenuOpen(false);
    setTrack(next);
    setIndex(0);
  }, []);

  const advance = useCallback(() => {
    if (index < lines.length - 1) {
      setIndex(index + 1);
      return;
    }
    if (track === "main") {
      endedAt.current = Date.now();
      setFinishedBy("completed");
      if (ending === "sleep") setSleeping(true);
      return;
    }
    if (track === "realert") {
      setRealerted(true);
      setTrack("main");
      return;
    }
    endedAt.current = Date.now();
    setFinishedBy(track === "gentle" ? "gentle" : track === "calm" ? "calm" : "stop");
  }, [ending, index, lines.length, track]);

  const leaveVia = useCallback(
    (exit: "gentle" | "calm" | "stop") => {
      startTrack(exit);
    },
    [startTrack],
  );

  const shade = useMemo<TranceShade>(() => {
    if (track === "realert") return { kind: "wake", progress: lines.length > 1 ? index / (lines.length - 1) : 1 };
    if (track !== "main") return { kind: "exit" };
    const phase = line.phase ?? "induction";
    if (phase === "pretalk" || phase === "induction") return { kind: "down" };
    if (phase === "deepener" || phase === "suggestions") return { kind: "deep" };
    if (phase === "sleep") return { kind: "sleep" };
    const first = lines.findIndex((item) => item.phase === "wake");
    const count = lines.length - first;
    return { kind: "wake", progress: count > 1 ? (index - first) / (count - 1) : 1 };
  }, [index, line.phase, lines, track]);

  // The latest advance, for the timer that moves on by itself with eyes closed.
  const advanceRef = useRef(advance);
  useEffect(() => {
    advanceRef.current = advance;
  }, [advance]);

  // Each line is spoken as it appears; with eyes closed, the next one follows after a pause. Opening the way-out
  // menu, the after-check and the dark sleep screen are quiet.
  const { speak, stop: stopVoice, active: voiceOn } = voice;
  // Read when a line ends, not as a dependency: a voice error turning hands-free off must not re-speak the line.
  const handsFreeRef = useRef(handsFree);
  useEffect(() => {
    handsFreeRef.current = handsFree;
  }, [handsFree]);
  useEffect(() => {
    if (showingAfter || sleeping || exitMenuOpen || !voiceOn) {
      stopVoice();
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const upcoming = lines.slice(index + 1).map((item) => item.text);
    const pause = PAUSE_AFTER_MS[track === "main" ? (line.phase ?? "induction") : "exit"];
    speak(line.text, upcoming, () => {
      if (handsFreeRef.current) timer = setTimeout(() => advanceRef.current(), pause);
    });
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [exitMenuOpen, index, line, lines, showingAfter, sleeping, speak, stopVoice, track, voiceOn]);

  // Space, Enter or 1 moves on; Escape opens the way out. Typing in the after-check is left alone.
  useEffect(() => {
    if (showingAfter || sleeping) return;
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setExitMenuOpen((open) => !open);
        return;
      }
      if (exitMenuOpen) return;
      if (event.key === " " || event.key === "Enter" || event.key === "1") {
        if (event.target instanceof HTMLButtonElement && event.key !== "1") return;
        event.preventDefault();
        advance();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance, exitMenuOpen, showingAfter, sleeping]);

  useEffect(() => {
    if (!showingAfter && !sleeping && !exitMenuOpen) buttonRef.current?.focus({ preventScroll: true });
  }, [exitMenuOpen, index, showingAfter, sleeping, track]);

  if (sleeping) {
    return (
      <div className="flex min-h-full flex-1 flex-col items-center justify-end bg-black p-6">
        <button
          type="button"
          onClick={() => setSleeping(false)}
          className="rounded-full border border-white/10 px-4 py-2 text-xs text-white/30 hover:text-white/60"
        >
          I'm back
        </button>
      </div>
    );
  }

  if (showingAfter && finishedBy) {
    return (
      <div className="flex min-h-full flex-1 flex-col overflow-y-auto bg-[var(--background)]">
        <AfterCheck
          finishedBy={finishedBy}
          realerted={realerted}
          saving={saving}
          error={saveError}
          onRealert={() => startTrack("realert")}
          onSave={(after) =>
            onFinish({
              ...after,
              finishedBy,
              seconds: Math.round(((endedAt.current ?? Date.now()) - startedAt.current) / 1000),
              at: new Date().toISOString(),
            })
          }
        />
      </div>
    );
  }

  const inExit = track !== "main";
  return (
    <div className="relative isolate flex min-h-full flex-1 flex-col bg-[#0d0b1a] text-[#ece8ff]">
      <TranceBackdrop kind={backdrop} shade={shade} guide={colors?.palettes ?? null} />
      <div className="relative z-10 flex min-h-[3.75rem] items-center justify-end gap-2 p-3">
        {voiceMode !== "off" && (voice.active || muted) && (
          <button
            type="button"
            onClick={() => {
              setMuted(!muted);
              // Back to the main button, so Space keeps moving on instead of toggling the voice.
              buttonRef.current?.focus({ preventScroll: true });
            }}
            aria-pressed={muted}
            aria-label={muted ? "Turn the voice back on" : "Mute the voice"}
            title={muted ? "Turn the voice back on" : "Mute the voice"}
            className="mr-auto rounded-full border border-[#ece8ff]/20 p-2 text-[#ece8ff]/70 hover:text-[#ece8ff]"
          >
            {muted ? <VolumeX size="1rem" aria-hidden="true" /> : <Volume2 size="1rem" aria-hidden="true" />}
          </button>
        )}
        {track !== "stop" && (
          <button
            type="button"
            onClick={() => setExitMenuOpen((open) => !open)}
            aria-expanded={exitMenuOpen}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#ece8ff]/20 px-3 py-1.5 text-sm text-[#ece8ff]/70 hover:text-[#ece8ff]"
          >
            <LifeBuoy size="1rem" aria-hidden="true" />I need out
          </button>
        )}
      </div>

      {exitMenuOpen && (
        <div
          role="menu"
          aria-label="Ways out"
          className="absolute right-3 top-14 z-20 flex w-64 flex-col gap-1 rounded-xl border border-[#ece8ff]/15 bg-[#1b1733] p-2 shadow-xl"
        >
          {!inExit && (
            <button
              type="button"
              role="menuitem"
              onClick={() => leaveVia("gentle")}
              className="rounded-lg px-3 py-2 text-left text-sm hover:bg-[#ece8ff]/10"
            >
              Wake me gently
              <span className="block text-xs text-[#ece8ff]/50">A short count up and out.</span>
            </button>
          )}
          {track !== "calm" && (
            <button
              type="button"
              role="menuitem"
              onClick={() => leaveVia("calm")}
              className="rounded-lg px-3 py-2 text-left text-sm hover:bg-[#ece8ff]/10"
            >
              Something's upsetting me
              <span className="block text-xs text-[#ece8ff]/50">Calm and safe first, then out.</span>
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => leaveVia("stop")}
            className="rounded-lg px-3 py-2 text-left text-sm hover:bg-[#ece8ff]/10"
          >
            Just stop
            <span className="block text-xs text-[#ece8ff]/50">Straight back to the room.</span>
          </button>
        </div>
      )}

      {voice.error && (
        <p
          role="status"
          className="relative z-10 mx-auto max-w-md rounded-full bg-black/40 px-4 py-1.5 text-center text-xs text-[#ece8ff]/80"
        >
          The voice stopped ({voice.error}). Read on and press to go on.
        </p>
      )}

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-6 px-6 pb-6 text-center">
        <p
          aria-hidden="true"
          className={cn(
            "max-w-3xl text-[clamp(1rem,2.4vmin,1.5rem)] leading-snug",
            colors ? "opacity-30" : "text-[#ece8ff]/25",
          )}
          style={colors ? { color: colors.words } : undefined}
        >
          {previousLine?.text ?? ""}
        </p>
        <div className="flex flex-col items-center gap-2">
          {colors && characterName && (
            <span
              data-testid="trance-guide-name"
              className="text-[clamp(0.875rem,2vmin,1.125rem)] font-semibold tracking-wide opacity-90"
              style={guideNameStyle(colors)}
            >
              {characterName}
            </span>
          )}
          <p
            key={`${track}:${index}`}
            ref={fadeRef}
            aria-live="polite"
            className="trance-line max-w-3xl text-[clamp(1.6rem,4.6vmin,3.25rem)] font-medium leading-snug"
            style={colors ? { color: colors.words } : undefined}
          >
            {line.text}
          </p>
        </div>
      </div>

      <div className="relative z-10 flex justify-center px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <button
          ref={buttonRef}
          type="button"
          onClick={advance}
          className="min-w-[12rem] rounded-full bg-[#ece8ff]/10 px-8 py-3 text-[clamp(1rem,2.6vmin,1.375rem)] text-[#ece8ff] transition-colors hover:bg-[#ece8ff]/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#a993ff]"
          style={
            colors
              ? { color: colors.words, backgroundColor: `${colors.words}1f`, outlineColor: colors.words }
              : undefined
          }
        >
          {line.button}
        </button>
      </div>
    </div>
  );
}
