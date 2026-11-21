import type { StorageGateway } from "../../capabilities/storage";
import type { FanficState, FanficVersionOriginKind } from "../../contracts/types/fanfic";
import { isRecord, parseRecord, readString, type JsonRecord } from "../../generation/runtime-records";
import { fanficChapterLayout, fanficUnfinishedChapter } from "./chapter-refs";
import { fanficPlannedChapterCount, type FanficGenerationKind } from "./chapters";
import { fanficAutoPolishOn } from "./polish";
import { fanficStage, readFanficState } from "./request";
import { readFanficVersion } from "./versions";

// What follows a write by itself. With auto-polish on, every new or rewritten chapter is polished next (see polish.ts).
// "Write all": the planned main chapters are written one after another, each as its own ordinary chapter write (and
// its polish). After each write, the run goes on only while these rules hold, so a cut-off chapter or a Stop ends it.

/** The planned main chapters not written yet. */
function fanficChaptersLeft(state: FanficState, messages: readonly JsonRecord[]): number {
  return Math.max(0, fanficPlannedChapterCount(state) - fanficChapterLayout(messages).mains.length);
}

/** A chapter that just became finished (written, continued, reset, kept as is or polished) and the write that made it. */
export interface FanficFinishedChapter {
  messageId: string;
  /** Null when the version record can't be read. */
  origin: FanficVersionOriginKind | null;
}

// A gap longer than this between two chapters means the reader stopped in between, so it says nothing about how long
// a chapter takes.
const WRITE_ALL_GAP_LIMIT_MS = 30 * 60_000;

/**
 * Minutes "Write all" will likely take, from this fic's own pace: the median gap between consecutive main chapters
 * (writing plus the automatic polish), times the chapters left. Null until two chapters were written back to back.
 */
export function fanficWriteAllEstimateMinutes(mainChapterTimes: readonly string[], remaining: number): number | null {
  const times = mainChapterTimes
    .map((value) => Date.parse(value))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  const gaps = times
    .slice(1)
    .map((time, index) => time - times[index]!)
    .filter((gap) => gap > 0 && gap <= WRITE_ALL_GAP_LIMIT_MS)
    .sort((left, right) => left - right);
  if (gaps.length === 0 || remaining < 1) return null;
  const middle = Math.floor(gaps.length / 2);
  const median = gaps.length % 2 === 1 ? gaps[middle]! : (gaps[middle - 1]! + gaps[middle]!) / 2;
  return Math.max(1, Math.round((median * remaining) / 60_000));
}

