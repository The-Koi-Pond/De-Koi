import type { ReactNode } from "react";
import { Volume2 } from "lucide-react";
import {
  TRANCE_BACKDROPS,
  TRANCE_BUTTON_WORDS,
  TRANCE_PACES,
  TRANCE_VOICE_MODES,
  type TranceBackdrop,
  type TranceButtonWords,
  type TrancePace,
  type TranceVoiceMode,
} from "../../../../shared/stores/ui/model";
import { useUIStore } from "../../../../shared/stores/ui.store";
import { cn } from "../../../../shared/lib/utils";
import { useTranceVoiceSetup } from "../hooks/use-trance-voice";

const BACKDROP_LABELS: Record<TranceBackdrop, { label: string; detail: string }> = {
  drift: { label: "Drift", detail: "Soft colour clouds wandering slowly behind the words." },
  breathe: { label: "Breathe", detail: "A glow that swells and settles at a slow breathing pace." },
  spiral: { label: "Spiral", detail: "A faint spiral turning very slowly." },
  plain: { label: "Plain", detail: "Just the words on a dark screen." },
};

const VOICE_LABELS: Record<TranceVoiceMode, { label: string; detail: string }> = {
  off: { label: "Off", detail: "Read it yourself, one line at a time." },
  "read-along": { label: "Read along", detail: "Each line is spoken as it appears. You still press to go on." },
  "eyes-closed": {
    label: "Eyes closed",
    detail: "Each line is spoken and the next one follows by itself, so you can close your eyes and listen.",
  },
};

const PACE_LABELS: Record<TrancePace, { label: string; detail: string }> = {
  press: { label: "I press", detail: "Each line waits until you press the button (or Space)." },
  auto: {
    label: "On its own",
    detail: "Each line moves on by itself at a slow reading pace. You can pause, or press to skip ahead.",
  },
};

const BUTTON_WORD_LABELS: Record<TranceButtonWords, { label: string; detail: string }> = {
  quiet: { label: "Quiet", detail: "The button just says “Go on” or “Okay”, never how you should feel." },
  affirming: {
    label: "Affirming",
    detail: "The button says “Yes…”, “Feels nice” and so on, so each press is a small yes.",
  },
};

function Choice({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-sm transition-colors",
        selected
          ? "border-[var(--primary)] bg-[var(--primary)]/15 font-semibold text-[var(--foreground)]"
          : "border-[var(--border)] bg-[var(--secondary)]/40 text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
      )}
    >
      {children}
    </button>
  );
}

/** How the session looks and sounds on this device: the backdrop and read-aloud. */
export function TranceSessionOptions({
  characterId,
  characterName,
}: {
  characterId: string | null;
  characterName: string;
}) {
  const backdrop = useUIStore((state) => state.tranceBackdrop);
  const setBackdrop = useUIStore((state) => state.setTranceBackdrop);
  const voiceMode = useUIStore((state) => state.tranceVoice);
  const setVoiceMode = useUIStore((state) => state.setTranceVoice);
  const pace = useUIStore((state) => state.trancePace);
  const setPace = useUIStore((state) => state.setTrancePace);
  const buttonWords = useUIStore((state) => state.tranceButtonWords);
  const setButtonWords = useUIStore((state) => state.setTranceButtonWords);
  const setup = useTranceVoiceSetup(characterId, characterName);
  const eyesClosed = setup.available && voiceMode === "eyes-closed";

  return (
    <section className="w-full rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 text-left">
      <h3 className="mb-2 text-sm font-bold text-[var(--foreground)]">Before you start</h3>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-[0.8125rem] font-semibold text-[var(--foreground)]">Background</span>
          <div role="group" aria-label="Background" className="flex flex-wrap gap-1.5">
            {TRANCE_BACKDROPS.map((kind) => (
              <Choice key={kind} selected={backdrop === kind} onClick={() => setBackdrop(kind)}>
                {BACKDROP_LABELS[kind].label}
              </Choice>
            ))}
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">{BACKDROP_LABELS[backdrop].detail}</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[0.8125rem] font-semibold text-[var(--foreground)]">Moving on</span>
          <div role="group" aria-label="Moving on" className="flex flex-wrap gap-1.5">
            {TRANCE_PACES.map((kind) => (
              <Choice key={kind} selected={pace === kind} onClick={() => setPace(kind)}>
                {PACE_LABELS[kind].label}
              </Choice>
            ))}
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">
            {eyesClosed
              ? "With eyes closed, each line moves on by itself after it's spoken, whichever you pick."
              : PACE_LABELS[pace].detail}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[0.8125rem] font-semibold text-[var(--foreground)]">Button words</span>
          <div role="group" aria-label="Button words" className="flex flex-wrap gap-1.5">
            {TRANCE_BUTTON_WORDS.map((kind) => (
              <Choice key={kind} selected={buttonWords === kind} onClick={() => setButtonWords(kind)}>
                {BUTTON_WORD_LABELS[kind].label}
              </Choice>
            ))}
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">{BUTTON_WORD_LABELS[buttonWords].detail}</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="flex items-center gap-1.5 text-[0.8125rem] font-semibold text-[var(--foreground)]">
            <Volume2 size="0.875rem" aria-hidden="true" />
            Read it to me
          </span>
          {setup.available ? (
            <>
              <div role="group" aria-label="Read it to me" className="flex flex-wrap gap-1.5">
                {TRANCE_VOICE_MODES.map((mode) => (
                  <Choice key={mode} selected={voiceMode === mode} onClick={() => setVoiceMode(mode)}>
                    {VOICE_LABELS[mode].label}
                  </Choice>
                ))}
              </div>
              <p className="text-xs text-[var(--muted-foreground)]">
                {VOICE_LABELS[voiceMode].detail}
                {voiceMode !== "off" &&
                  (setup.ownVoice
                    ? ` In ${characterName}'s own voice.`
                    : ` In your default Text to Speech voice (give ${characterName} their own in Connections → Text to Speech).`)}
              </p>
            </>
          ) : setup.isLoading ? null : (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs text-[var(--muted-foreground)]">
                Sessions can be read aloud, even with your eyes closed, once a Text to Speech voice (like ElevenLabs) is
                set up.
              </p>
              <button
                type="button"
                onClick={() => useUIStore.getState().openRightPanel("connections")}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--foreground)]"
              >
                Set up a voice
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
