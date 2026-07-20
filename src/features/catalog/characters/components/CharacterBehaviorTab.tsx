import { useState } from "react";
import { Check, RefreshCw, ShieldCheck } from "lucide-react";

import type {
  CharacterBehavioralClaim,
  CharacterBehavioralInterpretation,
  CharacterData,
} from "../../../../engine/contracts/types/character";
import {
  behavioralInterpretationSourceHash,
  BEHAVIORAL_INTERPRETATION_VERSION,
  isBehavioralInterpretationCurrent,
} from "../../../../engine/generation/behavioral-interpretation";
import { CharacterEditorSectionHeader } from "./CharacterEditorSectionHeader";

type CharacterBehaviorTabProps = {
  data: CharacterData;
  profile?: CharacterBehavioralInterpretation;
  onChange: (profile: CharacterBehavioralInterpretation) => void;
};

function evidenceLabel(value: string): string {
  return value.replaceAll("_", " ");
}

export function CharacterBehaviorTab({ data, profile, onChange }: CharacterBehaviorTabProps) {
  const [correction, setCorrection] = useState("");
  const sourceHash = behavioralInterpretationSourceHash(data);
  const current = isBehavioralInterpretationCurrent(data, profile);
  const claims = profile?.claims ?? [];
  const status =
    profile?.enabled === false
      ? "Disabled"
      : profile?.regenerationRequested === true
        ? "Regeneration queued; the current interpretation stays active"
        : profile?.status === "pending"
          ? "Queued for the next successful reply"
          : profile?.status === "failed"
            ? "The last automatic interpretation failed"
            : !profile
              ? "Not needed yet"
              : current
                ? "Current"
                : "Needs regeneration";

  const requestRegeneration = () => {
    if (profile && current) {
      onChange({
        ...profile,
        enabled: true,
        regenerationRequested: true,
        lastError: undefined,
      });
      return;
    }
    onChange({
      version: BEHAVIORAL_INTERPRETATION_VERSION,
      sourceHash,
      status: "pending",
      enabled: true,
      claims,
    });
  };

  const addCorrection = () => {
    const statement = correction.trim();
    if (!statement) return;
    const userCorrection: CharacterBehavioralClaim = {
      id: `user-${Date.now()}`,
      statement: statement.slice(0, 240),
      evidenceClass: "explicit",
      evidence: [{ field: "user_override", quote: "User correction" }],
      source: "user_override",
    };
    onChange({
      version: BEHAVIORAL_INTERPRETATION_VERSION,
      sourceHash,
      status: "ready",
      enabled: true,
      claims: [...claims, userCorrection].slice(-8),
      generatedAt: profile?.generatedAt,
      generatorConnectionId: profile?.generatorConnectionId,
    });
    setCorrection("");
  };

  return (
    <div className="space-y-5">
      <CharacterEditorSectionHeader
        title="Behavior"
        subtitle="De-Koi can quietly infer a few evidence-backed tendencies when an authored card is sparse. Authored text always wins."
      />

      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)]/55 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck size="1rem" className="text-emerald-400" />
              Behavioral interpretation
            </div>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">{status}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {profile && (
              <button
                type="button"
                aria-label={profile.enabled === false ? "Enable interpretation" : "Disable interpretation"}
                onClick={() => {
                  const enabled = profile.enabled === false;
                  onChange({
                    ...profile,
                    enabled,
                    regenerationRequested: enabled ? profile.regenerationRequested : false,
                  });
                }}
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs hover:bg-[var(--accent)]"
              >
                {profile.enabled === false ? "Enable" : "Disable"}
              </button>
            )}
            <button
              type="button"
              aria-label="Regenerate interpretation"
              onClick={requestRegeneration}
              className="flex items-center gap-1.5 rounded-lg bg-purple-500/15 px-3 py-2 text-xs text-purple-300 hover:bg-purple-500/25"
            >
              <RefreshCw size="0.8rem" />
              {profile ? "Regenerate" : "Generate"}
            </button>
          </div>
        </div>
        {profile?.lastError && <p className="mt-3 text-xs text-amber-300">{profile.lastError}</p>}
        <p className="mt-3 text-[0.6875rem] text-[var(--muted-foreground)]">
          Generation is non-blocking and uses the active text-model connection after a reply is saved.
        </p>
      </div>

      <div className="space-y-3">
        {claims.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--border)] p-5 text-center text-xs text-[var(--muted-foreground)]">
            No derived claims. Rich cards are left alone; sparse cards are interpreted automatically after use.
          </div>
        ) : (
          claims.map((claim) => (
            <article key={claim.id} className="rounded-xl border border-[var(--border)] bg-black/15 p-4">
              <div className="flex items-start gap-2">
                <Check size="0.9rem" className="mt-0.5 shrink-0 text-emerald-400" />
                <div className="min-w-0">
                  <p className="text-sm leading-relaxed">{claim.statement}</p>
                  <p className="mt-1 text-[0.625rem] uppercase tracking-wider text-[var(--muted-foreground)]">
                    {claim.source === "user_override" ? "Your correction" : evidenceLabel(claim.evidenceClass)}
                  </p>
                </div>
              </div>
              {claim.evidence.map((evidence, index) => (
                <blockquote
                  key={`${evidence.field}-${index}`}
                  className="mt-3 border-l-2 border-purple-400/40 pl-3 text-xs text-[var(--muted-foreground)]"
                >
                  <span className="font-medium capitalize">{evidenceLabel(evidence.field)}:</span> “{evidence.quote}”
                </blockquote>
              ))}
            </article>
          ))
        )}
      </div>

      <div className="space-y-2 rounded-xl border border-[var(--border)] p-4">
        <label htmlFor="behavior-correction" className="text-sm font-semibold">
          Correct De-Koi
        </label>
        <p className="text-xs text-[var(--muted-foreground)]">
          Add a rule that should override generated interpretations without changing exported card data.
        </p>
        <textarea
          id="behavior-correction"
          aria-label="Behavior correction"
          value={correction}
          onChange={(event) => setCorrection(event.target.value)}
          rows={3}
          placeholder={`${data.name || "This character"} answers directly once trust is earned.`}
          className="w-full resize-y rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2 text-sm outline-none focus:border-purple-400/60"
        />
        <button
          type="button"
          aria-label="Add behavior correction"
          disabled={!correction.trim()}
          onClick={addCorrection}
          className="rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-40"
        >
          Add correction
        </button>
      </div>
    </div>
  );
}
