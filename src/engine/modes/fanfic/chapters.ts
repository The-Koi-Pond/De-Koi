import type { StorageGateway } from "../../capabilities/storage";
import type { FanficState, FanficUnfinished, FanficVersion } from "../../contracts/types/fanfic";
import { resolveGenerationConnection } from "../../generation/context";
import type { GenerationEvent } from "../../generation/generation-events";
import type { GenerationEngineDeps, StartGenerationInput } from "../../generation/start-generation";
import { isFailureWithSavedPartial, startGeneration } from "../../generation/start-generation";
import { isRecord, parseRecord, readString, type JsonRecord } from "../../generation/runtime-records";
import {
  fanficChapterRefs,
  fanficUnfinishedChapter,
  fanficUnfinishedReason,
  type FanficChapterRef,
} from "./chapter-refs";
import {
  classifyFanficInterruption,
  fanficModelRecord,
  fanficModelsWith,
  fanficVersionIndex,
  readFanficVersion,
} from "./versions";
import {
  buildFanficChapterGuide,
  buildFanficContinueGuide,
  buildFanficRevisionGuide,
  stripFanficChapterHeading,
} from "./prompts";
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

/** `continue` appends to the unfinished version of `continueMessageId`; the others write a chapter or a new version. */
export type FanficGenerationKind = "chapter" | "regenerate" | "revise" | "continue";

