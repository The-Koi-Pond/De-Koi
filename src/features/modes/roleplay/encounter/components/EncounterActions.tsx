import { useState, type FormEvent, type ReactNode } from "react";
import { Loader2, Send } from "lucide-react";
import {
  encounterActionText,
  encounterChoiceName,
  encounterTargets,
  type EncounterChoice,
} from "../../../../../engine/modes/roleplay/encounter/encounter-actions";
import type { EncounterAttack, EncounterFight } from "../../../../../engine/modes/roleplay/encounter/encounter-types";
import { Modal } from "../../../../../shared/components/ui/Modal";

const ACTION_BUTTON_CLASS =
  "rounded-lg border border-[var(--border)] bg-[var(--secondary)]/60 px-2.5 py-1.5 text-left text-xs hover:bg-[var(--accent)] disabled:opacity-40";

const ATTACK_TYPE_LABELS: Record<EncounterAttack["type"], string> = {
  "single-target": "Single target",
  AoE: "AoE",
  both: "Single or AoE",
};

function TargetDialog(props: {
  fight: EncounterFight;
  choice: EncounterChoice;
  onPick: (target: string | null) => void;
  onCancel: () => void;
}) {
  const targets = encounterTargets(props.fight, props.choice);
  return (
    <Modal open onClose={props.onCancel} title="Select target" width="max-w-sm">
      <div className="space-y-2">
        <p className="text-xs text-[var(--muted-foreground)]">{encounterChoiceName(props.choice)}</p>
        {targets.allEnemies && (
          <button type="button" onClick={() => props.onPick(null)} className={`${ACTION_BUTTON_CLASS} w-full`}>
            All enemies
          </button>
        )}
        {targets.allEnemies && targets.combatants.length > 0 && (
          <p className="text-center text-[0.6875rem] text-[var(--muted-foreground)]">or</p>
        )}
        {targets.combatants.map((target) => (
          <button
            key={`${target.side}-${target.name}`}
            type="button"
            onClick={() => props.onPick(target.name)}
            className={`${ACTION_BUTTON_CLASS} flex w-full items-center justify-between gap-2`}
          >
            <span>
              {target.name}
              <span className="ml-1 text-[var(--muted-foreground)]">
                ({target.side === "enemy" ? "enemy" : "party"})
              </span>
            </span>
            <span className="tabular-nums text-[var(--muted-foreground)]">
              {target.hp}/{target.maxHp} HP
            </span>
          </button>
        ))}
        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={props.onCancel}
            className="rounded-lg px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}

function CustomAction({ onSend }: { onSend: (text: string) => void }) {
  const [text, setText] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    onSend(text);
    setText("");
  };
  return (
    <form onSubmit={submit} className="flex gap-1.5">
      <input
        value={text}
        onChange={(change) => setText(change.target.value)}
        placeholder="Describe what you do..."
        aria-label="Custom action"
        className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-xs outline-none focus:border-[var(--ring)]"
      />
      <button
        type="submit"
        disabled={!text.trim()}
        aria-label="Send action"
        className="de-koi-icon-target rounded-lg bg-[var(--primary)] px-2.5 text-[var(--primary-foreground)] disabled:opacity-40"
      >
        <Send size="0.8rem" aria-hidden="true" />
      </button>
    </form>
  );
}

function ActionGroup(props: { heading: string; children: ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="text-[0.6875rem] font-semibold text-[var(--muted-foreground)]">{props.heading}</h3>
      <div className="flex flex-wrap gap-1.5">{props.children}</div>
    </section>
  );
}

/** "Your actions": attacks and items open the target picker; a custom action is sent as typed. */
export function EncounterActions(props: {
  fight: EncounterFight;
  processing: boolean;
  turnError: string | null;
  onAction: (text: string) => void;
}) {
  const [choice, setChoice] = useState<EncounterChoice | null>(null);
  const player = props.fight.party.find((member) => member.isPlayer);

  let body: ReactNode;
  if (!props.fight.party.length) {
    body = <p className="text-xs text-[var(--muted-foreground)]">Waiting for combat data...</p>;
  } else if (!player || player.hp <= 0) {
    body = <p className="text-xs text-red-800 dark:text-red-300">You have been defeated...</p>;
  } else if (props.processing) {
    body = (
      <p role="status" className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
        <Loader2 size="0.8rem" className="animate-spin" aria-hidden="true" />
        Processing action...
      </p>
    );
  } else {
    const { attacks, items } = props.fight.playerActions;
    body = (
      <div className="space-y-2">
        {attacks.length > 0 && (
          <ActionGroup heading="Attacks">
            {attacks.map((attack, index) => (
              <button
                key={`${attack.name}-${index}`}
                type="button"
                onClick={() => setChoice({ type: "attack", attack })}
                title={attack.description}
                className={ACTION_BUTTON_CLASS}
              >
                {attack.name}
                <span className="ml-1 text-[0.625rem] text-[var(--muted-foreground)]">
                  {ATTACK_TYPE_LABELS[attack.type]}
                </span>
              </button>
            ))}
          </ActionGroup>
        )}
        {items.length > 0 && (
          <ActionGroup heading="Items">
            {items.map((item, index) => (
              <button
                key={`${item}-${index}`}
                type="button"
                onClick={() => setChoice({ type: "item", item })}
                className={ACTION_BUTTON_CLASS}
              >
                {item}
              </button>
            ))}
          </ActionGroup>
        )}
        <section className="space-y-1">
          <h3 className="text-[0.6875rem] font-semibold text-[var(--muted-foreground)]">Custom action</h3>
          <CustomAction onSend={props.onAction} />
        </section>
      </div>
    );
  }

  return (
    <section aria-label="Your actions" className="space-y-1.5">
      <h2 className="text-xs font-semibold">Your actions</h2>
      {body}
      {props.turnError && (
        <p role="alert" className="text-xs text-red-800 dark:text-red-300">
          {props.turnError}
        </p>
      )}
      {choice && (
        <TargetDialog
          fight={props.fight}
          choice={choice}
          onCancel={() => setChoice(null)}
          onPick={(target) => {
            setChoice(null);
            props.onAction(encounterActionText(choice, target));
          }}
        />
      )}
    </section>
  );
}
