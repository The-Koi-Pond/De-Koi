import { useId, useState, type FormEvent } from "react";
import { Swords } from "lucide-react";
import { ENCOUNTER_HISTORY_DEPTH } from "../../../../../engine/modes/roleplay/encounter/encounter-rules";
import type { EncounterNarrationStyle } from "../../../../../engine/modes/roleplay/encounter/encounter-types";
import { Modal } from "../../../../../shared/components/ui/Modal";
import { cn } from "../../../../../shared/lib/utils";
import { useRoleplayEncounterStore } from "../../../../../shared/stores/roleplay-encounter.store";
import { useLorebooks } from "../../../../catalog/lorebooks/index";
import { useRoleplayEncounter } from "../hooks/use-roleplay-encounter";

type Option<T extends string> = { value: T; label: string };

const TENSES: Option<EncounterNarrationStyle["tense"]>[] = [
  { value: "present", label: "Present" },
  { value: "past", label: "Past" },
];
const PERSONS: Option<EncounterNarrationStyle["person"]>[] = [
  { value: "first", label: "First" },
  { value: "second", label: "Second" },
  { value: "third", label: "Third" },
];
const NARRATIONS: Option<EncounterNarrationStyle["narration"]>[] = [
  { value: "omniscient", label: "Omniscient" },
  { value: "limited", label: "Limited" },
];

const FIELD_CLASS =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-xs outline-none focus:border-[var(--ring)]";

function ChoiceRow<T extends string>(props: {
  label: string;
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={props.label}>
      <span className="w-20 text-[0.6875rem] text-[var(--muted-foreground)]">{props.label}</span>
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={props.value === option.value}
          onClick={() => props.onChange(option.value)}
          className={cn(
            "rounded-full px-2.5 py-1 text-[0.6875rem] ring-1 ring-[var(--border)] hover:bg-[var(--accent)]",
            props.value === option.value &&
              "bg-[var(--primary)]/15 font-semibold text-[var(--foreground)] ring-[var(--primary)]",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function NarrationFields(props: {
  legend: string;
  value: EncounterNarrationStyle;
  onChange: (value: EncounterNarrationStyle) => void;
}) {
  const povId = useId();
  const { value, onChange } = props;
  return (
    <fieldset className="space-y-1.5 rounded-lg border border-[var(--border)]/60 p-3">
      <legend className="px-1 text-xs font-semibold text-[var(--foreground)]">{props.legend}</legend>
      <ChoiceRow
        label="Tense"
        options={TENSES}
        value={value.tense}
        onChange={(tense) => onChange({ ...value, tense })}
      />
      <ChoiceRow
        label="Person"
        options={PERSONS}
        value={value.person}
        onChange={(person) => onChange({ ...value, person })}
      />
      <ChoiceRow
        label="Narration"
        options={NARRATIONS}
        value={value.narration}
        onChange={(narration) => onChange({ ...value, narration })}
      />
      <div className="flex items-center gap-1.5">
        <label htmlFor={povId} className="w-20 text-[0.6875rem] text-[var(--muted-foreground)]">
          Point of view
        </label>
        <input
          id={povId}
          value={value.pov}
          placeholder="narrator"
          onChange={(change) => onChange({ ...value, pov: change.target.value })}
          className={FIELD_CLASS}
        />
      </div>
    </fieldset>
  );
}

/** "Configure combat narrative": the narration choices and spellbook a new encounter starts with. */
export function EncounterSetupDialog() {
  const narration = useRoleplayEncounterStore((state) => state.narration);
  const setNarration = useRoleplayEncounterStore((state) => state.setNarration);
  const { begin, close } = useRoleplayEncounter();
  const spellbooks = useLorebooks("spellbook");
  const [spellbookId, setSpellbookId] = useState("");
  const spellbookFieldId = useId();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void begin({
      combatNarration: narration.combat,
      summaryNarration: narration.summary,
      spellbookId: spellbookId || null,
      historyDepth: ENCOUNTER_HISTORY_DEPTH,
    });
  };

  return (
    <Modal open onClose={close} title="Configure combat narrative" width="max-w-lg">
      <form onSubmit={submit} className="space-y-3">
        <NarrationFields
          legend="Combat narration"
          value={narration.combat}
          onChange={(combat) => setNarration({ ...narration, combat })}
        />
        <NarrationFields
          legend="Summary narration"
          value={narration.summary}
          onChange={(summary) => setNarration({ ...narration, summary })}
        />
        <div className="space-y-1">
          <label htmlFor={spellbookFieldId} className="block text-xs font-semibold text-[var(--foreground)]">
            Spellbook
          </label>
          <select
            id={spellbookFieldId}
            value={spellbookId}
            onChange={(change) => setSpellbookId(change.target.value)}
            className={FIELD_CLASS}
          >
            <option value="">None</option>
            {(spellbooks.data ?? []).map((spellbook) => (
              <option key={spellbook.id} value={spellbook.id}>
                {spellbook.name}
              </option>
            ))}
          </select>
          <p className="text-[0.6875rem] text-[var(--muted-foreground)]">
            Attach a spellbook so the AI knows which spells and abilities are available in combat.
          </p>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={close}
            className="rounded-lg px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-semibold text-[var(--primary-foreground)]"
          >
            <Swords size="0.8rem" aria-hidden="true" />
            Begin combat
          </button>
        </div>
      </form>
    </Modal>
  );
}