/** "about 45 min", "about 1 h 20 min". */
export function fanficDurationLabel(minutes: number): string {
  if (minutes < 60) return `about ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round((minutes % 60) / 5) * 5;
  return rest === 0 || rest === 60 ? `about ${hours + (rest === 60 ? 1 : 0)} h` : `about ${hours} h ${rest} min`;
}

/** The chapter a write's events end with, when it is saved and finished (not cut off, not missing); else null. */
export function fanficWriteSavedFinishedChapter(
  events: readonly { type: string; data?: unknown }[],
): FanficFinishedChapter | null {
  const saved = [...events].reverse().find((event) => event.type === "assistant_message");
  if (!saved) return null;
  const data = parseRecord(saved.data);
  const version = readFanficVersion(data.extra);
  const id = readString(data.id);
  return id && version !== null && !version.unfinished ? { messageId: id, origin: version.origin?.kind ?? null } : null;
}

/** The id of the chapter a write's events end with, when it is saved and finished; else null. */
export function fanficWriteSavedFinishedId(events: readonly { type: string; data?: unknown }[]): string | null {
  return fanficWriteSavedFinishedChapter(events)?.messageId ?? null;
}

/** True when a write's events end with a saved chapter that is finished (not cut off, not missing). */
export function fanficWriteSavedFinished(events: readonly { type: string; data?: unknown }[]): boolean {
  return fanficWriteSavedFinishedId(events) !== null;
}

/**
 * The event the hosted runner adds to a fanfic write's job just before the job ends, when no screen is following it
 * and the runner runs the ledger update and re-plan itself. A screen that catches up on the job later (its connection
 * dropped and came back) replays this event and leaves those steps alone, so they run once.
 */
export const FANFIC_STEPS_ON_SERVER_EVENT = "fanfic_steps_on_server";

/** The background steps that run once a chapter is finished; see fanficAfterChapterSteps. */
export interface FanficAfterChapterSteps {
  /** The chapter to keep the fic's banned phrases out of (local models only), or null. */
  phraseBansFor: string | null;
  updateLedger: boolean;
  proposePlan: boolean;
}

/**
 * What runs once a chapter is finished, whichever way it got there: the phrase bans for that chapter and the ledger
 * update, and for a chapter written as a new chapter a re-plan of the rest, as after any new one. While its auto-polish
 * comes next, the bans and the ledger wait for the polished text; the polish itself proposes no re-plan, since the
 * chapter it polished already did. A "write all" run follows the outline as it is, so it skips the re-plan nobody is
 * there to use. The reader runs these after a write it was showing; the hosted runner runs them after one no screen
 * was following, so a chapter written while the phone slept still gets them.
 */
export function fanficAfterChapterSteps(
  chapter: FanficFinishedChapter,
  write: { polish: boolean; polishNext: boolean; batch: boolean },
): FanficAfterChapterSteps {
  const settled = !write.polishNext;
  return {
    phraseBansFor: settled ? chapter.messageId : null,
    updateLedger: settled,
    proposePlan: !write.polish && !write.batch && chapter.origin === "chapter",
  };
}

/** Writes whose finished chapter is polished next: every write that makes chapter text, rewrites with notes too. */
const POLISHED_KINDS: ReadonlySet<FanficGenerationKind> = new Set([
  "chapter",
  "extra",
  "regenerate",
  "revise",
  "continue",
]);

/** The write that follows another by itself: polishing the chapter it finished, or the next chapter of a run. */
export type FanficFollowUp = { kind: "polish"; messageId: string } | { kind: "chapter" };

/**
 * What runs after a write that finished chapter `finishedId` (null when it saved none, or a cut-off one): its polish
 * when the fic's switch is on, else in a "write all" run the next planned chapter while the run goes on.
 */
export async function fanficFollowUpWrite(
  storage: StorageGateway,
  write: { chatId: string; kind: FanficGenerationKind; batch: boolean; finishedId: string | null },
): Promise<FanficFollowUp | null> {
  if (!write.finishedId) return null;
  if (POLISHED_KINDS.has(write.kind)) {
    const chat = await storage.get("chats", write.chatId);
    const state = isRecord(chat) ? readFanficState(parseRecord(chat.metadata)) : null;
    if (state && fanficStage(state) === "writing" && fanficAutoPolishOn(state)) {
      return { kind: "polish", messageId: write.finishedId };
    }
  }
  const runs = write.batch && (write.kind === "chapter" || write.kind === "polish");
  return runs && (await fanficBatchContinues(storage, write.chatId)) ? { kind: "chapter" } : null;
}

/**
 * Whether a "write all" run goes on to the next chapter: the fic is still in its writing stage, no chapter waits as
 * unfinished (the requester picks Reset, Continue or Keep for that one), and the outline plans more main chapters.
 */
export async function fanficBatchContinues(storage: StorageGateway, chatId: string): Promise<boolean> {
  const chat = await storage.get("chats", chatId);
  if (!isRecord(chat)) return false;
  const state = readFanficState(parseRecord(chat.metadata));
  if (!state || fanficStage(state) !== "writing") return false;
  const messages = await storage.listChatMessages<JsonRecord>(chatId);
  if (fanficUnfinishedChapter(messages)) return false;
  return fanficChaptersLeft(state, messages) > 0;
}

/**
 * The input of a follow-up write, made from the one before: a polish of the chapter it finished, or the next main
 * chapter. Notes steer only the write they were given for, and a run stays a run.
 */
export function fanficFollowUpInput<T extends Record<string, unknown>>(input: T, followUp: FanficFollowUp): T {
  const {
    replacesVersion: _replaces,
    parentChapter: _parent,
    continueMessageId: _continues,
    ...rest
  } = input as Record<string, unknown>;
  return {
    ...rest,
    fanficKind: followUp.kind,
    notes: null,
    regenerateMessageId: followUp.kind === "polish" ? followUp.messageId : null,
  } as unknown as T;
}
