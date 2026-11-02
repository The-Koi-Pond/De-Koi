import type { StorageGateway } from "../../capabilities/storage";
import type { FanficState } from "../../contracts/types/fanfic";
import { isRecord, parseRecord, readString, type JsonRecord } from "../../generation/runtime-records";
import { fanficChapterLayout, fanficUnfinishedChapter } from "./chapter-refs";
import { fanficPlannedChapterCount } from "./chapters";
import { fanficStage, readFanficState } from "./request";
import { readFanficVersion } from "./versions";

// "Write all": the planned main chapters are written one after another, each as its own ordinary chapter write.
// After each write, the run goes on only while these rules hold, so a cut-off chapter or a Stop ends it.

/** The planned main chapters not written yet. */
function fanficChaptersLeft(state: FanficState, messages: readonly JsonRecord[]): number {
  return Math.max(0, fanficPlannedChapterCount(state) - fanficChapterLayout(messages).mains.length);
}

/** True when a write's events end with a saved chapter that is finished (not cut off, not missing). */
export function fanficWriteSavedFinished(events: readonly { type: string; data?: unknown }[]): boolean {
  const saved = [...events].reverse().find((event) => event.type === "assistant_message");
  if (!saved) return false;
  const data = parseRecord(saved.data);
  const version = readFanficVersion(data.extra);
  return Boolean(readString(data.id)) && version !== null && !version.unfinished;
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

/** The next write of a run: the next main chapter. Notes steer only the chapter they were written for. */
export function nextFanficBatchInput<T extends Record<string, unknown>>(input: T): T {
  return { ...input, notes: null };
}
