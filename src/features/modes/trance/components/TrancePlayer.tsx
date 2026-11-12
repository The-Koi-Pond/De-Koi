import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LifeBuoy } from "lucide-react";
import type {
  TranceAfter,
  TranceEnding,
  TranceFinish,
  TranceLine,
  TranceScript,
} from "../../../../engine/contracts/types/trance";
import { TRANCE_NOTE_LIMIT } from "../../../../engine/modes/trance/request";
import { TRANCE_STOP_LINE, tranceButtonLabel } from "../../../../engine/modes/trance/session";
import { cn } from "../../../../shared/lib/utils";

type Track = "main" | "gentle" | "calm" | "stop" | "realert";

interface PlayerLine {
  text: string;
  button: string;
}

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
    return { text: line.text, button };
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

export function TrancePlayer({
  script,
  ending,
  saving,
  saveError,
  onFinish,
}: {
  script: TranceScript;
  ending: TranceEnding;
  saving: boolean;
  saveError: string | null;
  onFinish: (after: TranceAfter) => void;
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
  const buttonRef = useRef<HTMLButtonElement | null>(null);

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
    <div className="relative flex min-h-full flex-1 flex-col bg-[#0d0b1a] text-[#ece8ff]">
      <div className="flex min-h-[3.75rem] items-center justify-end gap-2 p-3">
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
          className="absolute right-3 top-14 z-10 flex w-64 flex-col gap-1 rounded-xl border border-[#ece8ff]/15 bg-[#1b1733] p-2 shadow-xl"
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

      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 pb-6 text-center">
        <p aria-hidden="true" className="max-w-3xl text-[clamp(1rem,2.4vmin,1.5rem)] leading-snug text-[#ece8ff]/25">
          {previousLine?.text ?? ""}
        </p>
        <p
          key={`${track}:${index}`}
          ref={fadeRef}
          aria-live="polite"
          className="max-w-3xl text-[clamp(1.6rem,4.6vmin,3.25rem)] font-medium leading-snug"
        >
          {line.text}
        </p>
      </div>

      <div className="flex justify-center px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <button
          ref={buttonRef}
          type="button"
          onClick={advance}
          className="min-w-[12rem] rounded-full bg-[#ece8ff]/10 px-8 py-3 text-[clamp(1rem,2.6vmin,1.375rem)] text-[#ece8ff] transition-colors hover:bg-[#ece8ff]/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#a993ff]"
        >
          {line.button}
        </button>
      </div>
    </div>
  );
}
