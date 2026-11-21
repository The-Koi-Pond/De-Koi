import { useId, useState } from "react";
import { ArrowLeft, Check, Loader2, ScrollText, X } from "lucide-react";
import type { CampaignHeat, CampaignLength } from "../../../../../../engine/contracts/types/roleplay-campaign";
import { cn } from "../../../../../../shared/lib/utils";
import type { ConnectionSummary } from "../../../../../catalog/connections/index";
import { SetupConnectionPicker } from "./SetupConnectionPicker";
import { SetupPersonaPicker } from "./SetupPersonaPicker";
import {
  SETUP_FIELD_LABEL_CLASS,
  SETUP_ICON_BUTTON_CLASS,
  SETUP_INPUT_CLASS,
  SETUP_PRIMARY_BUTTON_CLASS,
  SETUP_QUIET_BUTTON_CLASS,
  SETUP_SECTION_HEADING_CLASS,
} from "./setup-styles";
import { CAMPAIGN_STEP_LABELS, CAMPAIGN_STEPS, useCampaignBuild } from "./use-campaign-build";

const HEAT_OPTIONS: ReadonlyArray<{ value: CampaignHeat; label: string; help: string }> = [
  { value: "none", label: "Keep it clean", help: "No sex." },
  { value: "fade", label: "Fade to black", help: "Romance on the page, sex off it." },
  { value: "explicit", label: "Spicy", help: "Sex on the page when you go there." },
];

const LENGTH_OPTIONS: ReadonlyArray<{ value: CampaignLength; label: string; help: string }> = [
  { value: "short", label: "An evening", help: "About 30 replies." },
  { value: "medium", label: "A few sessions", help: "About 80 replies." },
  { value: "long", label: "A long haul", help: "About 200 replies." },
];

const EXAMPLE_ASK = "A Gothic Victorian mystery that really tests my ethics, with hard choices. Oh, and monsterboys.";

function ChoiceRow<T extends string>({
  labelledBy,
  options,
  value,
  onChange,
  disabled,
}: {
  labelledBy: string;
  options: ReadonlyArray<{ value: T; label: string; help: string }>;
  value: T;
  onChange: (value: T) => void;
  disabled: boolean;
}) {
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex flex-col items-start rounded-lg px-3 py-2 text-left ring-1 transition-colors disabled:opacity-60",
              checked
                ? "bg-[var(--primary)]/10 ring-[var(--primary)]"
                : "bg-[var(--secondary)] ring-[var(--border)] hover:bg-[var(--accent)]",
            )}
          >
            <span className="text-xs font-semibold text-[var(--foreground)]">{option.label}</span>
            <span className="text-[0.6875rem] text-[var(--muted-foreground)]">{option.help}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Play a campaign: the player says what they want, answers three spoiler-free questions, and De-Koi plans the rest.
 * The build makes its own chat (with a narrator card and a lorebook) and opens it; this setup's draft is dropped by
 * the usual draft rules because nothing was written in it.
 */
