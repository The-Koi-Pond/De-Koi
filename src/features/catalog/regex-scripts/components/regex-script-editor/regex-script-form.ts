import type { RegexPlacement } from "../../../../../engine/contracts/types/regex";
import { regexScriptApplyMode, type RegexApplyMode } from "../../../../../engine/shared/regex/regex-apply-mode";
import type { RegexScriptRow } from "../../hooks/use-regex-scripts";
import { regexScriptTargetCharacterIds } from "../../lib/regex-script-filter";

/** The `regexDetailId` that means "a script that isn't saved yet". */
export const NEW_REGEX_SCRIPT_ID = "__new__";

/** Every saved field the editor holds. */
export interface RegexScriptForm {
  name: string;
  enabled: boolean;
  findRegex: string;
  replaceString: string;
  trimStrings: string[];
  placement: RegexPlacement[];
  targetCharacterIds: string[];
  flags: string;
  applyMode: RegexApplyMode;
  order: number;
  minDepth: number | null;
  maxDepth: number | null;
}

export const REGEX_FLAG_LETTERS = ["g", "i", "m", "s", "u"] as const;

export function newRegexScriptForm(): RegexScriptForm {
  return {
    name: "New Regex Script",
    enabled: true,
    findRegex: "",
    replaceString: "",
    trimStrings: [],
    placement: ["ai_output"],
    targetCharacterIds: [],
    flags: "gi",
    applyMode: "both",
    order: 0,
    minDepth: null,
    maxDepth: null,
  };
}

function isPlacement(value: unknown): value is RegexPlacement {
  return value === "ai_output" || value === "user_input";
}

/** A damaged row may lack its name or pattern; the form shows those as empty. */
function storedText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Legacy rows may store `enabled` as a string. */
function storedEnabled(value: unknown): boolean {
  return value === true || value === "true" || value === "1";
}

export function regexScriptFormFromRow(row: RegexScriptRow): RegexScriptForm {
  return {
    name: storedText(row.name),
    enabled: storedEnabled(row.enabled),
    findRegex: storedText(row.findRegex),
    replaceString: row.replaceString,
    trimStrings: Array.isArray(row.trimStrings) ? [...row.trimStrings] : [],
    placement: Array.isArray(row.placement) ? row.placement.filter(isPlacement) : [],
    targetCharacterIds: regexScriptTargetCharacterIds(row),
    flags: row.flags,
    applyMode: regexScriptApplyMode(row),
    order: row.order,
    minDepth: row.minDepth,
    maxDepth: row.maxDepth,
  };
}

/** A selected flag button removes the first occurrence of its letter; an unselected one appends it. */
export function toggleRegexFlag(flags: string, letter: string): string {
  return flags.includes(letter) ? flags.replace(letter, "") : flags + letter;
}

/** The last selected place can't be turned off. */
export function toggleRegexPlacement(current: RegexPlacement[], place: RegexPlacement): RegexPlacement[] {
  if (!current.includes(place)) return [...current, place];
  return current.length > 1 ? current.filter((entry) => entry !== place) : current;
}

/** Execution Order: every input sets `parseInt(text) || 0`, so a cleared box reads 0 right away. */
export function orderFromInput(text: string): number {
  return Number.parseInt(text, 10) || 0;
}

/** Depth Range: an empty box means no limit. */
export function depthFromInput(text: string): number | null {
  return text === "" ? null : Number.parseInt(text, 10);
}

/** What Save sends, field for field and in this order. Every field is a stored contract. */
export function regexScriptSavePayload(form: RegexScriptForm) {
  return {
    name: form.name,
    enabled: form.enabled,
    findRegex: form.findRegex,
    replaceString: form.replaceString,
    trimStrings: [...form.trimStrings],
    placement: [...form.placement],
    flags: form.flags,
    promptOnly: form.applyMode === "prompt",
    applyMode: form.applyMode,
    order: form.order,
    minDepth: form.minDepth,
    maxDepth: form.maxDepth,
    characterId: form.targetCharacterIds[0] ?? null,
    targetCharacterIds: [...form.targetCharacterIds],
  };
}

const MAX_NAME_LENGTH = 200;

/** The first thing the storage schema would reject, in plain words, or null when the form can be sent. */
export function regexScriptFormProblem(form: RegexScriptForm): string | null {
  const name = storedText(form.name);
  if (name.length === 0) return "Give the script a name.";
  // Counted in code points, as the storage schema counts them.
  if ([...name].length > MAX_NAME_LENGTH) return `Keep the name to ${MAX_NAME_LENGTH} characters or fewer.`;
  if (storedText(form.findRegex).length === 0) return "Add a find pattern.";
  if (form.placement.length === 0) return "Pick where it applies: AI Output, User Input or both.";
  return null;
}
