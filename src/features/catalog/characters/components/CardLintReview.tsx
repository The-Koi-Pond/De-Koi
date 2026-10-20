import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle, Loader2, Wand2 } from "lucide-react";

import {
  cardLintFieldLabel,
  fixCardLintFinding,
  lintCharacterCard,
  type CardLintFinding,
} from "../../../../engine/entities/character-card-lint";
import { useUpdateCharacter } from "../hooks/use-characters";
import type { CardLintTarget } from "../lib/card-lint-target";

const SHOWN_EDITS = 3;

/** Lists what the card linter found in one saved character, with a previewed "Fix it" per finding. */
export function CardLintReview({ characterId, name, data: savedData }: CardLintTarget) {
  const updateCharacter = useUpdateCharacter();
  const [data, setData] = useState(savedData);
  const [fixedCount, setFixedCount] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const findings = useMemo(() => lintCharacterCard(data), [data]);

  if (findings.length === 0) {
    if (fixedCount === 0) return null;
    return (
      <p role="status" className="flex items-center gap-2 rounded-lg bg-emerald-500/10 p-3 text-xs">
        <CheckCircle size="0.875rem" className="shrink-0 text-emerald-500" aria-hidden="true" />
        {name}: all fixed. The card from before each fix is in the character's Versions.
      </p>
    );
  }

  const fix = async (finding: CardLintFinding) => {
    const patch = fixCardLintFinding(data, finding);
    setBusyId(finding.id);
    setError(null);
    try {
      await updateCharacter.mutateAsync({
        id: characterId,
        data: patch,
        versionSource: "card check",
        versionReason: `Before fixing: ${finding.title} (${cardLintFieldLabel(finding.field)})`,
      });
      setData((current) => ({ ...current, ...patch }));
      setFixedCount((count) => count + 1);
    } catch (fixError) {
      setError(
        `Couldn't save the fix: ${fixError instanceof Error ? fixError.message : "unknown error"}. The card is unchanged.`,
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section
      aria-label={`Card check for ${name}`}
      className="flex flex-col gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs"
    >
      <div className="flex items-center gap-2 font-medium">
        <AlertTriangle size="0.875rem" className="shrink-0 text-amber-500" aria-hidden="true" />
        {name}: {findings.length} thing{findings.length === 1 ? "" : "s"} in this card may trip up the model
      </div>
      <p className="text-[var(--muted-foreground)]">
        Nothing changes until you press Fix it. Each fix keeps the old card in the character's Versions.
      </p>
      <ul className="flex flex-col gap-2">
        {findings.map((finding) => (
          <li key={finding.id} className="rounded-md border border-[var(--border)] bg-[var(--background)]/40 p-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium">
                  {finding.title}
                  <span className="font-normal text-[var(--muted-foreground)]">
                    {" "}
                    · {cardLintFieldLabel(finding.field)}
                  </span>
                </div>
                <div className="text-[var(--muted-foreground)]">{finding.why}</div>
              </div>
              <button
                type="button"
                disabled={busyId !== null}
                onClick={() => void fix(finding)}
                aria-label={`Fix it: ${finding.title} in ${cardLintFieldLabel(finding.field)}`}
                className="flex shrink-0 items-center gap-1 rounded-md bg-[var(--primary)] px-2 py-1 font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {busyId === finding.id ? (
                  <Loader2 size="0.75rem" className="animate-spin" aria-hidden="true" />
                ) : (
                  <Wand2 size="0.75rem" aria-hidden="true" />
                )}
                Fix it
              </button>
            </div>
            <div className="mt-2 flex flex-col gap-1">
              {finding.edits.slice(0, SHOWN_EDITS).map((edit, index) => (
                <div key={index} className="grid grid-cols-[auto_1fr] gap-x-2 rounded bg-[var(--secondary)] p-1.5">
                  <span className="text-[0.625rem] font-semibold uppercase text-[var(--muted-foreground)]">Now</span>
                  <span className="break-words">{edit.before}</span>
                  <span className="text-[0.625rem] font-semibold uppercase text-[var(--muted-foreground)]">After</span>
                  <span className="break-words">{edit.after || <em>(line removed)</em>}</span>
                </div>
              ))}
              {finding.edits.length > SHOWN_EDITS && (
                <div className="text-[var(--muted-foreground)]">
                  …and {finding.edits.length - SHOWN_EDITS} more line
                  {finding.edits.length - SHOWN_EDITS === 1 ? "" : "s"} like these
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="text-[var(--destructive)]">
          {error}
        </p>
      )}
    </section>
  );
}
