// ──────────────────────────────────────────────
// Generation runner: a fanfic chapter's after-chapter steps
// ──────────────────────────────────────────────
// Once a chapter is finished, the story ledger catches up with it and the living outline re-plans the rest (see
// fanficAfterChapterSteps). The reader runs these after a write it was showing. A write that ends with no screen
// following it (the phone slept, the tab closed) gets them here instead, so they aren't skipped. Phrase bans stay with
// the reader: they need the local model next to it.
import { FANFIC_GENERATION_KINDS } from "../engine/modes/fanfic/chapters";
import { fanficAfterChapterSteps, fanficWriteSavedFinishedChapter } from "../engine/modes/fanfic/batch";
import type { RunnerEvent } from "./jobs";

/** The after-chapter steps the runner takes for one write. */
export interface FanficServerSteps {
  chatId: string;
  updateLedger: boolean;
  proposePlan: boolean;
}

/**
 * The steps to run after fanfic write `input` ended normally with `events`, given the job chained after it (`next`,
 * null when none): none for a chat reply, a write that saved no finished chapter, or one whose steps wait (a polish
 * comes next) or don't apply.
 */
export function fanficStepsAfterJob(
  input: Record<string, unknown>,
  events: readonly RunnerEvent[],
  next: Record<string, unknown> | null,
): FanficServerSteps | null {
  const kind = FANFIC_GENERATION_KINDS.find((entry) => entry === input.fanficKind);
  const chatId = typeof input.chatId === "string" ? input.chatId.trim() : "";
  if (!kind || !chatId) return null;
  const chapter = fanficWriteSavedFinishedChapter(events);
  if (!chapter) return null;
  const steps = fanficAfterChapterSteps(chapter, {
    polish: kind === "polish",
    polishNext: next?.fanficKind === "polish",
    batch: input.fanficBatch === true,
  });
  if (!steps.updateLedger && !steps.proposePlan) return null;
  return { chatId, updateLedger: steps.updateLedger, proposePlan: steps.proposePlan };
}

/** The engine calls behind each step (the runner wires them to the hosted runtime). */
export interface FanficStepRunners {
  updateLedger: (chatId: string) => Promise<unknown>;
  proposePlan: (chatId: string) => Promise<unknown>;
}

/**
 * Runs each fic's steps one after another, in the order its writes ended, so two ledger updates for one fic never race
 * each other (a later one finds the chapters an earlier one read already current). A failed step is logged and the
 * next one still runs: nobody is at the screen to tell, and the reader's ledger panel shows what is still out of date.
 */
export class FanficStepQueue {
  private readonly tails = new Map<string, Promise<void>>();

  constructor(
    private readonly runners: FanficStepRunners,
    private readonly log: (message: string, error: unknown) => void = (message, error) =>
      console.warn(`[runner] ${message}:`, error),
  ) {}

  /** Queues `steps` behind the fic's earlier ones; resolves once they ran. */
  run(steps: FanficServerSteps): Promise<void> {
    const { chatId } = steps;
    const tail = (this.tails.get(chatId) ?? Promise.resolve()).then(async () => {
      if (steps.updateLedger) {
        await this.runners.updateLedger(chatId).catch((error: unknown) => {
          this.log(`story ledger of chat ${chatId} not updated`, error);
        });
      }
      if (steps.proposePlan) {
        await this.runners.proposePlan(chatId).catch((error: unknown) => {
          this.log(`plan of chat ${chatId} not updated`, error);
        });
      }
    });
    this.tails.set(chatId, tail);
    void tail.then(() => {
      if (this.tails.get(chatId) === tail) this.tails.delete(chatId);
    });
    return tail;
  }
}
