import type { FanficExtraLink } from "../../contracts/types/fanfic";
import { readString, type JsonRecord } from "../../generation/runtime-records";
import { userFacingError } from "../../shared/user-facing-error";
import { FIRST_EXTRA_NUMBER, readFanficExtraLink } from "./extra-link";
import { stripFanficChapterHeading } from "./prompts";
import { readFanficVersion } from "./versions";

export interface FanficChapterRef {
  messageId: string;
  content: string;
  /** "3" for a main chapter, "3.5", "3.6", … for the extras after it. */
  label: string;
  /** The main chapter's number; for an extra, the number of the main chapter it follows. */
  mainNumber: number;
  /** Null for a main chapter. `index` counts from 0 in the chain; `canon` is the prefix-normalized flag. */
  extra: { index: number; canon: boolean } | null;
  /** Index in the layout's reading order. */
  position: number;
}

/** Every chapter's number, order and canon flag, derived from the messages; nothing about it is stored. */
export interface FanficChapterLayout {
  /** Each main chapter followed by its chain, then the orphans. */
  chapters: FanficChapterRef[];
  mains: FanficChapterRef[];
  /** The extras after each main chapter, in writing order, keyed by its number. */
  chains: Map<number, FanficChapterRef[]>;
  /** Extras whose main chapter is gone: shown last, kept out of every prompt. */
  orphans: FanficChapterRef[];
}

/**
 * Chapters are the chat's assistant messages. One without an extra marker is a main chapter, numbered by its place
 * among them; an extra joins the chain of the main chapter it names. A stored canon flag counts only while every
 * earlier extra in its chain is canon too.
 */
export function fanficChapterLayout(messages: readonly JsonRecord[]): FanficChapterLayout {
  const mains: FanficChapterRef[] = [];
  const linked: Array<{ message: JsonRecord; link: FanficExtraLink }> = [];
  const ref = (message: JsonRecord, label: string, mainNumber: number, extra: FanficChapterRef["extra"]) => ({
    messageId: readString(message.id),
    content: stripFanficChapterHeading(readString(message.content)),
    label,
    mainNumber,
    extra,
    position: 0,
  });
  for (const message of messages) {
    if (readString(message.role) !== "assistant") continue;
    const link = readFanficExtraLink(message.extra);
    if (link) linked.push({ message, link });
    else mains.push(ref(message, String(mains.length + 1), mains.length + 1, null));
  }

  const chains = new Map<number, FanficChapterRef[]>();
  const lost = new Map<number, FanficChapterRef[]>();
  for (const { message, link } of linked) {
    const parent = link.parentChapter;
    const group = parent <= mains.length ? chains : lost;
    const chain = group.get(parent) ?? [];
    const canon = link.canon && (chain.at(-1)?.extra?.canon ?? true);
    // Orphans are never canon: no later chapter reads them.
    const extra = { index: chain.length, canon: group === chains && canon };
    chain.push(ref(message, `${parent}.${FIRST_EXTRA_NUMBER + chain.length}`, parent, extra));
    group.set(parent, chain);
  }

  const orphans = [...lost.values()].flat();
  const chapters = [...mains.flatMap((main) => [main, ...(chains.get(main.mainNumber) ?? [])]), ...orphans];
  chapters.forEach((chapter, position) => (chapter.position = position));
  return { chapters, mains, chains: new Map([...chains].sort(([a], [b]) => a - b)), orphans };
}

/**
 * Extra `index` of main chapter N's chain (by default the next one to be written): its label, and the chapter it
 * picks up from, which is the extra before it or chapter N itself.
 */
export function fanficExtraPlace(
  layout: FanficChapterLayout,
  parentChapter: number,
  index?: number,
): { label: string; follows: string } {
  const chain = layout.chains.get(parentChapter) ?? [];
  const at = index ?? chain.length;
  return {
    label: `${parentChapter}.${FIRST_EXTRA_NUMBER + at}`,
    follows: chain[at - 1]?.label ?? String(parentChapter),
  };
}

/** What later chapters build on: main chapters and canon extras, in reading order. */
export function fanficCanonLine(layout: FanficChapterLayout): FanficChapterRef[] {
  return layout.chapters.filter((chapter) => chapter.extra?.canon ?? true);
}

/** What a write produces: the next main chapter, a new extra after main chapter N, or a new version of a chapter. */
export type FanficWriteTarget =
  | { kind: "main" }
  | { kind: "extra"; parentChapter: number }
  | { kind: "existing"; messageId: string };

