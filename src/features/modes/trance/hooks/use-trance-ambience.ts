import { useEffect, useRef, useState } from "react";
import type { TranceSoundscape } from "../../../../shared/stores/ui/model";
import { startSoundscape } from "../lib/trance-ambience";

/** "on" plays, "sleep" fades away slowly on the dark sleep screen, "off" fades out quickly (muted or finished). */
export type TranceAmbienceMode = "on" | "sleep" | "off";

/** Soundscapes come in gently. */
const FADE_IN_SECONDS = 4;
const FADE_OUT_SECONDS = 2.5;
/** On the sleep screen the sound drifts away over a few minutes instead of stopping as you fall asleep. */
const SLEEP_FADE_SECONDS = 180;
/** How far ahead drops, waves and chimes are scheduled, and how often that's topped up. */
const LOOKAHEAD_SECONDS = 4;
const FILL_EVERY_MS = 1000;
/** Full volume is kept well under the voice reading the session. */
const MAX_GAIN = 0.6;

/** Perceived loudness grows faster than the slider's position, so the slider is squared. */
export function ambienceGain(volume: number): number {
  const clamped = Math.min(1, Math.max(0, volume));
  return clamped * clamped * MAX_GAIN;
}

function audioContextClass(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ??
    null
  );
}

/**
 * Plays a trance soundscape while the session runs. Returns true while the browser is holding sound back until the
 * next tap or key press (autoplay rules); it starts by itself on that press.
 */
export function useTranceAmbience({
  soundscape,
  volume,
  mode,
}: {
  soundscape: TranceSoundscape | null;
  volume: number;
  mode: TranceAmbienceMode;
}): { waitingForTap: boolean } {
  const [waitingForTap, setWaitingForTap] = useState(false);
  const master = useRef<{ context: AudioContext; gain: GainNode; startedAt: number } | null>(null);
  // The level wanted right now, for a soundscape that starts later than the setting changed.
  const target = useRef({ volume, mode });
  useEffect(() => {
    target.current = { volume, mode };
  }, [mode, volume]);

  useEffect(() => {
    const Context = audioContextClass();
    if (!soundscape || !Context) return;
    const context = new Context();
    const gain = context.createGain();
    gain.gain.value = 0;
    gain.connect(context.destination);
    const scape = startSoundscape(context, soundscape, gain);
    const fill = () => scape.fill(context.currentTime + LOOKAHEAD_SECONDS);
    fill();
    const timer = window.setInterval(fill, FILL_EVERY_MS);
    master.current = { context, gain, startedAt: context.currentTime };
    applyLevel(context, gain, target.current.volume, target.current.mode, FADE_IN_SECONDS);

    // Browsers may start the context suspended until someone taps or presses a key on the page.
    const resume = () => {
      if (context.state !== "suspended") return;
      // Refused resumes leave the context suspended, so the next tap simply tries again.
      context.resume().then(
        () => setWaitingForTap(context.state === "suspended"),
        () => setWaitingForTap(true),
      );
    };
    const onStateChange = () => setWaitingForTap(context.state === "suspended");
    context.addEventListener("statechange", onStateChange);
    window.addEventListener("pointerdown", resume);
    window.addEventListener("keydown", resume);
    setWaitingForTap(context.state === "suspended");
    resume();

    return () => {
      window.clearInterval(timer);
      context.removeEventListener("statechange", onStateChange);
      window.removeEventListener("pointerdown", resume);
      window.removeEventListener("keydown", resume);
      if (master.current?.context === context) master.current = null;
      // A short fade, so leaving mid-session doesn't cut the sound off with a click.
      const now = context.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.4);
      window.setTimeout(() => {
        scape.stop();
        void context.close();
      }, 500);
    };
  }, [soundscape]);

  useEffect(() => {
    const current = master.current;
    if (!current) return;
    const { context, gain, startedAt } = current;
    if (mode === "on") {
      if (context.state === "suspended") {
        context.resume().then(
          () => setWaitingForTap(context.state === "suspended"),
          () => setWaitingForTap(true),
        );
      }
      // Still inside the opening fade: finish it at its own pace rather than jumping up.
      const fadeLeft = FADE_IN_SECONDS - (context.currentTime - startedAt);
      applyLevel(context, gain, volume, mode, Math.max(0.3, fadeLeft));
      return;
    }
    const seconds = mode === "sleep" ? SLEEP_FADE_SECONDS : FADE_OUT_SECONDS;
    applyLevel(context, gain, volume, mode, seconds);
    // Once silent, the sound stops working the device (a whole night on the sleep screen); "on" resumes it.
    const timer = window.setTimeout(
      () => {
        if (context.state === "running") void context.suspend();
      },
      seconds * 1000 + 200,
    );
    return () => window.clearTimeout(timer);
  }, [mode, volume]);

  // Only worth saying while the sound is meant to be playing.
  return { waitingForTap: Boolean(soundscape) && mode === "on" && waitingForTap };
}

function applyLevel(
  context: BaseAudioContext,
  gain: GainNode,
  volume: number,
  mode: TranceAmbienceMode,
  seconds: number,
) {
  const now = context.currentTime;
  const level = mode === "on" ? ambienceGain(volume) : 0;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(level, now + seconds);
}
