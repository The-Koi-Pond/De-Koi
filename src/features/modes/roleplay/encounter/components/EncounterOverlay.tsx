import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { Flag, Loader2, RotateCcw, X } from "lucide-react";
import type { EncounterFight } from "../../../../../engine/modes/roleplay/encounter/encounter-types";
import { useEscapeOverlay } from "../../../../../shared/hooks/use-escape-overlay";
import { showConfirmDialog } from "../../../../../shared/lib/app-dialogs";
import { keepTabInside } from "../../../../../shared/lib/focus-trap";
import { motionStyle } from "../../../../../shared/lib/motion";
import { cn } from "../../../../../shared/lib/utils";
import { useRoleplayEncounterStore, type Encounter } from "../../../../../shared/stores/roleplay-encounter.store";
import { useFocusInAndBack } from "../hooks/use-focus-in-and-back";
import { useRoleplayEncounter } from "../hooks/use-roleplay-encounter";
import { EncounterActions } from "./EncounterActions";
import { EnemyCard, PartyCard } from "./EncounterCombatants";
import { EncounterEnd } from "./EncounterEnd";
import { EncounterLog } from "./EncounterLog";

const ENVIRONMENT_TINTS: Record<string, string> = {
  forest: "from-emerald-600/20",
  dungeon: "from-stone-600/25",
  desert: "from-amber-500/20",
  cave: "from-zinc-600/25",
  city: "from-slate-500/20",
  ruins: "from-yellow-700/20",
  snow: "from-sky-200/25",
  water: "from-cyan-500/20",
  castle: "from-indigo-600/20",
  wasteland: "from-orange-800/20",
  plains: "from-lime-500/15",
  mountains: "from-slate-400/20",
  swamp: "from-green-800/25",
  volcanic: "from-red-700/25",
  spaceship: "from-violet-600/20",
  mansion: "from-rose-800/20",
};

const PANEL_MOTION = motionStyle({ enterFrom: { y: 8, scale: 0.98 }, durationMs: 180 });
const BACKDROP_MOTION = motionStyle({ durationMs: 150 });

function askToEndCombat(close: () => void) {
  void showConfirmDialog({
    title: "End combat",
    message: "Close and end this combat?",
    confirmLabel: "End combat",
    tone: "destructive",
  }).then((confirmed) => {
    if (confirmed) close();
  });
}

function askToConclude(conclude: () => Promise<void>) {
  void showConfirmDialog({
    title: "Conclude encounter",
    message: "Conclude this encounter early?",
    confirmLabel: "Conclude",
  }).then((confirmed) => {
    if (confirmed) void conclude();
  });
}

function FightView(props: { encounter: Encounter; fight: EncounterFight }) {
  const { sendAction, retrySummary, close } = useRoleplayEncounter();
  const processing = useRoleplayEncounterStore((state) => state.pending?.kind === "turn");
  const { encounter, fight } = props;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {/* Big fights and phone screens scroll here, so the actions below always stay in reach. */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain">
        <p className="text-center text-xs italic text-[var(--muted-foreground)]">
          {fight.environment || "Battle arena"}
        </p>
        <ul className="grid shrink-0 grid-cols-2 gap-1.5 sm:grid-cols-3" aria-label="Enemies">
          {fight.enemies.map((enemy, index) => (
            <EnemyCard key={`${enemy.name}-${index}`} enemy={enemy} />
          ))}
        </ul>
        <ul className="grid shrink-0 grid-cols-2 gap-1.5 sm:grid-cols-4" aria-label="Party">
          {fight.party.map((member, index) => (
            <PartyCard key={`${member.name}-${index}`} member={member} />
          ))}
        </ul>
        <EncounterLog log={encounter.log} />
      </div>
      <div className="max-h-[50%] shrink-0 overflow-y-auto overscroll-contain border-t border-[var(--border)] pt-2">
        {encounter.stage === "ended" && encounter.result ? (
          <EncounterEnd
            result={encounter.result}
            summaryStatus={encounter.summaryStatus}
            onRetrySummary={() => void retrySummary()}
            onClose={close}
          />
        ) : (
          <EncounterActions
            fight={fight}
            processing={processing}
            turnError={encounter.turnError}
            onAction={(text) => void sendAction(text)}
          />
        )}
      </div>
    </div>
  );
}

function StartView({ encounter }: { encounter: Encounter }) {
  const { retryStart, close } = useRoleplayEncounter();
  if (encounter.stage === "start-failed") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <p role="alert" className="max-w-sm text-sm text-red-800 dark:text-red-300">
          {encounter.startError}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void retryStart()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-semibold text-[var(--primary-foreground)]"
          >
            <RotateCcw size="0.8rem" aria-hidden="true" />
            Retry
          </button>
          <button
            type="button"
            onClick={close}
            className="rounded-lg px-3 py-2 text-xs font-semibold text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
          >
            Close
          </button>
        </div>
      </div>
    );
  }
  return (
    <p role="status" className="flex flex-1 items-center justify-center gap-2 text-sm text-[var(--muted-foreground)]">
      <Loader2 size="1rem" className="animate-spin" aria-hidden="true" />
      Initializing combat encounter...
    </p>
  );
}

/** The combat window over a Roleplay chat. The chat itself doesn't change until the summary is written. */
export function EncounterOverlay({ encounter }: { encounter: Encounter }) {
  const { close, conclude } = useRoleplayEncounter();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Once the fight is over there's nothing left to lose by closing (the summary is written or can't be), so no ask.
  const fightOver = encounter.stage === "ended";
  const requestClose = () => (fightOver ? close() : askToEndCombat(close));
  useFocusInAndBack(panelRef);
  useEscapeOverlay(() => {
    requestClose();
    return true;
  });

  const tint = ENVIRONMENT_TINTS[encounter.fight?.styleNotes.environmentType.toLowerCase() ?? ""] ?? "from-transparent";

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-3">
      <div
        aria-hidden="true"
        className="motion-enter absolute inset-0 bg-black/60 backdrop-blur-sm"
        style={BACKDROP_MOTION}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-component="EncounterOverlay"
        style={PANEL_MOTION}
        onKeyDown={(event) => keepTabInside(event, panelRef.current)}
        className="motion-enter relative isolate flex h-[85dvh] w-full max-w-[600px] flex-col gap-2 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 text-[var(--card-foreground)] shadow-2xl shadow-black/50 outline-none"
      >
        {/* A layer of its own: on the panel, the gradient would replace the card background instead of tinting it. */}
        <div
          aria-hidden="true"
          className={cn("pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b to-transparent", tint)}
        />
        <header className="flex shrink-0 items-center justify-between gap-2">
          <h2 id={titleId} className="text-sm font-semibold">
            Combat encounter
          </h2>
          <div className="flex items-center gap-1">
            {encounter.stage === "fighting" && (
              <button
                type="button"
                onClick={() => askToConclude(conclude)}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
              >
                <Flag size="0.8rem" aria-hidden="true" />
                Conclude
              </button>
            )}
            <button
              type="button"
              onClick={requestClose}
              aria-label={fightOver ? "Close combat window" : "End combat"}
              className="de-koi-icon-target rounded-lg text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            >
              <X size="1rem" aria-hidden="true" />
            </button>
          </div>
        </header>
        {encounter.fight ? (
          <FightView encounter={encounter} fight={encounter.fight} />
        ) : (
          <StartView encounter={encounter} />
        )}
      </div>
    </div>,
    document.body,
  );
}