export interface StartFanficGenerationInput extends StartGenerationInput {
  fanficKind: FanficGenerationKind;
  /** Requester notes: steer the next chapter, or the changes a rewrite should make. */
  notes?: string | null;
  /**
   * Reset: the unfinished version of `regenerateMessageId` this write replaces (the one it shows); it is deleted once
   * the replacement is saved. The write runs the version's own kind again with the edited notes.
   */
  replacesVersion?: number;
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

/** A Reset of a revision rewrites the version the cut-off revision started from, not the cut-off text. */
function resetRevisionBase(messages: readonly JsonRecord[], input: StartFanficGenerationInput): string | null {
  if (input.fanficKind !== "revise" || input.replacesVersion === undefined) return null;
  const target = messages.find((message) => message.id === readString(input.regenerateMessageId).trim());
  const base = readFanficVersion(target?.extra)?.origin.baseVersion;
  const swipes = Array.isArray(target?.swipes) ? target.swipes : [];
  const text = base === undefined ? "" : readString(parseRecord(swipes[base]).content);
  if (!text.trim()) throw userFacingError("The version this rewrite started from can't be read. Use Redo instead.");
  return stripFanficChapterHeading(text);
}

function fanficGuide(state: FanficState, messages: readonly JsonRecord[], input: StartFanficGenerationInput) {
  const chapters = fanficChapterRefs(messages);
  const notes = readString(input.notes).trim();
  if (input.fanficKind === "continue") {
    const chapter = targetChapter(chapters, readString(input.continueMessageId).trim());
    return {
      guide: buildFanficContinueGuide(String(chapter.number), chapter.content),
      source: "fanfic_chapter" as const,
    };
  }
  if (input.fanficKind === "chapter" && !readString(input.regenerateMessageId).trim()) {
    return {
      guide: buildFanficChapterGuide(state, chapters.length + 1, notes, overusedElsewhere(state, chapters)),
      source: "fanfic_chapter" as const,
    };
  }
  const chapter = targetChapter(chapters, readString(input.regenerateMessageId).trim());
  const overused = overusedElsewhere(state, chapters, chapter);
  if (input.fanficKind === "revise") {
    if (!notes) throw userFacingError("Say what to change before rewriting the chapter.");
    const previous = resetRevisionBase(messages, input) ?? chapter.content;
    return {
      guide: buildFanficRevisionGuide(state, chapter.number, notes, previous, overused),
      source: "fanfic_revise" as const,
    };
  }
  // A plain redo ignores notes; a Reset of a new chapter or a redo writes the chapter again with the edited notes.
  const chapterNotes = input.replacesVersion === undefined ? "" : notes;
  return {
    guide: buildFanficChapterGuide(state, chapter.number, chapterNotes, overused),
    source: "fanfic_chapter" as const,
  };
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
  const { guide, source } = fanficGuide(state, messages, input);
  const { fanficKind: _kind, notes: _notes, replacesVersion: _replaces, ...generationInput } = input;
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
  kind: Exclude<FanficGenerationKind, "continue">,
): FanficVersion {
  const resets = input.replacesVersion !== undefined;
  // A plain redo has no instructions; its guide ignores any notes. A Reset keeps the notes it was given.
  const notes = kind === "regenerate" && !resets ? "" : readString(input.notes).trim();
  const revised =
    kind === "revise"
      ? messages.find((message) => message.id === readString(input.regenerateMessageId).trim())
      : undefined;
  // A Reset rewrites the same version its cut-off revision started from.
  const baseVersion = revised
    ? ((resets ? readFanficVersion(revised.extra)?.origin.baseVersion : undefined) ?? fanficVersionIndex(revised))
    : undefined;
  const origin: FanficVersion["origin"] = baseVersion === undefined ? { kind, notes } : { kind, notes, baseVersion };
  return { models: [fanficModelRecord(connection)], origin, unfinished: null };
}

/** A continue keeps the version's record and adds the model that writes the rest; only an unfinished one continues. */
function fanficContinuedVersion(
  connection: JsonRecord,
  messages: readonly JsonRecord[],
  input: StartFanficGenerationInput,
): FanficVersion {
  const target = messages.find((message) => message.id === readString(input.continueMessageId).trim());
  if (!target) throw userFacingError("That chapter is no longer in this fic.");
  const current = readFanficVersion(target.extra);
  if (!current?.unfinished) throw userFacingError("Only an unfinished chapter can be continued.");
  return { ...current, models: fanficModelsWith(current.models, fanficModelRecord(connection)) };
}

/**
 * Writes the next chapter, or a new version of an existing one, or the rest of an unfinished version, through the
 * shared generation pipeline.
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
  const rewrites = readString(input.regenerateMessageId).trim();
  const continues = readString(input.continueMessageId).trim();
  if (input.fanficKind === "continue") {
    if (!continues) throw userFacingError("Pick the chapter to continue.");
    if (rewrites) throw new Error("A continue cannot also rewrite a chapter.");
  } else {
    if (continues) throw new Error("Only a continue can add to a chapter.");
    if (input.fanficKind !== "chapter" && !rewrites) throw userFacingError("Pick the chapter to rewrite.");
    if (input.fanficKind === "chapter" && rewrites && input.replacesVersion === undefined) {
      throw new Error("A new chapter cannot target an existing one.");
    }
  }
  const replaced = input.replacesVersion;
  if (replaced !== undefined && (input.fanficKind === "continue" || !rewrites || !Number.isInteger(replaced))) {
    throw new Error("A Reset replaces one version of the chapter it rewrites.");
  }
  let messages = await deps.storage.listChatMessages<JsonRecord>(chatId);
  assertFanficWriteAllowed(messages, input);
  if (replaced !== undefined && input.fanficKind === "revise") {
    // The version the revision started from is read from the full message; a list may leave versions out.
    const full = await deps.storage.getChatMessage<JsonRecord>(rewrites);
    messages = messages.map((message) => (message.id === rewrites && isRecord(full) ? full : message));
  }
  const generationInput = fanficGenerationInput(state, messages, input);
  // The same lookup the shared pipeline makes, so the record names the connection that actually writes.
  const connection = await resolveGenerationConnection(deps.storage, chat, generationInput);
  // Born unfinished in the same write as the text, so a version is never read as finished before it is settled.
  const version: FanficVersion = {
    ...(input.fanficKind === "continue"
      ? fanficContinuedVersion(connection, messages, input)
      : fanficWriteVersion(connection, messages, input, input.fanficKind)),
    unfinished: BORN_UNFINISHED,
  };

  yield* settleFanficWrite(
    deps.storage,
    version,
    startGeneration(
      deps,
      { ...generationInput, savedExtra: { fanficVersion: version }, keepStreamedTextOnFailure: true },
      signal,
    ),
    signal,
    replaced === undefined ? null : { chatId, index: replaced },
  );
}

/**
 * While a chapter shows an unfinished version, only its Reset or Continue may write; a Reset must name the version
 * it shows, the one the replacement deletes.
 */
function assertFanficWriteAllowed(messages: readonly JsonRecord[], input: StartFanficGenerationInput): void {
  const unfinished = fanficUnfinishedChapter(messages);
  const target = readString(input.continueMessageId || input.regenerateMessageId).trim();
  const resolves = input.fanficKind === "continue" || input.replacesVersion !== undefined;
  if (unfinished && !(resolves && target === unfinished.messageId)) {
    throw userFacingError(fanficUnfinishedReason(unfinished));
  }
  if (input.replacesVersion === undefined) return;
  const message = messages.find((entry) => entry.id === target);
  if (
    !message ||
    fanficVersionIndex(message) !== input.replacesVersion ||
    !readFanficVersion(message.extra)?.unfinished
  ) {
    throw userFacingError("Reset only replaces the unfinished version the chapter shows.");
  }
}

/** Keep as is: the displayed version is marked finished, its text untouched. */
export async function keepFanficVersion(
  storage: StorageGateway,
  input: { chatId: string; messageId: string },
): Promise<unknown> {
  const message = await storage.getChatMessage<JsonRecord>(input.messageId);
  if (!isRecord(message) || readString(message.chatId) !== input.chatId) {
    throw userFacingError("That chapter is no longer in this fic.");
  }
  const version = readFanficVersion(message.extra);
  if (!version?.unfinished) return message;
  return storage.patchChatMessageExtra(input.messageId, { fanficVersion: { ...version, unfinished: null } });
}

const BORN_UNFINISHED: FanficUnfinished = { reason: "failure", code: null, message: null };

function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === "AbortError");
}

