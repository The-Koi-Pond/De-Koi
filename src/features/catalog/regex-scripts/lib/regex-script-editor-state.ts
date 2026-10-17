import type { RegexApplyMode } from "../../../../engine/shared/regex/regex-apply-mode";

export function nextRegexScriptTargetCharacterIds(currentTargetIds: string[], characterId: string): string[] {
  return currentTargetIds.includes(characterId)
    ? currentTargetIds.filter((id) => id !== characterId)
    : [...currentTargetIds, characterId];
}

export const REGEX_APPLY_MODE_LABELS: Record<RegexApplyMode, string> = {
  prompt: "Prompt",
  display: "Display",
  both: "Both",
};

/** What the chosen mode does, in the words the editor shows. */
export function regexApplyModeHelp(mode: RegexApplyMode, characterScoped: boolean): string {
  switch (mode) {
    case "prompt":
      return "Changes only what is sent to the AI. Messages on screen stay as written.";
    case "display":
      return "Changes only what you see. The AI reads the original text.";
    case "both":
      return characterScoped
        ? "Changes what you see and what is sent to the AI. The saved message stays as written."
        : "Changes the message itself as it is saved, so you and the AI both see the result.";
  }
}
