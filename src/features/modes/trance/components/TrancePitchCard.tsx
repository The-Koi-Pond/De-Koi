import { Pencil, Play } from "lucide-react";
import type { TrancePitch } from "../../../../engine/modes/trance/pitches";
import { TRANCE_ENDING_LABELS, tranceTagSummary } from "../../../../engine/modes/trance/request";

/** One session idea: what it is, its settings, and the first lines it would open with. */
export function TrancePitchCard({
  pitch,
  disabled,
  onWrite,
  onTweak,
}: {
  pitch: TrancePitch;
  disabled: boolean;
  onWrite: () => void;
  onTweak?: () => void;
}) {
  const { request } = pitch;
  return (
    <article className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/30 p-3">
      <div>
        <h4 className="text-sm font-bold text-[var(--foreground)]">{pitch.title}</h4>
        <p className="text-xs text-[var(--muted-foreground)]">
          {tranceTagSummary(request)} · {request.minutes} min · {TRANCE_ENDING_LABELS[request.ending]}
        </p>
      </div>
      {pitch.summary && <p className="text-sm text-[var(--foreground)]">{pitch.summary}</p>}
      <blockquote className="flex flex-col gap-1 border-l-2 border-[var(--primary)]/50 pl-3 text-sm italic text-[var(--muted-foreground)]">
        {request.pitch?.sample.map((line, index) => (
          <p key={index}>{line}</p>
        ))}
      </blockquote>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={onWrite}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
        >
          <Play size="0.875rem" aria-hidden="true" />
          Write this one
        </button>
        {onTweak && (
          <button
            type="button"
            disabled={disabled}
            onClick={onTweak}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--foreground)] disabled:opacity-50"
          >
            <Pencil size="0.875rem" aria-hidden="true" />
            Tweak it
          </button>
        )}
      </div>
    </article>
  );
}
