import type { FanficState } from "../../contracts/types/fanfic";
import type { GenerationEngineDeps, StartGenerationInput } from "../../generation/start-generation";
import { startGeneration } from "../../generation/start-generation";
import { isRecord, parseRecord, readString, type JsonRecord } from "../../generation/runtime-records";
import { buildFanficChapterGuide, buildFanficRevisionGuide, stripFanficChapterHeading } from "./prompts";
import { fanficChapterMaxTokens, fanficStage, readFanficState } from "./request";

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

export function fanficChapterTitle(state: FanficState | null, chapterNumber: number): string {
  return state?.outline?.chapters.find((chapter) => chapter.number === chapterNumber)?.title ?? "";
}

/** Planned chapter count: the outline's length once it exists, else the request's. */
export function fanficPlannedChapterCount(state: FanficState): number {
  return state.outline?.chapters.length ?? state.request.chapterCount;
}

export type FanficGenerationKind = "chapter" | "regenerate" | "revise";

export interface StartFanficGenerationInput extends StartGenerationInput {
  fanficKind: FanficGenerationKind;
  /** Requester notes: steer the next chapter, or the changes a rewrite should make. */
  notes?: string | null;
}

function assertFanficChat(chat: JsonRecord): FanficState {
  if (readString(chat.mode || chat.chatMode) !== "fanfic") {
    throw new Error("Fanfic generation can only run for fanfic chats.");
  }
  const state = readFanficState(parseRecord(chat.metadata));
  if (!state || fanficStage(state) !== "writing") {
    throw new Error("Finish the fanfic request and outline before writing chapters.");
  }
  return state;
}

function targetChapter(chapters: FanficChapterRef[], messageId: string): FanficChapterRef {
  const chapter = chapters.find((entry) => entry.messageId === messageId);
  if (!chapter) throw new Error("That chapter is no longer in this fic.");
  return chapter;
}

function fanficGuide(state: FanficState, chapters: FanficChapterRef[], input: StartFanficGenerationInput) {
  const notes = readString(input.notes).trim();
  if (input.fanficKind === "chapter") {
    return {
      guide: buildFanficChapterGuide(state, chapters.length + 1, notes),
      source: "fanfic_chapter" as const,
    };
  }
  const chapter = targetChapter(chapters, readString(input.regenerateMessageId).trim());
  if (input.fanficKind === "revise") {
    if (!notes) throw new Error("Say what to change before rewriting the chapter.");
    return {
      guide: buildFanficRevisionGuide(state, chapter.number, notes, chapter.content),
      source: "fanfic_revise" as const,
    };
  }
  return { guide: buildFanficChapterGuide(state, chapter.number), source: "fanfic_chapter" as const };
}

/**
 * Writes the next chapter, or a new version of an existing one, through the shared generation pipeline.
 * The chapter instruction rides as a generation guide, so no request text is saved into the fic.
 */
export async function* startFanficGeneration(
  deps: GenerationEngineDeps,
  input: StartFanficGenerationInput,
  signal?: AbortSignal,
) {
  const chatId = readString(input.chatId).trim();
  if (!chatId) throw new Error("chatId is required");
  const chat = await deps.storage.get("chats", chatId);
  if (!isRecord(chat)) throw new Error("Chat was not found.");
  const state = assertFanficChat(chat);
  if (input.fanficKind !== "chapter" && !readString(input.regenerateMessageId).trim()) {
    throw new Error("Pick the chapter to rewrite.");
  }
  if (input.fanficKind === "chapter" && readString(input.regenerateMessageId).trim()) {
    throw new Error("A new chapter cannot target an existing one.");
  }
  const messages = await deps.storage.listChatMessages<JsonRecord>(chatId);
  const chapters = fanficChapterRefs(messages);
  const { guide, source } = fanficGuide(state, chapters, input);
  const { fanficKind: _kind, notes: _notes, ...generationInput } = input;

  yield* startGeneration(
    deps,
    {
      ...generationInput,
      message: undefined,
      userMessage: null,
      connectionId: readString(input.connectionId).trim() || null,
      generationGuide: guide,
      generationGuideSource: source,
      parameters: { ...parseRecord(input.parameters), maxTokens: fanficChapterMaxTokens(state.request) },
    },
    signal,
  );
}
