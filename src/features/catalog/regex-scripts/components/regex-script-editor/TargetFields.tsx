import { Check, Minus, Play, Plus, Users, X } from "lucide-react";
import type { RegexPlacement } from "../../../../../engine/contracts/types/regex";
import { cn } from "../../../../../shared/lib/utils";
import { nextRegexScriptTargetCharacterIds } from "../../lib/regex-script-editor-state";
import { FIELD_RING, FIELD_SURFACE, FieldGroup, optionTone } from "./FieldGroup";
import { toggleRegexPlacement } from "./regex-script-form";
import type { RegexScriptEditorModel } from "./use-regex-script-editor";

const PLACES: ReadonlyArray<{ value: RegexPlacement; label: string; description: string }> = [
  { value: "ai_output", label: "AI Output", description: "Applied to AI responses before they are displayed." },
  { value: "user_input", label: "User Input", description: "Applied to your messages before they are sent." },
];

export function ApplyToGroup({ editor }: { editor: RegexScriptEditorModel }) {
  const { form, edit } = editor;
  return (
    <FieldGroup
      icon={Play}
      label="Apply To"
      help="Where this regex is applied. AI Output transforms incoming responses; User Input transforms your messages before sending."
    >
      <div className="grid grid-cols-2 gap-2">
        {PLACES.map((place) => {
          const selected = form.placement.includes(place.value);
          return (
            <button
              key={place.value}
              type="button"
              aria-pressed={selected}
              onClick={() => edit((current) => ({ placement: toggleRegexPlacement(current.placement, place.value) }))}
              className={cn(
                "flex min-w-0 flex-col items-center gap-1 rounded-xl px-3 py-3 text-center ring-1 transition-all",
                optionTone(selected),
              )}
            >
              <span className={cn("text-xs font-semibold", !selected && "text-[var(--foreground)]")}>
                {place.label}
              </span>
              <span
                className={cn("text-[0.5625rem]", selected ? "text-orange-400/70" : "text-[var(--muted-foreground)]")}
              >
                {place.description}
              </span>
            </button>
          );
        })}
      </div>
    </FieldGroup>
  );
}

export function CharacterScopeGroup({ editor }: { editor: RegexScriptEditorModel }) {
  const { form, edit, characters } = editor;
  const global = form.targetCharacterIds.length === 0;
  return (
    <FieldGroup
      icon={Users}
      label="Character Scope"
      help="Leave global to run this regex in every chat, or choose characters to run it only in their chats. Character scripts never change saved messages."
    >
      <button
        type="button"
        aria-pressed={global}
        onClick={() => edit(() => ({ targetCharacterIds: [] }))}
        className={cn(
          "flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs font-medium ring-1 transition-all",
          global ? optionTone(true) : "bg-[var(--secondary)] text-[var(--muted-foreground)] ring-[var(--border)]",
        )}
      >
        <span>Global</span>
        {global && <Check size="0.8125rem" aria-hidden="true" />}
      </button>
      {characters.length > 0 && (
        <div className="max-h-44 space-y-1 overflow-y-auto rounded-xl bg-[var(--secondary)] p-1 ring-1 ring-[var(--border)]">
          {characters.map((character) => {
            const chosen = form.targetCharacterIds.includes(character.id);
            return (
              <button
                key={character.id}
                type="button"
                aria-pressed={chosen}
                onClick={() =>
                  edit((current) => ({
                    targetCharacterIds: nextRegexScriptTargetCharacterIds(current.targetCharacterIds, character.id),
                  }))
                }
                className={cn(
                  "flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors",
                  chosen ? "bg-orange-400/10 text-orange-400" : "text-[var(--foreground)] hover:bg-[var(--accent)]",
                )}
              >
                <span
                  className={cn(
                    "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border",
                    chosen ? "border-orange-400 bg-orange-400 text-white" : "border-[var(--border)]",
                  )}
                >
                  {chosen && <Check size="0.625rem" strokeWidth={3} aria-hidden="true" />}
                </span>
                <span className="truncate">{character.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </FieldGroup>
  );
}

export function TrimStringsGroup({ editor }: { editor: RegexScriptEditorModel }) {
  const { form, edit } = editor;
  return (
    <FieldGroup
      icon={Minus}
      label="Trim Strings"
      help="Additional strings to remove from the result after the regex replacement. One per row."
    >
      {form.trimStrings.length > 0 && (
        <div className="space-y-1.5">
          {form.trimStrings.map((trim, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                type="text"
                value={trim}
                onChange={(event) => {
                  const value = event.target.value;
                  edit((current) => ({
                    trimStrings: current.trimStrings.map((entry, at) => (at === index ? value : entry)),
                  }));
                }}
                placeholder="String to trim…"
                className={cn(FIELD_SURFACE, FIELD_RING, "min-w-0 flex-1 rounded-lg px-3 py-1.5 font-mono text-xs")}
              />
              <button
                type="button"
                aria-label="Remove trim string"
                onClick={() =>
                  edit((current) => ({ trimStrings: current.trimStrings.filter((_, at) => at !== index) }))
                }
                className="shrink-0 rounded-lg p-1.5 text-[var(--destructive)] transition-colors hover:bg-[var(--destructive)]/15"
              >
                <X size="0.75rem" />
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => edit((current) => ({ trimStrings: [...current.trimStrings, ""] }))}
        className="flex items-center gap-1 rounded-lg px-3 py-1 text-[0.625rem] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
      >
        <Plus size="0.625rem" /> Add trim string
      </button>
    </FieldGroup>
  );
}
