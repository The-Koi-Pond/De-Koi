import { Info, Regex } from "lucide-react";
import { cn } from "../../../../../shared/lib/utils";
import { FIELD_RING, FIELD_SURFACE, FieldGroup, optionTone } from "./FieldGroup";
import { REGEX_FLAG_LETTERS, toggleRegexFlag } from "./regex-script-form";
import type { RegexScriptEditorModel } from "./use-regex-script-editor";

const PATTERN_INPUT = cn(FIELD_SURFACE, "w-full rounded-xl px-4 py-2.5 font-mono text-sm");

/** Ring colors of the find input when the pattern doesn't compile. */
export const PATTERN_ERROR_RING = "ring-[var(--destructive)] focus:ring-[var(--destructive)]";

export function FindPatternGroup({ editor }: { editor: RegexScriptEditorModel }) {
  const { form, edit, patternError } = editor;
  return (
    <FieldGroup
      icon={Regex}
      label="Find Pattern (Regex)"
      help="The regular expression pattern to search for. Written without delimiters. Macros resolve with sample values in Live Test and chat values at runtime."
    >
      <div>
        <input
          type="text"
          value={form.findRegex}
          onChange={(event) => {
            const findRegex = event.target.value;
            edit(() => ({ findRegex }));
          }}
          placeholder={"e.g. \\\\*([^*]+)\\\\*"}
          className={cn(PATTERN_INPUT, patternError ? PATTERN_ERROR_RING : FIELD_RING)}
        />
        {patternError && <p className="mt-1 text-[0.625rem] text-[var(--destructive)]">{patternError}</p>}
      </div>
    </FieldGroup>
  );
}

export function ReplaceWithGroup({ editor }: { editor: RegexScriptEditorModel }) {
  const { form, edit } = editor;
  return (
    <FieldGroup
      icon={Info}
      label="Replace With"
      help="The replacement string. Supports capture groups ($1, $2), named groups ($<name>), and case transforms like \u$1, \U$1\E, \l$1, and \L$1\E. Leave empty to delete matched text."
    >
      <input
        type="text"
        value={form.replaceString}
        onChange={(event) => {
          const replaceString = event.target.value;
          edit(() => ({ replaceString }));
        }}
        placeholder="e.g. $1 or leave empty to remove"
        className={cn(PATTERN_INPUT, FIELD_RING)}
      />
    </FieldGroup>
  );
}

export function RegexFlagsGroup({ editor }: { editor: RegexScriptEditorModel }) {
  const { form, edit } = editor;
  return (
    <FieldGroup
      icon={Info}
      label="Regex Flags"
      help="Standard regex flags: g (global), i (case-insensitive), m (multiline), s (dotAll), u (unicode)."
    >
      <div className="flex flex-wrap gap-2">
        {REGEX_FLAG_LETTERS.map((letter) => {
          const selected = form.flags.includes(letter);
          return (
            <button
              key={letter}
              type="button"
              aria-pressed={selected}
              onClick={() => edit((current) => ({ flags: toggleRegexFlag(current.flags, letter) }))}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-lg font-mono text-xs font-bold ring-1 transition-all",
                optionTone(selected),
              )}
            >
              {letter}
            </button>
          );
        })}
      </div>
    </FieldGroup>
  );
}
