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

/** The find pattern with macros resolved by the sample values, resolved once so every use sees the same. */
export interface SamplePattern {
  /** The resolved pattern, or null when there's nothing to run. */
  source: string | null;
  /** The browser's own message when it isn't a valid regex. */
  error: string | null;
}

export function samplePattern(pattern: string, flags: string, liveText: string): SamplePattern {
  if (!pattern) return { source: null, error: null };
  let source: string;
  try {
    source = sampleResolver(liveText)(pattern);
  } catch (error) {
    return { source: null, error: error instanceof Error ? error.message : String(error) };
  }
  if (!source) return { source: null, error: null };
  try {
    new RegExp(source, flags);
    return { source, error: null };
  } catch (error) {
    return { source, error: error instanceof Error ? error.message : String(error) };
  }
}

/** The browser's own message when the pattern (macros resolved with sample values) isn't a valid regex. */
export function regexPatternError(pattern: string, flags: string, liveText: string): string | null {
  return samplePattern(pattern, flags, liveText).error;
}

interface LiveTestInput {
  liveText: string;
  /** The resolved find pattern from `samplePattern`. */
  source: string | null;
  replaceString: string;
  flags: string;
  trimStrings: readonly string[];
}

/** What the script would turn the Live Test text into. Anything that can't run leaves the text as it is. */
export function liveTestResult({ liveText, source, replaceString, flags, trimStrings }: LiveTestInput): string {
  if (!source) return liveText;
  try {
    return applyRegexScriptReplacement(
      liveText,
      new RegExp(source, flags),
      replaceString,
      trimStrings,
      sampleResolver(liveText),
    );
  } catch {
    // A preview of half-typed input: whatever can't run shows the sample unchanged.
    return liveText;
  }
}

/** What Live Test shows when the pattern took too long in its trial run. */
export const LIVE_TEST_SLOW_NOTE =
  "Live Test stopped: this pattern took too long on this text and could freeze the app. Patterns with repeats inside repeats, like (a+)+, or many repeats in a row, like .*.*.*, often do this.";

/** What Live Test shows where no background worker can run the trial. */
export const LIVE_TEST_UNTESTED_NOTE =
  "Live Test can't run here: it needs a background worker to try the pattern safely.";

/** How long a trial may run once its worker is up, and how long a new worker may take to start. */
const TRIAL_LIMIT_MS = 300;
const WORKER_START_LIMIT_MS = 3000;

// Every message carries the id of its trial; "ready" answers the start-up check.
const TRIAL_WORKER_SOURCE = `
self.onmessage = (event) => {
  const job = event.data;
  if (job.type !== "ready") {
    try {
      job.text.replace(new RegExp(job.source, job.flags), "");
    } catch {}
  }
  self.postMessage(job.id);
};
`;

interface TrialWorker {
  worker: Worker;
  ready: boolean;
}

let workerUrl: string | null = null;
/** One worker kept between trials, so a keystroke doesn't start a new one. Ended whenever a trial is cut off. */
let idleWorker: TrialWorker | null = null;
let nextTrialId = 1;

function takeWorker(): TrialWorker | null {
  if (idleWorker) {
    const taken = idleWorker;
    idleWorker = null;
    return taken;
  }
  if (typeof Worker !== "function" || typeof URL.createObjectURL !== "function") return null;
  try {
    workerUrl ??= URL.createObjectURL(new Blob([TRIAL_WORKER_SOURCE], { type: "text/javascript" }));
    return { worker: new Worker(workerUrl), ready: false };
  } catch {
    return null;
  }
}

export type TrialVerdict = "fast" | "slow" | "untested";

/**
 * Runs the replace Live Test would run, on the same text, in a background worker, and reports whether it
 * finished within the limit. Only after a "fast" verdict does the page run it, so a pattern that
 * backtracks catastrophically never hangs the page: its worker is ended instead. Returns a cancel that
 * drops the trial without a verdict (the pattern or text changed).
 */
export function trialRunRegex(
  source: string,
  flags: string,
  text: string,
  onVerdict: (verdict: TrialVerdict) => void,
): () => void {
  const id = nextTrialId++;
  const entry = takeWorker();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;

  const finish = (verdict: TrialVerdict | null) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    // A worker that answered in time is kept for the next trial; any other may still be running.
    if (entry && verdict === "fast" && idleWorker === null) idleWorker = entry;
    else entry?.worker.terminate();
    if (verdict) onVerdict(verdict);
  };

  if (!entry) {
    queueMicrotask(() => finish("untested"));
    return () => finish(null);
  }
  const run = () => {
    timer = setTimeout(() => finish("slow"), TRIAL_LIMIT_MS);
    entry.worker.postMessage({ id, source, flags, text });
  };
  entry.worker.onmessage = (event: MessageEvent<number>) => {
    if (event.data !== id) return;
    if (!entry.ready) {
      entry.ready = true;
      clearTimeout(timer);
      run();
    } else {
      finish("fast");
    }
  };
  entry.worker.onerror = () => finish("untested");
  if (entry.ready) {
    run();
  } else {
    timer = setTimeout(() => finish("untested"), WORKER_START_LIMIT_MS);
    entry.worker.postMessage({ type: "ready", id });
  }
  return () => finish(null);
}

/** Ends the kept worker and forgets it (tests swap the Worker class between cases). */
export function resetTrialWorker() {
  idleWorker?.worker.terminate();
  idleWorker = null;
  workerUrl = null;
}
