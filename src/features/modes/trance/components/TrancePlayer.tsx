import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AudioLines, LifeBuoy, Pause, Play, Volume2, VolumeX } from "lucide-react";
import type {
  TranceAfter,
  TranceEnding,
  TranceFinish,
  TranceLine,
  TrancePhase,
  TranceScript,
} from "../../../../engine/contracts/types/trance";
import { TRANCE_NOTE_LIMIT } from "../../../../engine/modes/trance/request";
import { TRANCE_STOP_LINE, tranceButtonLabel, type TranceButtonStyle } from "../../../../engine/modes/trance/session";
import { cn } from "../../../../shared/lib/utils";
import type {
  TranceAmbience,
  TranceBackdrop as TranceBackdropKind,
  TrancePace,
  TranceVoiceMode,
} from "../../../../shared/stores/ui/model";
import { useTranceAmbience } from "../hooks/use-trance-ambience";
import { useKeepScreenOn, type KeepScreenOnProblem } from "../hooks/use-keep-screen-on";
import { useTranceVoice } from "../hooks/use-trance-voice";
import { SOUNDSCAPE_NAMES, tranceSoundscapeFor } from "../lib/trance-ambience";
import { TranceBackdrop, type TranceShade } from "./TranceBackdrop";
import type { TranceCharacterColors } from "../lib/trance-colors";

type Track = "main" | "gentle" | "calm" | "stop" | "realert";

interface PlayerLine {
  text: string;
  button: string;
  /** Main session lines only: the part of the session the line is in. */
  phase?: TrancePhase;
}

/** Moving on by itself: the quiet after a line is spoken (or read) before the next one starts. Longer while going deep. */
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
/** How long a finished line takes to sink away. */
const LEAVE_MS = 900;
/** The new line waits this long before fading in, while the old one is already going. */
const LINE_IN_DELAY_MS = 450;

const SCREEN_PROBLEM_TEXT: Record<KeepScreenOnProblem, string> = {
  insecure: "Your screen may turn off by itself: browsers only keep it on over https. Give it a longer screen timeout.",
  unsupported: "Your screen may turn off by itself: this browser can't keep it on. Give it a longer screen timeout.",
  refused: "Your screen may turn off by itself: the device wouldn't keep it on (battery saver?).",
};

/** Moving on by itself without a voice: time to read a line slowly, before the pause after it. */
const READ_BASE_MS = 1200;
const READ_MS_PER_WORD = 350;

function tranceReadingMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return READ_BASE_MS + words * READ_MS_PER_WORD;
}

/** The ways out are bright this long at the start so people see where they are; after that, only when the pointer is near. */
const CONTROLS_INTRO_MS = 6000;
/** How close (px) the pointer comes to the ways out before they brighten. */
const CONTROLS_NEAR_PX = 160;

/** True while the pointer is within `radius` px of a button inside the element (as of the last pointer move or tap). */
function usePointerNear(ref: { current: HTMLElement | null }, radius: number): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      const buttons = ref.current ? [...ref.current.querySelectorAll("button")] : [];
      setNear(
        buttons.some((button) => {
          const rect = button.getBoundingClientRect();
          const dx = Math.max(rect.left - event.clientX, 0, event.clientX - rect.right);
          const dy = Math.max(rect.top - event.clientY, 0, event.clientY - rect.bottom);
          return Math.hypot(dx, dy) <= radius;
        }),
      );
    };
    window.addEventListener("pointermove", onPointer);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [radius, ref]);
  return near;
}

function exitLines(lines: readonly string[], lastWord: string, style: TranceButtonStyle): PlayerLine[] {
  let previous: string | null = null;
  return lines.map((text, index) => {
    const button = index === lines.length - 1 ? lastWord : tranceButtonLabel("exit", text, previous, style);
    previous = button;
    return { text, button };
  });
}

function mainLines(lines: readonly TranceLine[], ending: TranceEnding, style: TranceButtonStyle): PlayerLine[] {
  let previous: string | null = null;
  return lines.map((line, index) => {
    const last = index === lines.length - 1;
    const button = last
      ? ending === "wake"
        ? "I'm awake"
        : "Goodnight"
      : tranceButtonLabel(line.phase, line.text, previous, style);
    previous = button;
    return { text: line.text, button, phase: line.phase };
  });
}

function prefersLessMotion(): boolean {
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

/**
 * Fades an element in whenever `key` changes; skipped for people who asked for less motion. With no `to` keyframe it
 * ends at the element's own opacity, so a dimmed line stays dimmed.
 */
function useFadeIn<T extends HTMLElement>(key: string, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
  const ref = useRef<T | null>(null);
  const settings = useRef({ keyframes, options });
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof element.animate !== "function" || prefersLessMotion()) return;
    const animation = element.animate(settings.current.keyframes, settings.current.options);
    return () => animation.cancel();
  }, [key]);
  return ref;
}