/**
 * The stored messages a write reads, in reading order: each main chapter followed by its canon extras, and for an
 * extra its own chain so far, canon or not. A message that is not a chapter stays right after the main chapter
 * stored before it. A fic without extras gets its stored messages before the target, as before.
 */
export function fanficWriteContext(messages: readonly JsonRecord[], target: FanficWriteTarget): JsonRecord[] {
  const layout = fanficChapterLayout(messages);
  // Reading keys: main chapter m is (m, 0), a message that is not a chapter after it (m, 1), its extra i (m, 2 + i).
  const key = (chapter: FanficChapterRef): [number, number] => [
    chapter.mainNumber,
    chapter.extra ? 2 + chapter.extra.index : 0,
  ];
  const gone = () => userFacingError("That chapter is no longer in this fic.");
  let cut: [number, number];
  let ownChain: number | null = null;
  if (target.kind === "main") {
    cut = [Number.POSITIVE_INFINITY, 0];
  } else if (target.kind === "extra") {
    if (!layout.mains.some((main) => main.mainNumber === target.parentChapter)) throw gone();
    ownChain = target.parentChapter;
    cut = [ownChain, 2 + (layout.chains.get(ownChain)?.length ?? 0)];
  } else {
    const chapter = layout.chapters.find((entry) => entry.messageId === target.messageId);
    if (!chapter || layout.orphans.includes(chapter)) throw gone();
    if (chapter.extra) ownChain = chapter.mainNumber;
    cut = key(chapter);
  }

  // Walks the messages in the layout's own order, so each one meets its own ref.
  const keyed: Array<{ message: JsonRecord; key: [number, number] }> = [];
  const chainSeen = new Map<number, number>();
  let mainsSoFar = 0;
  for (const message of messages) {
    if (readString(message.role) !== "assistant") {
      keyed.push({ message, key: [mainsSoFar, 1] });
      continue;
    }
    const link = readFanficExtraLink(message.extra);
    if (!link) {
      keyed.push({ message, key: key(layout.mains[mainsSoFar++]!) });
      continue;
    }
    const index = chainSeen.get(link.parentChapter) ?? 0;
    chainSeen.set(link.parentChapter, index + 1);
    // Undefined for an orphan, which no write reads.
    const chapter = layout.chains.get(link.parentChapter)?.[index];
    if (!chapter || (!chapter.extra?.canon && chapter.mainNumber !== ownChain)) continue;
    keyed.push({ message, key: key(chapter) });
  }
  const before = ([main, step]: [number, number]) => main < cut[0] || (main === cut[0] && step < cut[1]);
  return keyed
    .filter((entry) => before(entry.key))
    .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1])
    .map((entry) => entry.message);
}

/** The chapters a chapter builds on, in reading order: its write context without the messages that aren't chapters. */
export function fanficChaptersBefore(
  messages: readonly JsonRecord[],
  layout: FanficChapterLayout,
  chapter: FanficChapterRef,
): FanficChapterRef[] {
  const context = new Set(
    fanficWriteContext(messages, { kind: "existing", messageId: chapter.messageId }).map((message) =>
      readString(message.id),
    ),
  );
  return layout.chapters.filter((entry) => context.has(entry.messageId));
}

/**
 * The first chapter whose displayed version is unfinished. Every later write would build on that version, so no other
 * write runs until it is Reset, Continued or kept as is.
 */
export function fanficUnfinishedChapter(messages: readonly JsonRecord[]): FanficChapterRef | null {
  const unfinished = new Set(
    messages.filter((message) => readFanficVersion(message.extra)?.unfinished).map((message) => readString(message.id)),
  );
  const layout = fanficChapterLayout(messages);
  // An orphan takes no part in later writes, so it holds none of them up.
  return (
    layout.chapters.find((chapter) => !layout.orphans.includes(chapter) && unfinished.has(chapter.messageId)) ?? null
  );
}

/** Why a write can't run while a chapter is unfinished; the reader shows the same words on the buttons it disables. */
export function fanficUnfinishedReason(chapter: Pick<FanficChapterRef, "label">): string {
  return `Chapter ${chapter.label} is unfinished: Reset, Continue or Keep it as is first.`;
}

/** Refuses a write that would save a chapter version while a chapter is unfinished. */
export function assertNoFanficUnfinishedChapter(messages: readonly JsonRecord[]): void {
  const unfinished = fanficUnfinishedChapter(messages);
  if (unfinished) throw userFacingError(fanficUnfinishedReason(unfinished));
}