export function CampaignSetupCard({
  titleId,
  connectionId,
  connections,
  allConnections,
  connectionsLoading,
  personaId,
  folderId,
  onPickConnection,
  onPickPersona,
  onSetUpConnection,
  onBack,
  onClose,
}: {
  titleId: string;
  connectionId: string | null;
  connections: readonly ConnectionSummary[];
  allConnections: readonly ConnectionSummary[];
  connectionsLoading: boolean;
  personaId: string | null;
  folderId: string | null;
  onPickConnection: (connectionId: string | null) => void;
  onPickPersona: (personaId: string | null) => void;
  onSetUpConnection: () => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const askId = useId();
  const heatId = useId();
  const lengthId = useId();
  const limitsId = useId();
  const personaHeadingId = useId();
  const [ask, setAsk] = useState("");
  const [heat, setHeat] = useState<CampaignHeat>("fade");
  const [length, setLength] = useState<CampaignLength>("medium");
  const [limits, setLimits] = useState("");
  const [blind, setBlind] = useState(false);
  const { start, stop, step } = useCampaignBuild();
  const building = step !== null;
  const canBuild = ask.trim().length > 0 && !building && connections.length > 0;

  const build = () => {
    if (!canBuild) return;
    void start({
      ask,
      focus: null,
      heat,
      limits: limits
        .split(/[,;\n]/)
        .map((limit) => limit.trim())
        .filter(Boolean),
      length,
      blind,
      connectionId,
      personaId,
      folderId,
    });
  };

  return (
    <>
      <header className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-3">
        <button
          type="button"
          aria-label="Back"
          onClick={onBack}
          disabled={building}
          className={SETUP_ICON_BUTTON_CLASS}
        >
          <ArrowLeft size="1rem" aria-hidden="true" />
        </button>
        <ScrollText size="1rem" aria-hidden="true" className="shrink-0 text-[var(--primary)]" />
        <h2 id={titleId} className="de-koi-display-title min-w-0 flex-1 truncate text-base font-bold">
          Play a campaign
        </h2>
        <button type="button" aria-label="Close" onClick={onClose} className={SETUP_ICON_BUTTON_CLASS}>
          <X size="1rem" aria-hidden="true" />
        </button>
      </header>

      {building ? (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-5" aria-live="polite">
          <p className="text-xs text-[var(--muted-foreground)]">
            Planning your campaign. This takes a few minutes; you can close this and keep using the app, and the
            campaign opens when it's ready. Keep De-Koi open until then.
          </p>
          <ol className="flex flex-col gap-2">
            {CAMPAIGN_STEPS.map((candidate) => {
              const index = CAMPAIGN_STEPS.indexOf(candidate);
              const current = CAMPAIGN_STEPS.indexOf(step);
              const done = index < current;
              const active = index === current;
              return (
                <li key={candidate} className="flex items-center gap-2 text-xs">
                  {done ? (
                    <Check size="0.9rem" aria-hidden="true" className="text-[var(--primary)]" />
                  ) : active ? (
                    <Loader2 size="0.9rem" aria-hidden="true" className="animate-spin text-[var(--primary)]" />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="h-[0.9rem] w-[0.9rem] rounded-full ring-1 ring-[var(--border)]"
                    />
                  )}
                  <span
                    className={cn(active ? "font-semibold text-[var(--foreground)]" : "text-[var(--muted-foreground)]")}
                  >
                    {CAMPAIGN_STEP_LABELS[candidate]}
                    {done && <span className="sr-only"> (done)</span>}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 py-4">
          <p className="text-xs text-[var(--muted-foreground)]">
            Say what you're in the mood for. De-Koi plans the story, the cast and the secrets, then runs it for you, so
            you just play.
          </p>
          <div>
            <label htmlFor={askId} className={SETUP_FIELD_LABEL_CLASS}>
              What should it be about?
            </label>
            <textarea
              id={askId}
              value={ask}
              rows={4}
              maxLength={2000}
              placeholder={EXAMPLE_ASK}
              onChange={(event) => setAsk(event.target.value)}
              className={cn(SETUP_INPUT_CLASS, "resize-y leading-5")}
            />
          </div>
          <section className="flex flex-col gap-1.5">
            <h3 id={heatId} className={SETUP_SECTION_HEADING_CLASS}>
              How spicy?
            </h3>
            <ChoiceRow labelledBy={heatId} options={HEAT_OPTIONS} value={heat} onChange={setHeat} disabled={building} />
          </section>
          <div>
            <label htmlFor={limitsId} className={SETUP_FIELD_LABEL_CLASS}>
              Anything off the table? (optional)
            </label>
            <input
              id={limitsId}
              value={limits}
              maxLength={400}
              placeholder="Separate with commas"
              onChange={(event) => setLimits(event.target.value)}
              className={SETUP_INPUT_CLASS}
            />
          </div>
          <section className="flex flex-col gap-1.5">
            <h3 id={lengthId} className={SETUP_SECTION_HEADING_CLASS}>
              How long?
            </h3>
            <ChoiceRow
              labelledBy={lengthId}
              options={LENGTH_OPTIONS}
              value={length}
              onChange={setLength}
              disabled={building}
            />
          </section>
          <label className="flex items-start gap-2 text-xs text-[var(--foreground)]">
            <input
              type="checkbox"
              checked={blind}
              onChange={(event) => setBlind(event.target.checked)}
              className="mt-0.5"
            />
            <span>
              Go in blind
              <span className="block text-[0.6875rem] text-[var(--muted-foreground)]">
                No teaser when it's ready. You find out everything by playing.
              </span>
            </span>
          </label>
          <section className="flex flex-col gap-2">
            <h3 id={personaHeadingId} className={SETUP_SECTION_HEADING_CLASS}>
              Who you play
            </h3>
            <SetupPersonaPicker personaId={personaId} labelledBy={personaHeadingId} onPick={onPickPersona} />
          </section>
          <SetupConnectionPicker
            connectionId={connectionId}
            connections={connections}
            savedConnections={allConnections}
            loading={connectionsLoading}
            onChange={onPickConnection}
            onSetUpConnection={onSetUpConnection}
          />
          <p className="text-[0.6875rem] text-[var(--muted-foreground)]">
            Planning uses this connection for a few minutes; a strong model plans a better campaign. After each reply, a
            short extra call keeps the game master's notes.
          </p>
        </div>
      )}

      <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--border)] px-4 py-3">
        {building ? (
          <>
            <button type="button" onClick={stop} className={SETUP_QUIET_BUTTON_CLASS}>
              Stop
            </button>
            <button type="button" onClick={onClose} className={SETUP_PRIMARY_BUTTON_CLASS}>
              Keep using the app
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={onBack} className={SETUP_QUIET_BUTTON_CLASS}>
              Back
            </button>
            <button type="button" disabled={!canBuild} onClick={build} className={SETUP_PRIMARY_BUTTON_CLASS}>
              Build my campaign
            </button>
          </>
        )}
      </footer>
    </>
  );
}