const LINE_IN: Keyframe[] = [
  { opacity: 0, transform: "translateY(0.35em)" },
  { opacity: 1, transform: "translateY(0)" },
];
// The new line starts as the old one is already sinking away, so the two never sit sharp on top of each other.
const LINE_IN_OPTIONS: KeyframeAnimationOptions = {
  duration: FADE_MS,
  delay: LINE_IN_DELAY_MS,
  easing: "ease-out",
  fill: "backwards",
};
const EARLIER_IN: Keyframe[] = [{ opacity: 0 }];
const EARLIER_IN_OPTIONS: KeyframeAnimationOptions = { duration: LEAVE_MS, easing: "ease-in-out" };
// The finished line sinks back into the dark: smaller, softer, then gone.
const LINE_OUT: Keyframe[] = [
  { opacity: 1, transform: "translateY(0) scale(1)", filter: "blur(0)" },
  // Mostly gone before the new line starts to show, so the two are never readable on top of each other.
  { opacity: 0.12, offset: 0.5 },
  { opacity: 0, transform: "translateY(-0.5em) scale(0.92)", filter: "blur(4px)" },
];

/** The line that was just left, drawn over the new one while it sinks away. Gone when its fade ends. */
function LeavingLine({ text, style, onDone }: { text: string; style?: CSSProperties; onDone: () => void }) {
  const ref = useRef<HTMLParagraphElement | null>(null);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const animation = element.animate(LINE_OUT, { duration: LEAVE_MS, easing: "ease-out", fill: "forwards" });
    animation.onfinish = () => done.current();
    return () => animation.cancel();
  }, []);
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <p
        ref={ref}
        data-testid="trance-leaving-line"
        className="trance-line max-w-3xl text-[clamp(1.6rem,4.6vmin,3.25rem)] font-medium leading-snug"
        style={style}
      >
        {text}
      </p>
    </div>
  );
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
  pace = "press",
  buttonWords = "quiet",
  characterId = null,
  characterName = "",
  colors = null,
  ambience = "off",
  ambienceVolume = 0.5,
}: {
  script: TranceScript;
  ending: TranceEnding;
  saving: boolean;
  saveError: string | null;
  onFinish: (after: TranceAfter) => void;
  backdrop?: TranceBackdropKind;
  voiceMode?: TranceVoiceMode;
  /** "auto" moves on by itself; eyes closed with a working voice always does. */
  pace?: TrancePace;
  buttonWords?: TranceButtonStyle;
  characterId?: string | null;
  characterName?: string;
  /** The guide's colours; null keeps the session's own. */
  colors?: TranceCharacterColors | null;
  /** The sound underneath: picked from the script, a fixed one, or none. */
  ambience?: TranceAmbience;
  ambienceVolume?: number;
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
  const [paused, setPaused] = useState(false);
  const voice = useTranceVoice({ enabled: voiceMode !== "off" && !muted, characterId, characterName });
  // Eyes closed needs the voice to carry it; "On its own" works with or without one.
  const eyesClosed = voiceMode === "eyes-closed" && voice.active && !voice.error;
  const movesOnItsOwn = pace === "auto" || eyesClosed;
  const handsFree = movesOnItsOwn && !paused;
  // A working voice decides when a line is done; otherwise a reading timer does.
  const speechCarries = voice.active && !voice.error;
  // Whether any of this run moved on by itself or was spoken: only silently pressed runs measure reading speed.
  const movedOnItsOwn = useRef(false);
  useEffect(() => {
    if (movesOnItsOwn || speechCarries) movedOnItsOwn.current = true;
  }, [movesOnItsOwn, speechCarries]);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const pointerNear = usePointerNear(controlsRef, CONTROLS_NEAR_PX);
  const [intro, setIntro] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setIntro(false), CONTROLS_INTRO_MS);
    return () => clearTimeout(timer);
  }, []);

  const tracks = useMemo<Record<Track, PlayerLine[]>>(() => {
    const stop: PlayerLine[] = [{ text: TRANCE_STOP_LINE, button: "I'm back" }];
    // A saved script always has both exits; one without them (older or edited data) still gets a way out.
    const exit = (lines: readonly string[], lastWord: string) =>
      lines.length ? exitLines(lines, lastWord, buttonWords) : stop;
    return {
      main: mainLines(script.lines, ending, buttonWords),
      gentle: exit(script.exits.gentle, "I'm awake"),
      calm: exit(script.exits.calm, "I'm okay"),
      stop,
      realert: exit(script.exits.gentle, "I'm awake"),
    };
  }, [buttonWords, ending, script]);
  const lines = tracks[track];
  const line = lines[Math.min(index, lines.length - 1)]!;
  const previousLine = index > 0 ? lines[index - 1] : null;
  const showingAfter = finishedBy !== null && !sleeping && track !== "realert";
  const lineKey = `${track}:${index}`;
  const fadeRef = useFadeIn<HTMLParagraphElement>(lineKey, LINE_IN, LINE_IN_OPTIONS);
  const earlierRef = useFadeIn<HTMLParagraphElement>(lineKey, EARLIER_IN, EARLIER_IN_OPTIONS);
  // The line on screen and the one sinking away after it. Set while rendering, so the old line never blinks out for a
  // frame between the two.
  const [shownLine, setShownLine] = useState({ key: lineKey, text: line.text });
  const [leavingLine, setLeavingLine] = useState<{ key: string; text: string } | null>(null);
  if (shownLine.key !== lineKey) {
    setShownLine({ key: lineKey, text: line.text });
    const canFade = typeof HTMLElement !== "undefined" && typeof HTMLElement.prototype.animate === "function";
    setLeavingLine(canFade && !prefersLessMotion() ? shownLine : null);
  }
  const clearLeaving = useCallback(() => setLeavingLine(null), []);
  // Moving on by itself, nobody touches the device, so the screen is kept on. Pausing, the after-check and the dark
  // sleep screen let it turn off again.
  const screenProblem = useKeepScreenOn(handsFree && !showingAfter && !sleeping);
  const soundscape = useMemo(() => tranceSoundscapeFor(ambience, script), [ambience, script]);
  const [soundOff, setSoundOff] = useState(false);
  // The sound plays through the session and the ways out, drifts away on the sleep screen, and stops for "Just stop"
  // and the after-check.
  const ambienceMode = soundOff || showingAfter || track === "stop" ? "off" : sleeping ? "sleep" : "on";
  const sound = useTranceAmbience({ soundscape, volume: ambienceVolume, mode: ambienceMode });

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

  // The latest advance, for the timers that move on by themselves.
  const advanceRef = useRef(advance);
  useEffect(() => {
    advanceRef.current = advance;
  }, [advance]);

  // Each line is spoken as it appears; moving on by itself, the next one follows after a pause. Opening the way-out
  // menu, the after-check and the dark sleep screen are quiet.
  const { speak, stop: stopVoice, active: voiceOn } = voice;
  // Each speak gets a number; `spokenRun` is the number whose line played to the end. Hands-free isn't a dependency
  // here: a voice error or a pause must not re-speak the line.
  const speakRun = useRef(0);
  const [spokenRun, setSpokenRun] = useState<number | null>(null);
  useEffect(() => {
    speakRun.current += 1;
    if (showingAfter || sleeping || exitMenuOpen || !voiceOn) {
      stopVoice();
      return;
    }
    const run = speakRun.current;
    const upcoming = lines.slice(index + 1).map((item) => item.text);
    speak(line.text, upcoming, () => setSpokenRun(run));
  }, [exitMenuOpen, index, line, lines, showingAfter, sleeping, speak, stopVoice, track, voiceOn]);

  // Moving on by itself: after the voice finishes the line (or, with no working voice, after a slow reading time),
  // wait the phase's pause, then go on. Pausing clears the wait; carrying on starts it again.
  useEffect(() => {
    if (!handsFree || showingAfter || sleeping || exitMenuOpen) return;
    if (speechCarries && spokenRun !== speakRun.current) return;
    const pause = PAUSE_AFTER_MS[track === "main" ? (line.phase ?? "induction") : "exit"];
    const timer = setTimeout(() => advanceRef.current(), (speechCarries ? 0 : tranceReadingMs(line.text)) + pause);
    return () => clearTimeout(timer);
  }, [exitMenuOpen, handsFree, line, showingAfter, sleeping, speechCarries, spokenRun, track]);

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
              pace: movedOnItsOwn.current ? "auto" : "press",
              ...(finishedBy === "completed" ? { lines: tracks.main.length } : {}),
              at: new Date().toISOString(),
            })
          }
        />
      </div>
    );
  }

  const inExit = track !== "main";
  // The ways out stay findable but quiet: low contrast unless it's the start, the pointer comes near, or they're focused.
  const controlsBright = intro || pointerNear || exitMenuOpen;
  return (
    <div className="relative isolate flex min-h-full flex-1 flex-col bg-[#0d0b1a] text-[#ece8ff]">
      <TranceBackdrop kind={backdrop} shade={shade} guide={colors?.palettes ?? null} />
      <div
        ref={controlsRef}
        data-testid="trance-controls"
        data-bright={controlsBright ? "true" : "false"}
        className={cn(
          "relative z-10 flex min-h-[3.75rem] items-center justify-end gap-2 p-3 transition-opacity duration-700 focus-within:opacity-100",
          controlsBright ? "opacity-100" : "opacity-25",
        )}
      >
        {movesOnItsOwn && (
          <button
            type="button"
            onClick={() => {
              setPaused(!paused);
              // Back to the main button, so Space keeps moving on instead of toggling the pause.
              buttonRef.current?.focus({ preventScroll: true });
            }}
            aria-pressed={paused}
            aria-label={paused ? "Carry on by itself" : "Pause"}
            title={paused ? "Carry on by itself" : "Pause"}
            className="rounded-full border border-[#ece8ff]/20 p-2 text-[#ece8ff]/70 hover:text-[#ece8ff]"
          >
            {paused ? <Play size="1rem" aria-hidden="true" /> : <Pause size="1rem" aria-hidden="true" />}
          </button>
        )}
        {soundscape && (
          <button
            type="button"
            onClick={() => {
              setSoundOff(!soundOff);
              // Back to the main button, so Space keeps moving on instead of toggling the sound.
              buttonRef.current?.focus({ preventScroll: true });
            }}
            aria-pressed={!soundOff}
            aria-label={`${SOUNDSCAPE_NAMES[soundscape]} sound: ${soundOff ? "off" : "on"}`}
            title={soundOff ? "Turn the sound back on" : "Turn the sound off"}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border border-[#ece8ff]/20 px-3 py-1.5 text-sm text-[#ece8ff]/70 hover:text-[#ece8ff]",
              soundOff && "line-through decoration-[#ece8ff]/50",
            )}
          >
            <AudioLines size="1rem" aria-hidden="true" />
            {SOUNDSCAPE_NAMES[soundscape]}
          </button>
        )}
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
            className="rounded-full border border-[#ece8ff]/20 p-2 text-[#ece8ff]/70 hover:text-[#ece8ff]"
          >
            {muted ? <VolumeX size="1rem" aria-hidden="true" /> : <Volume2 size="1rem" aria-hidden="true" />}
          </button>
        )}
        {track !== "stop" && (
          <button
            type="button"
            onClick={() => setExitMenuOpen((open) => !open)}
            aria-expanded={exitMenuOpen}
            className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-[#ece8ff]/20 px-3 py-1.5 text-sm text-[#ece8ff]/70 hover:text-[#ece8ff]"
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

      {screenProblem && controlsBright && (
        <p
          role="status"
          className="relative z-10 mx-auto max-w-md rounded-full bg-black/40 px-4 py-1.5 text-center text-xs text-[#ece8ff]/80"
        >
          {SCREEN_PROBLEM_TEXT[screenProblem]}
        </p>
      )}

      {sound.waitingForTap && !soundOff && (
        <p
          role="status"
          className="relative z-10 mx-auto max-w-md rounded-full bg-black/40 px-4 py-1.5 text-center text-xs text-[#ece8ff]/80"
        >
          The sound starts when you tap or press a key.
        </p>
      )}

      {voice.error && (
        <p
          role="status"
          className="relative z-10 mx-auto max-w-md rounded-full bg-black/40 px-4 py-1.5 text-center text-xs text-[#ece8ff]/80"
        >
          The voice stopped ({voice.error}).{" "}
          {handsFree ? "The words carry on by themselves." : "Read on and press to go on."}
        </p>
      )}

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-6 px-6 pb-6 text-center">
        <p
          ref={earlierRef}
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
          <div className="relative flex justify-center">
            {leavingLine && (
              <LeavingLine
                key={leavingLine.key}
                text={leavingLine.text}
                style={colors ? { color: colors.words } : undefined}
                onDone={clearLeaving}
              />
            )}
            <p
              key={lineKey}
              ref={fadeRef}
              aria-live="polite"
              className="trance-line max-w-3xl text-[clamp(1.6rem,4.6vmin,3.25rem)] font-medium leading-snug"
              style={colors ? { color: colors.words } : undefined}
            >
              {line.text}
            </p>
          </div>
        </div>
      </div>

      <div className="relative z-10 flex justify-center px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <button
          ref={buttonRef}
          type="button"
          onClick={advance}
          className={cn(
            "min-w-[12rem] rounded-full bg-[#ece8ff]/10 px-8 py-3 text-[clamp(1rem,2.6vmin,1.375rem)] text-[#ece8ff] transition-[background-color,opacity] duration-700 hover:bg-[#ece8ff]/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#a993ff]",
            // Moving on by itself, the button only skips ahead, so it stays in the background.
            handsFree && "opacity-30 hover:opacity-100",
          )}
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
