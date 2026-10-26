import type { StorageGateway } from "../../capabilities/storage";
import { readString, type JsonRecord } from "../../generation/runtime-records";
import { userFacingError } from "../../shared/user-facing-error";
import { fanficChapterLayout, type FanficChapterLayout } from "./chapter-refs";
import { readFanficExtraLink } from "./extra-link";

type ExtrasStorage = Pick<StorageGateway, "listChatMessages" | "patchChatMessageExtra">;

/**
 * Marks an extra canon (with every earlier extra of its chain) or a side story (with every later one). Only chapter
 * N's chain changes, and never any text, so it only changes what later writes read.
 */
export async function setFanficExtraCanon(
  storage: ExtrasStorage,
  chatId: string,
  messageId: string,
  canon: boolean,
): Promise<void> {
  const messages = await storage.listChatMessages<JsonRecord>(chatId);
  const layout = fanficChapterLayout(messages);
  const chapter = layout.chapters.find((entry) => entry.messageId === messageId);
  if (!chapter || layout.orphans.includes(chapter)) throw userFacingError("That chapter is no longer in this fic.");
  if (!chapter.extra) throw userFacingError("Only extra chapters can be marked canon.");
  const at = chapter.extra.index;
  const chain = layout.chains.get(chapter.mainNumber) ?? [];
  await writeCanonFlags(
    storage,
    messages,
    chain.map((ref, index) => {
      const current = ref.extra?.canon ?? false;
      return { messageId: ref.messageId, canon: canon ? index <= at || current : index < at && current };
    }),
  );
}

/** "Continues from": the next main chapter picks up after chapter N (no extra canon) or after its last extra (all). */
export async function setFanficChainCanon(
  storage: ExtrasStorage,
  chatId: string,
  parentChapter: number,
  canon: boolean,
): Promise<void> {
  const messages = await storage.listChatMessages<JsonRecord>(chatId);
  const chain = fanficChapterLayout(messages).chains.get(parentChapter) ?? [];
  if (chain.length === 0) throw userFacingError(`Chapter ${parentChapter} has no extra chapters.`);
  await writeCanonFlags(
    storage,
    messages,
    chain.map((ref) => ({ messageId: ref.messageId, canon })),
  );
}

/** What deleting a chapter takes with it, and the flags its chain must hold before it goes. */
export interface FanficDeletePlan {
  /** The chapter, then (for a main chapter) its extras in reading order. */
  deleteIds: string[];
  /** The chain's remaining extras with the flags they read as now, earliest first. */
  flagWrites: Array<{ messageId: string; canon: boolean }>;
  /** The labels of the deleted chapters, in the order of `deleteIds`. */
  labels: string[];
}

/**
 * Only the last main chapter can go, with its whole chain; any extra goes alone. The extras after a deleted extra
 * keep the flags they read as now, so a stale stored canon flag behind a side story can't turn canon once they move up.
 */
export function fanficDeletePlan(layout: FanficChapterLayout, messageId: string): FanficDeletePlan {
  const chapter = layout.chapters.find((entry) => entry.messageId === messageId);
  if (!chapter) throw userFacingError("That chapter is no longer in this fic.");
  if (!chapter.extra) {
    if (chapter !== layout.mains.at(-1)) throw userFacingError("Only the last main chapter can be deleted.");
    const deleted = [chapter, ...(layout.chains.get(chapter.mainNumber) ?? [])];
    return {
      deleteIds: deleted.map((ref) => ref.messageId),
      flagWrites: [],
      labels: deleted.map((ref) => ref.label),
    };
  }
  // An orphan is never canon and no chapter reads it, so its chain needs no flags.
  const chain = layout.orphans.includes(chapter) ? [] : (layout.chains.get(chapter.mainNumber) ?? []);
  return {
    deleteIds: [chapter.messageId],
    flagWrites: chain
      .filter((ref) => ref !== chapter)
      .map((ref) => ({ messageId: ref.messageId, canon: ref.extra?.canon ?? false })),
    labels: [chapter.label],
  };
}

/**
 * Writes the plan's flags first, then deletes in one bulk call, so a failed flag write deletes nothing and a failed
 * delete leaves flags that read as they did before.
 */
export async function deleteFanficChapter(
  deps: { storage: ExtrasStorage; deleteMessages: (messageIds: string[]) => Promise<unknown> },
  chatId: string,
  messageId: string,
): Promise<FanficDeletePlan> {
  const messages = await deps.storage.listChatMessages<JsonRecord>(chatId);
  const plan = fanficDeletePlan(fanficChapterLayout(messages), messageId);
  await writeCanonFlags(deps.storage, messages, plan.flagWrites);
  await deps.deleteMessages(plan.deleteIds);
  return plan;
}

/**
 * Writes the new flags earliest first, skipping the ones already stored. A write that fails part-way leaves a prefix
 * of the new flags, which the layout still reads as prefix-consistent.
 */
async function writeCanonFlags(
  storage: ExtrasStorage,
  messages: readonly JsonRecord[],
  flags: ReadonlyArray<{ messageId: string; canon: boolean }>,
): Promise<void> {
  const stored = new Map(messages.map((message) => [readString(message.id), readFanficExtraLink(message.extra)]));
  for (const { messageId, canon } of flags) {
    const link = stored.get(messageId);
    if (!link) throw userFacingError("That chapter is no longer in this fic.");
    if (link.canon === canon) continue;
    await storage.patchChatMessageExtra(messageId, { fanficExtra: { parentChapter: link.parentChapter, canon } });
  }
}
