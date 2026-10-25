import type { FanficState, FanficVersion } from "../../contracts/types/fanfic";
import { resolveGenerationConnection } from "../../generation/context";
import type { GenerationEngineDeps, StartGenerationInput } from "../../generation/start-generation";
import { startGeneration } from "../../generation/start-generation";
import { isRecord, parseRecord, readString, type JsonRecord } from "../../generation/runtime-records";
import { fanficChapterRefs, type FanficChapterRef } from "./chapter-refs";
import { fanficModelRecord, fanficVersionIndex } from "./versions";
import { buildFanficChapterGuide, buildFanficRevisionGuide } from "./prompts";
import { buildFanficRepetitionGuide, detectFanficRepetition, fanficRepetitionNames } from "./repetition";
import { fanficChapterMaxTokens, fanficStage, readFanficState } from "./request";
import { userFacingError } from "../../shared/user-facing-error";

export { fanficChapterRefs, type FanficChapterRef };

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
    throw userFacingError("Finish the fanfic request and outline before writing chapters.");
  }
  return state;
}

function targetChapter(chapters: FanficChapterRef[], messageId: string): FanficChapterRef {
  const chapter = chapters.find((entry) => entry.messageId === messageId);
  if (!chapter) throw userFacingError("That chapter is no longer in this fic.");
  return chapter;
}

/** What the other chapters already overuse, so the chapter being written doesn't pile on. */
function overusedElsewhere(state: FanficState, chapters: FanficChapterRef[], skip?: FanficChapterRef): string {
  const others = chapters.filter((chapter) => chapter !== skip).map((chapter) => chapter.content);
  return buildFanficRepetitionGuide(detectFanficRepetition(others, { names: fanficRepetitionNames(state.request) }));
}

function fanficGuide(state: FanficState, chapters: FanficChapterRef[], input: StartFanficGenerationInput) {
  const notes = readString(input.notes).trim();
  if (input.fanficKind === "chapter") {
    return {
      guide: buildFanficChapterGuide(state, chapters.length + 1, notes, overusedElsewhere(state, chapters)),
      source: "fanfic_chapter" as const,
    };
  }
  const chapter = targetChapter(chapters, readString(input.regenerateMessageId).trim());
  const overused = overusedElsewhere(state, chapters, chapter);
  if (input.fanficKind === "revise") {
    if (!notes) throw userFacingError("Say what to change before rewriting the chapter.");
    return {
      guide: buildFanficRevisionGuide(state, chapter.number, notes, chapter.content, overused),
      source: "fanfic_revise" as const,
    };
  }
  return { guide: buildFanficChapterGuide(state, chapter.number, "", overused), source: "fanfic_chapter" as const };
}

/**
 * The shared-pipeline input for one fanfic call. The chapter instruction rides as a generation guide,
 * so no request text is saved into the fic.
 */
export function fanficGenerationInput(
  state: FanficState,
  messages: readonly JsonRecord[],
  input: StartFanficGenerationInput,
): StartGenerationInput {
  const { guide, source } = fanficGuide(state, fanficChapterRefs(messages), input);
  const { fanficKind: _kind, notes: _notes, ...generationInput } = input;
  return {
    ...generationInput,
    message: undefined,
    userMessage: null,
    connectionId: readString(input.connectionId).trim() || null,
    generationGuide: guide,
    generationGuideSource: source,
    parameters: { ...parseRecord(input.parameters), maxTokens: fanficChapterMaxTokens(state.request) },
  };
}

/** The record a new version starts with: the connection that writes it, named as it is now, and what was asked. */
function fanficWriteVersion(
  connection: JsonRecord,
  messages: readonly JsonRecord[],
  input: StartFanficGenerationInput,
): FanficVersion {
  // A plain redo has no instructions; its guide ignores any notes.
  const notes = input.fanficKind === "regenerate" ? "" : readString(input.notes).trim();
  const revised =
    input.fanficKind === "revise"
      ? messages.find((message) => message.id === readString(input.regenerateMessageId).trim())
      : undefined;
  const origin: FanficVersion["origin"] = revised
    ? { kind: input.fanficKind, notes, baseVersion: fanficVersionIndex(revised) }
    : { kind: input.fanficKind, notes };
  return { models: [fanficModelRecord(connection)], origin, unfinished: null };
}

/** Writes the next chapter, or a new version of an existing one, through the shared generation pipeline. */
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
    throw userFacingError("Pick the chapter to rewrite.");
  }
  if (input.fanficKind === "chapter" && readString(input.regenerateMessageId).trim()) {
    throw new Error("A new chapter cannot target an existing one.");
  }
  const messages = await deps.storage.listChatMessages<JsonRecord>(chatId);
  const generationInput = fanficGenerationInput(state, messages, input);
  // The same lookup the shared pipeline makes, so the record names the connection that actually writes.
  const connection = await resolveGenerationConnection(deps.storage, chat, generationInput);
  const savedExtra = { fanficVersion: fanficWriteVersion(connection, messages, input) };

  yield* startGeneration(deps, { ...generationInput, savedExtra }, signal);
}