/**
 * Passes the write's events through, holding back the saved chapter until it is known how the write ended, then
 * records that on the version and shows the settled chapter. A chapter kept after an interruption ends the write
 * normally, so it shows as unfinished instead of as a failed write; with no chapter saved the error goes on as before.
 * `replaced` is the unfinished version a Reset deletes once its replacement is saved.
 */
export async function* settleFanficWrite(
  storage: StorageGateway,
  version: FanficVersion,
  events: AsyncGenerator<GenerationEvent>,
  signal: AbortSignal | undefined,
  replaced: ReplacedFanficVersion | null,
): AsyncGenerator<GenerationEvent> {
  let held: GenerationEvent | null = null;
  let settled: JsonRecord | null = null;
  const settleHeld = async function* (unfinished: FanficUnfinished | null): AsyncGenerator<GenerationEvent> {
    const saved = held!;
    held = null;
    for await (const event of settledFanficEvent(storage, saved, { ...version, unfinished }, replaced)) {
      settled = parseRecord(event.data);
      yield event;
    }
  };
  // Work after the save (agents, sprites, illustrations) re-sends rows it read before the settle.
  const withSettled = (event: GenerationEvent): GenerationEvent => {
    const data = parseRecord(event.data);
    if (event.type !== "assistant_message" || !settled || readString(data.id) !== readString(settled.id)) return event;
    const versions = replaced ? { swipeCount: settled.swipeCount, activeSwipeIndex: settled.activeSwipeIndex } : {};
    const fanficVersion = parseRecord(settled.extra).fanficVersion;
    return {
      type: "assistant_message",
      data: { ...data, ...versions, extra: { ...parseRecord(data.extra), fanficVersion } },
    };
  };
  const ended = (event: GenerationEvent) =>
    classifyFanficInterruption(null, parseRecord(parseRecord(event.data).extra).providerMetadata);
  try {
    for await (const event of events) {
      if (event.type === "assistant_message" && !held && !settled) {
        held = event;
        continue;
      }
      if (held) yield* settleHeld(ended(held));
      yield withSettled(event);
    }
  } catch (error) {
    if (!held) throw error;
    // A Stop is not an interruption: the kept text is the chapter as the requester left it.
    if (isAbort(error, signal)) {
      yield* settleHeld(null);
      throw error;
    }
    // The reply was saved whole, and the failure came from the work after the save.
    if (!isFailureWithSavedPartial(error)) {
      yield* settleHeld(ended(held));
      throw error;
    }
    const unfinished = classifyFanficInterruption(error, null)!;
    console.warn("[fanfic] chapter kept after interruption", unfinished.code, error);
    yield* settleHeld(unfinished);
    return;
  }
  if (held) yield* settleHeld(ended(held));
}

/** The unfinished version a Reset deletes once its replacement is saved. */
export interface ReplacedFanficVersion {
  chatId: string;
  index: number;
}

const errorText = (error: unknown) => readString(parseRecord(error).message) || "storage error";

/**
 * Writes the settled record onto the saved version; if that fails the version stays born-unfinished, and says so.
 * After a Reset it then deletes the version it replaced; the replacement was added last, so it stays shown.
 */
async function* settledFanficEvent(
  storage: StorageGateway,
  saved: GenerationEvent,
  fanficVersion: FanficVersion,
  replaced: ReplacedFanficVersion | null,
): AsyncGenerator<GenerationEvent> {
  const data = parseRecord(saved.data);
  const messageId = readString(data.id);
  try {
    await storage.patchChatMessageExtra(messageId, { fanficVersion });
  } catch (error) {
    yield saved;
    throw Object.assign(
      userFacingError(
        `The chapter text was saved, but recording how the write ended failed (${errorText(error)}). It is marked unfinished for now.`,
      ),
      { cause: error },
    );
  }
  const settled: GenerationEvent = {
    type: "assistant_message",
    data: { ...data, extra: { ...parseRecord(data.extra), fanficVersion } },
  };
  if (!replaced) {
    yield settled;
    return;
  }
  let row: unknown;
  try {
    if (!storage.deleteChatMessageSwipe) throw new Error("this storage can't delete a version");
    row = await storage.deleteChatMessageSwipe(replaced.chatId, messageId, replaced.index);
  } catch (error) {
    yield settled;
    throw Object.assign(
      userFacingError(
        `The new version was saved, but the unfinished one couldn't be removed (${errorText(error)}). It is still one of the chapter's versions.`,
      ),
      { cause: error },
    );
  }
  const { swipes: _swipes, ...shown } = parseRecord(row);
  yield { type: "assistant_message", data: shown };
}
