import type { StorageGateway } from "../capabilities/storage";
import {
  deferUntilForegroundGenerationCompletes,
  foregroundGenerationActive,
} from "./background-generation-coordinator";
import { hiddenFromAi, readString, type JsonRecord } from "./runtime-records";

const MAX_ASSISTANT_TURNS = 8;
const MAX_TURN_CHARS = 8_000;

const RECURRING_MARKERS: readonly RegExp[] = [
  /\b(?:breath|pulse|heartbeat)\b.{0,32}\b(?:caught|hitched|hammered|fluttered|stuttered|quickened)\b/i,
  /\b(?:jaw|fingers?|hands?|shoulders?|throat|chest)\b.{0,32}\b(?:clenched|tightened|tensed|sagged|trembled|coiled)\b/i,
  /\b(?:as if|as though)\b.{8,96}\b(?:knew|understood|remembered|answered|accused|mocked|meant)\b/i,
  /\b(?:suddenly|without warning|before (?:he|she|they|it|you) could)\b/i,
  /\b(?:for now|at last|in the end)\b/i,
];

function assistantTurns(messages: JsonRecord[], mainResponse: string): string[] {
  const turns = messages
    .filter((message) => !hiddenFromAi(message) && readString(message.role).trim() === "assistant")
    .map((message) => readString(message.content).trim().slice(0, MAX_TURN_CHARS))
    .filter(Boolean)
    .slice(-(MAX_ASSISTANT_TURNS - 1));
  const completed = mainResponse.trim().slice(0, MAX_TURN_CHARS);
  if (completed) turns.push(completed);
  return turns;
}

function sentenceOpeningSignatures(turn: string): Set<string> {
  const signatures = new Set<string>();
  for (const sentence of turn.split(/(?:[.!?]+|\n+)\s*/u)) {
    const words = sentence.toLocaleLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
    if (words.length < 7) continue;
    const signature = words.slice(0, 4).join(" ");
    if (signature.length >= 16) signatures.add(signature);
  }
  return signatures;
}

function occursAcrossTurns(turns: string[], valuesForTurn: (turn: string) => Iterable<string>): boolean {
  const firstTurnByValue = new Map<string, number>();
  for (let turnIndex = 0; turnIndex < turns.length; turnIndex += 1) {
    for (const value of valuesForTurn(turns[turnIndex]!)) {
      const firstTurn = firstTurnByValue.get(value);
      if (firstTurn !== undefined && firstTurn !== turnIndex) return true;
      firstTurnByValue.set(value, turnIndex);
    }
  }
  return false;
}

export function narrativeCraftHasRecurringShape(messages: JsonRecord[], mainResponse: string): boolean {
  const turns = assistantTurns(messages, mainResponse);
  if (turns.length < 2) return false;

  if (
    occursAcrossTurns(turns, (turn) =>
      RECURRING_MARKERS.flatMap((pattern, index) => (pattern.test(turn) ? [`marker:${index}`] : [])),
    )
  ) {
    return true;
  }

  return occursAcrossTurns(turns, sentenceOpeningSignatures);
}

export interface NarrativeCraftAnalysisDiagnostic {
  stage: "narrative_craft_analysis";
  status: "ok" | "error";
  durationMs: number;
}

export interface ScheduleNarrativeCraftAnalysisInput {
  storage: StorageGateway;
  chatId: string;
  run: (signal: AbortSignal) => Promise<void>;
  onDiagnostic?: (diagnostic: NarrativeCraftAnalysisDiagnostic) => void;
  now?: () => number;
}

interface NarrativeCraftAnalysisJob {
  run: (signal: AbortSignal) => Promise<void>;
  onDiagnostic?: (diagnostic: NarrativeCraftAnalysisDiagnostic) => void;
  now: () => number;
}

interface ScheduledNarrativeCraftAnalysis {
  pendingJob: NarrativeCraftAnalysisJob | null;
  controller: AbortController | null;
  cancelled: boolean;
}

const scheduledByStorage = new WeakMap<StorageGateway, Map<string, ScheduledNarrativeCraftAnalysis>>();

function jobFor(input: ScheduleNarrativeCraftAnalysisInput): NarrativeCraftAnalysisJob {
  return {
    run: input.run,
    onDiagnostic: input.onDiagnostic,
    now: input.now ?? Date.now,
  };
}

