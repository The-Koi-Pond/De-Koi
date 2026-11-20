import { resolveMacros, type MacroContext } from "../../../../../engine/shared/macros/macro-engine";
import { isPatternSafe } from "../../../../../engine/shared/regex/regex-safety";
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

/** What Live Test shows when a pattern took too long in its trial run. */
export const LIVE_TEST_SLOW_NOTE =
  "Live Test stopped: this pattern took too long on this text and could freeze the app. It repeats a repeated group, like (a+)+.";

/** What Live Test shows when a risky pattern can't be given a trial run (no background workers here). */
export const LIVE_TEST_UNTESTED_NOTE =
  "Live Test skipped: this pattern repeats a repeated group, like (a+)+, which can freeze the app, and it can't be tried safely here.";

/**
 * The app's regex safety check also turns down shapes that can't hang on their own: literal braces such
 * as an unknown {{macro}} left in the pattern, an open-ended count like {2,}, large counts and long
 * patterns. Hand it a copy where literal braces are escaped and an open-ended count reads as "+", so only
 * a repeat nested in a repeat is what it reports.
 */
function forNestingCheck(pattern: string): string {
  return pattern.replace(/\\[\s\S]|\{(\d+),(\d*)\}|\{(?!\d+(?:,\d*)?\})/g, (match: string, _low, high) => {
    if (match.startsWith("\\")) return match;
    if (match === "{") return "\\{";
    return high === "" ? "+" : match;
  });
}

/** The find pattern with macros resolved by the sample values, or null when there's nothing to run. */
export function sampleResolvedPattern(pattern: string, liveText: string): string | null {
  if (!pattern) return null;
  try {
    return sampleResolver(liveText)(pattern) || null;
  } catch {
    return null;
  }
}

/**
 * True when a resolved pattern repeats a repeated group, the shape that can backtrack catastrophically.
 * It's only a shape check: many such patterns are fine (the branches of `(?:"[^"]*"|[^">])*` can't
 * overlap), so a risky pattern gets a timed trial run before Live Test runs it on the page.
 */
export function regexPatternRisky(resolvedPattern: string): boolean {
  return !isPatternSafe(forNestingCheck(resolvedPattern), {
    maxLength: Number.POSITIVE_INFINITY,
    maxRepetition: Number.MAX_SAFE_INTEGER,
  });
}

/** How long the trial run may take once the worker is up, and how long the worker may take to start. */
const TRIAL_LIMIT_MS = 300;
const WORKER_START_LIMIT_MS = 3000;

const TRIAL_WORKER_SOURCE = `
self.onmessage = (event) => {
  if (event.data && event.data.type === "ready") {
    self.postMessage("ready");
    return;
  }
  const { source, flags, text } = event.data;
  try {
    text.replace(new RegExp(source, flags), "");
  } catch {}
  self.postMessage("done");
};
`;

let trialWorkerUrl: string | null = null;

function trialWorkerSource(): string | null {
  if (trialWorkerUrl) return trialWorkerUrl;
  if (typeof Worker !== "function" || typeof URL.createObjectURL !== "function") return null;
  try {
    trialWorkerUrl = URL.createObjectURL(new Blob([TRIAL_WORKER_SOURCE], { type: "text/javascript" }));
  } catch {
    return null;
  }
  return trialWorkerUrl;
}

export type TrialVerdict = "fast" | "slow" | "untested";

/**
 * Runs the same replace Live Test would run, in a throwaway background worker, and reports whether it
 * finished within the limit. A slow run is stopped by ending the worker, so the page never hangs.
 * `cancel` ends it early (the text or pattern changed) without a verdict.
 */
export function trialRunRegex(
  source: string,
  flags: string,
  text: string,
  onVerdict: (verdict: TrialVerdict) => void,
): { cancel: () => void } {
  const url = trialWorkerSource();
  let worker: Worker | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;

  const finish = (verdict: TrialVerdict | null) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    worker?.terminate();
    if (verdict) onVerdict(verdict);
  };

  if (!url) {
    queueMicrotask(() => finish("untested"));
    return { cancel: () => finish(null) };
  }
  try {
    worker = new Worker(url);
  } catch {
    queueMicrotask(() => finish("untested"));
    return { cancel: () => finish(null) };
  }
  timer = setTimeout(() => finish("untested"), WORKER_START_LIMIT_MS);
  worker.onmessage = (event: MessageEvent<string>) => {
    if (event.data === "ready") {
      clearTimeout(timer);
      timer = setTimeout(() => finish("slow"), TRIAL_LIMIT_MS);
      worker?.postMessage({ source, flags, text });
    } else {
      finish("fast");
    }
  };
  worker.onerror = () => finish("untested");
  worker.postMessage({ type: "ready" });
  return { cancel: () => finish(null) };
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
