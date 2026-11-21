import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import type {
  CampaignFocus,
  CampaignHeat,
  CampaignLength,
} from "../../../../../../engine/contracts/types/roleplay-campaign";
import { findLibraryPicks } from "../../../../../../engine/modes/roleplay/campaign/campaign-library";
import { storageApi } from "../../../../../../shared/api/storage-api";
import { toUserMessage } from "../../../../../../shared/lib/error-message";
import { cn } from "../../../../../../shared/lib/utils";
import { CAMPAIGN_STEP_LABELS, CAMPAIGN_STEPS, useCampaignBuild } from "./use-campaign-build";

export interface CampaignBuildRequest {
  ask: string;
  heat: CampaignHeat;
  length: CampaignLength;
  blind: boolean;
  limits: string[];
  /** Names of the player's own library characters to star in it. */
  characters: string[];
  /** Names of the player's own lorebooks for its world. */
  lorebooks: string[];
  focus?: CampaignFocus;
}

const HEAT_WORDS: Record<CampaignHeat, string> = { none: "Clean", fade: "Fade to black", explicit: "Spicy" };
const LENGTH_WORDS: Record<CampaignLength, string> = {
  short: "An evening",
  medium: "A few sessions",
  long: "A long haul",
};

type LibraryLookup =
  | { status: "loading" }
  | { status: "ready"; characterIds: string[]; lorebookIds: string[]; missing: string[] }
  | { status: "error"; message: string };

/**
 * Build button and progress for a campaign someone else already asked for (Deki-senpai's card). Named characters and
 * lorebooks are found in the library first and shown, including any it can't find. Uses the default connection and
 * the active persona; the build opens the campaign chat when it's ready.
 */
export function CampaignBuildPanel({ request }: { request: CampaignBuildRequest }) {
  const { start, stop, step } = useCampaignBuild();
  const building = step !== null;
  const named = request.characters.length + request.lorebooks.length > 0;
  const [lookup, setLookup] = useState<LibraryLookup>(() =>
    named ? { status: "loading" } : { status: "ready", characterIds: [], lorebookIds: [], missing: [] },
  );

  useEffect(() => {
    if (!named) return;
    let active = true;
    findLibraryPicks(storageApi, { characters: request.characters, lorebooks: request.lorebooks })
      .then((found) => {
        if (active) setLookup({ status: "ready", ...found });
      })
      .catch((error: unknown) => {
        if (active)
          setLookup({ status: "error", message: toUserMessage(error, { fallback: "Couldn't read your library." }) });
      });
    return () => {
      active = false;
    };
  }, [named, request.characters, request.lorebooks]);

  const found = (names: readonly string[]) =>
    lookup.status === "ready" ? names.filter((name) => !lookup.missing.includes(name)) : [];

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[0.6875rem] text-[var(--muted-foreground)]">
        {HEAT_WORDS[request.heat]} · {LENGTH_WORDS[request.length]} ·{" "}
        {request.blind ? "Going in blind" : "With a teaser"}
        {request.limits.length > 0 && ` · Never: ${request.limits.join(", ")}`}
      </p>
      {named && lookup.status === "loading" && (
        <p className="text-[0.6875rem] text-[var(--muted-foreground)]">Finding your characters and lorebooks…</p>
      )}
      {lookup.status === "ready" && found(request.characters).length > 0 && (
        <p className="text-[0.6875rem] text-[var(--foreground)]">
          Starring your: {found(request.characters).join(", ")}
        </p>
      )}
      {lookup.status === "ready" && found(request.lorebooks).length > 0 && (
        <p className="text-[0.6875rem] text-[var(--foreground)]">Set in your: {found(request.lorebooks).join(", ")}</p>
      )}
      {lookup.status === "ready" && lookup.missing.length > 0 && (
        <p className="text-[0.6875rem] text-amber-500">
          Not in your library, so it won't be used: {lookup.missing.join(", ")}
        </p>
      )}
      {lookup.status === "error" && <p className="text-[0.6875rem] text-red-500">{lookup.message}</p>}
      {building ? (
        <div className="flex flex-col gap-1.5" aria-live="polite">
          <ol className="flex flex-col gap-1">
            {CAMPAIGN_STEPS.map((candidate, index) => {
              const current = CAMPAIGN_STEPS.indexOf(step);
              const done = index < current;
              const active = index === current;
              return (
                <li key={candidate} className="flex items-center gap-1.5">
                  {done ? (
                    <Check size="0.8rem" aria-hidden="true" className="text-emerald-500" />
                  ) : active ? (
                    <Loader2 size="0.8rem" aria-hidden="true" className="animate-spin text-[var(--primary)]" />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="h-[0.8rem] w-[0.8rem] rounded-full ring-1 ring-[var(--border)]"
                    />
                  )}
                  <span className={cn(active ? "font-semibold" : "text-[var(--muted-foreground)]")}>
                    {CAMPAIGN_STEP_LABELS[candidate]}
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="text-[0.6875rem] text-[var(--muted-foreground)]">
            A few minutes. Keep De-Koi open; the campaign opens when it's ready.
          </p>
          <button
            type="button"
            onClick={stop}
            className="self-start rounded-lg px-2.5 py-1 text-[0.6875rem] ring-1 ring-[var(--border)] hover:bg-[var(--accent)]"
          >
            Stop
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={lookup.status !== "ready"}
          onClick={() => {
            if (lookup.status !== "ready") return;
            void start({
              ask: request.ask,
              focus: request.focus ?? null,
              heat: request.heat,
              limits: request.limits,
              length: request.length,
              blind: request.blind,
              connectionId: null,
              personaId: null,
              characterIds: lookup.characterIds,
              lorebookIds: lookup.lorebookIds,
            });
          }}
          className="self-start rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50"
        >
          Build my campaign
        </button>
      )}
    </div>
  );
}
