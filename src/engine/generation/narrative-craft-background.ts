import type { StorageGateway } from "../capabilities/storage";
import {
  cancelCraftAnalysis,
  cancelCraftAnalysesForForeground,
  scheduleCraftAnalysis,
  type CraftAnalysisDiagnostic,
} from "./craft-analysis-background";
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

export function scheduleNarrativeCraftAnalysis(input: ScheduleNarrativeCraftAnalysisInput): boolean {
  return scheduleCraftAnalysis({
    ...input,
    stage: "narrative_craft_analysis",
    onDiagnostic: input.onDiagnostic
      ? (diagnostic: CraftAnalysisDiagnostic) => input.onDiagnostic?.(diagnostic as NarrativeCraftAnalysisDiagnostic)
      : undefined,
  });
}

export function cancelNarrativeCraftAnalysis(storage: StorageGateway, chatId: string): void {
  cancelCraftAnalysis(storage, chatId);
}

export function cancelNarrativeCraftAnalysesForForeground(storage: StorageGateway): void {
  cancelCraftAnalysesForForeground(storage);
}
