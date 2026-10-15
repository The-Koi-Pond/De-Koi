import type { LlmGateway } from "../../capabilities/llm";
import type { StorageGateway } from "../../capabilities/storage";
import type { FanficOutline, FanficState } from "../../contracts/types/fanfic";
import { extractLeadingThinkingBlocks } from "../../generation-core/llm/inline-thinking";
import { loadCharacters } from "../../generation/prompt-assembly";
import { isRecord, parseRecord, readString } from "../../generation/runtime-records";
import { parseGameJsonish } from "../../shared/parsing-jsonish";
import { buildFanficOutlineMessages, renderFanficCastCards } from "./prompts";
import { normalizeFanficOutline, readFanficState } from "./request";

const OUTLINE_MAX_TOKENS = 6000;

export class FanficOutlineParseError extends Error {
  readonly raw: string;

  constructor(raw: string) {
    super("The model's outline could not be read. Try again, or pick a different connection.");
    this.name = "FanficOutlineParseError";
    this.raw = raw;
  }
}

export class FanficOutlineCountError extends Error {
  constructor(received: number, requested: number) {
    super(
      `The outline came back with ${received} chapter${received === 1 ? "" : "s"} instead of ${requested}. Try again, or change the chapter count.`,
    );
    this.name = "FanficOutlineCountError";
  }
}

function jsonCandidate(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1];
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

/** Reads the model's outline reply; throws when it holds no usable chapters. */
export function parseFanficOutlineReply(raw: string): FanficOutline {
  const clean = extractLeadingThinkingBlocks(raw).cleanText;
  let parsed: unknown = null;
  try {
    parsed = parseGameJsonish(jsonCandidate(clean));
  } catch {
    parsed = null;
  }
  const outline = normalizeFanficOutline(parsed);
  if (!outline) throw new FanficOutlineParseError(raw);
  return outline;
}

export interface GenerateFanficOutlineInput {
  chatId: string;
  connectionId?: string | null;
}

/**
 * Plans the fic and stores the outline on `metadata.fanfic`. The outline starts approved when the
 * requester chose to skip review, so chapter 1 can be written right away.
 */
export async function generateFanficOutline(
  deps: { storage: StorageGateway; llm: LlmGateway },
  input: GenerateFanficOutlineInput,
  signal?: AbortSignal,
): Promise<FanficState> {
  const chat = await deps.storage.get("chats", input.chatId);
  if (!isRecord(chat)) throw new Error("Chat was not found.");
  if (readString(chat.mode) !== "fanfic") throw new Error("Outlines are only written for fanfic chats.");
  const state = readFanficState(parseRecord(chat.metadata));
  if (!state) throw new Error("Fill in the fanfic request first.");
  const connectionId = readString(input.connectionId).trim() || readString(chat.connectionId).trim();
  if (!connectionId) throw new Error("Pick a connection for this fic first.");

  const characters = await loadCharacters(deps.storage, chat);
  const messages = buildFanficOutlineMessages({
    request: state.request,
    castCards: renderFanficCastCards(characters),
    researchNotes: state.research?.notes,
  });
  const raw = await deps.llm.complete(
    {
      connectionId,
      messages,
      parameters: { maxTokens: OUTLINE_MAX_TOKENS, temperature: 1 },
    },
    signal,
  );
  if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
  const outline = parseFanficOutlineReply(raw);
  // The reader, progress, and export all count against the request, so only an exact plan is stored.
  if (outline.chapters.length !== state.request.chapterCount) {
    throw new FanficOutlineCountError(outline.chapters.length, state.request.chapterCount);
  }
  const next: FanficState = { ...state, outline, outlineApproved: !state.request.reviewOutline };
  await deps.storage.patchChatMetadata(input.chatId, { fanfic: next });
  return next;
}

/**
 * The requester's reviewed outline, normalized and held to the requested chapter count, ready to store
 * as approved. Rows with neither title nor beats are dropped by normalization, so blanking a chapter
 * fails here instead of quietly shortening the fic.
 */
export function approveFanficOutline(state: FanficState, edited: FanficOutline): FanficState {
  const outline = normalizeFanficOutline(edited);
  const received = outline?.chapters.length ?? 0;
  if (!outline || received !== state.request.chapterCount) {
    throw new FanficOutlineCountError(received, state.request.chapterCount);
  }
  return { ...state, outline, outlineApproved: true };
}
