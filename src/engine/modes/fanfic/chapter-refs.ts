import { readString, type JsonRecord } from "../../generation/runtime-records";
import { userFacingError } from "../../shared/user-facing-error";
import { stripFanficChapterHeading } from "./prompts";
import { readFanficVersion } from "./versions";

export interface FanficChapterRef {
  number: number;
  messageId: string;
  content: string;
}

/** Chapters are the chat's assistant messages, in order. */
export function fanficChapterRefs(messages: readonly JsonRecord[]): FanficChapterRef[] {
  const chapters: FanficChapterRef[] = [];
  for (const message of messages) {
    if (readString(message.role) !== "assistant") continue;
    chapters.push({
      number: chapters.length + 1,
      messageId: readString(message.id),
      content: stripFanficChapterHeading(readString(message.content)),
    });
  }
  return chapters;
}

/**
 * The first chapter whose displayed version is unfinished. Every later write would build on that version, so no other
 * write runs until it is Reset, Continued or kept as is.
 */
export function fanficUnfinishedChapter(messages: readonly JsonRecord[]): FanficChapterRef | null {
  const unfinished = new Set(
    messages.filter((message) => readFanficVersion(message.extra)?.unfinished).map((message) => readString(message.id)),
  );
  return fanficChapterRefs(messages).find((chapter) => unfinished.has(chapter.messageId)) ?? null;
}

/** Why a write can't run while a chapter is unfinished; the reader shows the same words on the buttons it disables. */
export function fanficUnfinishedReason(chapter: Pick<FanficChapterRef, "number">): string {
  return `Chapter ${chapter.number} is unfinished: Reset, Continue or Keep it as is first.`;
}

/** Refuses a write that would save a chapter version while a chapter is unfinished. */
export function assertNoFanficUnfinishedChapter(messages: readonly JsonRecord[]): void {
  const unfinished = fanficUnfinishedChapter(messages);
  if (unfinished) throw userFacingError(fanficUnfinishedReason(unfinished));
}
