// ──────────────────────────────────────────────
// Regex Script Apply Modes
// ──────────────────────────────────────────────

/** Where a regex script's replacement shows: the prompt sent to the AI, the chat display, or both. */
export type RegexApplyMode = "prompt" | "display" | "both";

export const REGEX_APPLY_MODES: readonly RegexApplyMode[] = ["prompt", "display", "both"];

type RegexApplyModeSource = { applyMode?: unknown; promptOnly?: unknown };

function truthy(value: unknown): boolean {
  return value === true || value === "true" || value === "1";
}

export function isRegexApplyMode(value: unknown): value is RegexApplyMode {
  return value === "prompt" || value === "display" || value === "both";
}

/** A script's mode. Rows saved before modes existed read as prompt-only or both. */
export function regexScriptApplyMode(script: RegexApplyModeSource): RegexApplyMode {
  if (isRegexApplyMode(script.applyMode)) return script.applyMode;
  return truthy(script.promptOnly) ? "prompt" : "both";
}

/**
 * SillyTavern's two flags: `markdownOnly` ("Alter Chat Display") and `promptOnly` ("Alter
 * Outgoing Prompt"). With neither or both, a script changes what you see and what the AI reads.
 */
export function regexApplyModeFromSillyTavern(entry: { markdownOnly?: unknown; promptOnly?: unknown }): RegexApplyMode {
  const markdownOnly = truthy(entry.markdownOnly);
  const promptOnly = truthy(entry.promptOnly);
  if (markdownOnly && !promptOnly) return "display";
  if (promptOnly && !markdownOnly) return "prompt";
  return "both";
}

export interface RegexScriptSurfaces {
  /** Applied to the prompt sent to the AI. */
  prompt: boolean;
  /** Applied when a message is shown. */
  display: boolean;
  /** Applied to a message as it is saved, so the saved text itself changes. */
  savedMessage: boolean;
}

/**
 * Where a script runs. A global "both" script rewrites the message as it is saved, so the
 * display and the prompt both read the result. Character-scoped scripts never rewrite saved
 * messages: their "both" applies to the display and the prompt instead.
 */
export function regexScriptSurfaces(script: RegexApplyModeSource, characterScoped: boolean): RegexScriptSurfaces {
  const mode = regexScriptApplyMode(script);
  return {
    prompt: mode === "prompt" || (mode === "both" && characterScoped),
    display: mode !== "prompt",
    savedMessage: mode === "both" && !characterScoped,
  };
}
