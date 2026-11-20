import { resolveMacros, type MacroContext } from "../../../../../engine/shared/macros/macro-engine";
import { applyRegexScriptReplacement } from "../../../../../engine/shared/regex/regex-script-application";

/** Sample values the editor resolves macros with: Live Test and the pattern check never see a real chat. */
function sampleMacroContext(liveText: string): MacroContext {
  return {
    user: "User",
    char: "Character",
    characters: ["Character"],
    variables: {},
    lastInput: liveText || "Sample input",
    characterFields: {
      description: "Character description",
      personality: "Character personality",
      backstory: "Character backstory",
      appearance: "Character appearance",
      scenario: "Character scenario",
      example: "Character example",
      systemPrompt: "Character system prompt",
      postHistoryInstructions: "Character post-history instructions",
    },
    personaFields: {
      description: "Persona description",
      personality: "Persona personality",
      backstory: "Persona backstory",
      appearance: "Persona appearance",
      scenario: "Persona scenario",
    },
  };
}

function sampleResolver(liveText: string): (text: string) => string {
  const context = sampleMacroContext(liveText);
  return (text) => resolveMacros(text, context, { trimResult: false });
}

/** The browser's own message when the pattern (macros resolved with sample values) isn't a valid regex. */
export function regexPatternError(pattern: string, flags: string, liveText: string): string | null {
  if (!pattern) return null;
  try {
    const resolved = sampleResolver(liveText)(pattern);
    if (!resolved) return null;
    new RegExp(resolved, flags);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

interface LiveTestInput {
  liveText: string;
  findRegex: string;
  replaceString: string;
  flags: string;
  trimStrings: readonly string[];
  patternError: string | null;
}

/** What the script would turn the Live Test text into. Anything that can't run leaves the text as it is. */
export function liveTestResult({
  liveText,
  findRegex,
  replaceString,
  flags,
  trimStrings,
  patternError,
}: LiveTestInput): string {
  if (!findRegex || patternError) return liveText;
  try {
    const resolve = sampleResolver(liveText);
    const resolved = resolve(findRegex);
    if (!resolved) return liveText;
    return applyRegexScriptReplacement(liveText, new RegExp(resolved, flags), replaceString, trimStrings, resolve);
  } catch {
    // A preview of half-typed input: whatever can't run shows the sample unchanged.
    return liveText;
  }
}