function reportDiagnostic(
  job: NarrativeCraftAnalysisJob,
  status: NarrativeCraftAnalysisDiagnostic["status"],
  startedAt: number,
): void {
  if (!job.onDiagnostic) return;
  try {
    const elapsed = job.now() - startedAt;
    job.onDiagnostic({
      stage: "narrative_craft_analysis",
      status,
      durationMs: Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0,
    });
  } catch {
    // Optional diagnostics must not affect background work or queue progress.
  }
}

export function scheduleNarrativeCraftAnalysis(input: ScheduleNarrativeCraftAnalysisInput): boolean {
  const chatId = input.chatId.trim();
  if (!chatId) return false;

  const scheduled = scheduledByStorage.get(input.storage) ?? new Map<string, ScheduledNarrativeCraftAnalysis>();
  scheduledByStorage.set(input.storage, scheduled);
  const active = scheduled.get(chatId);
  if (active) {
    active.pendingJob = jobFor(input);
    return true;
  }

  const state: ScheduledNarrativeCraftAnalysis = { pendingJob: null, controller: null, cancelled: false };
  scheduled.set(chatId, state);
  const initialJob = jobFor(input);
  setTimeout(() => {
    startOrDeferNarrativeCraftAnalyses(input.storage, chatId, initialJob, state, scheduled);
  }, 0);
  return true;
}

function startOrDeferNarrativeCraftAnalyses(
  storage: StorageGateway,
  chatId: string,
  initialJob: NarrativeCraftAnalysisJob,
  state: ScheduledNarrativeCraftAnalysis,
  scheduled: Map<string, ScheduledNarrativeCraftAnalysis>,
): void {
  if (state.cancelled || scheduled.get(chatId) !== state) return;
  if (foregroundGenerationActive(storage)) {
    deferUntilForegroundGenerationCompletes(storage, state, () => {
      startOrDeferNarrativeCraftAnalyses(storage, chatId, initialJob, state, scheduled);
    });
    return;
  }
  void runScheduledNarrativeCraftAnalyses(storage, chatId, initialJob, state, scheduled);
}

export function cancelNarrativeCraftAnalysis(storage: StorageGateway, chatId: string): void {
  const normalizedChatId = chatId.trim();
  if (!normalizedChatId) return;
  const active = scheduledByStorage.get(storage)?.get(normalizedChatId);
  if (!active) return;
  active.cancelled = true;
  active.pendingJob = null;
  active.controller?.abort();
  const scheduled = scheduledByStorage.get(storage);
  scheduled?.delete(normalizedChatId);
  if (scheduled?.size === 0) scheduledByStorage.delete(storage);
}

export function cancelNarrativeCraftAnalysesForForeground(storage: StorageGateway): void {
  const scheduled = scheduledByStorage.get(storage);
  if (!scheduled) return;
  scheduledByStorage.delete(storage);
  for (const state of scheduled.values()) {
    state.cancelled = true;
    state.pendingJob = null;
    state.controller?.abort();
  }
  scheduled.clear();
}

function abortError(error: unknown): boolean {
  return !!error && typeof error === "object" && "name" in error && (error as { name?: unknown }).name === "AbortError";
}

async function runScheduledNarrativeCraftAnalyses(
  storage: StorageGateway,
  chatId: string,
  initialJob: NarrativeCraftAnalysisJob,
  state: ScheduledNarrativeCraftAnalysis,
  scheduled: Map<string, ScheduledNarrativeCraftAnalysis>,
): Promise<void> {
  let job: NarrativeCraftAnalysisJob | null = initialJob;
  try {
    while (job && !state.cancelled) {
      const startedAt = job.now();
      const controller = new AbortController();
      state.controller = controller;
      try {
        await job.run(controller.signal);
        reportDiagnostic(job, "ok", startedAt);
      } catch (error) {
        if (!controller.signal.aborted && !abortError(error)) {
          console.warn("[generation] narrative craft background analysis failed", {
            chatId,
            error: error instanceof Error ? error.message : String(error ?? "Unknown Narrative Craft error"),
          });
          reportDiagnostic(job, "error", startedAt);
        }
      }
      state.controller = null;
      job = state.pendingJob;
      state.pendingJob = null;
    }
  } finally {
    state.controller = null;
    if (scheduled.get(chatId) === state) scheduled.delete(chatId);
    if (scheduled.size === 0) scheduledByStorage.delete(storage);
  }
}
