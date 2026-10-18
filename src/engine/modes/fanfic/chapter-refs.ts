import { readString, type JsonRecord } from "../../generation/runtime-records";
import { stripFanficChapterHeading } from "./prompts";

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
