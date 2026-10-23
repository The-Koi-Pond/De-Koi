// ──────────────────────────────────────────────
// Fanfic living outline: re-plan what's left from what was actually written
// ──────────────────────────────────────────────
import type { LlmGateway, LlmMessage } from "../../capabilities/llm";
import type { StorageGateway } from "../../capabilities/storage";
import type { FanficOutline, FanficOutlineChapter, FanficState } from "../../contracts/types/fanfic";
import { parseJsonObject } from "../../core/json";
import { effectiveMaxContext } from "../../generation/context-window";
import { isRecord, parseRecord, readString, type JsonRecord } from "../../generation/runtime-records";
import { fanficChapterRefs, type FanficChapterRef } from "./chapter-refs";
import { fanficChapterTextKey, fanficLedgerStatus, readFanficLedger, renderFanficLedgerState } from "./ledger";
import {
  completeFanficJson,
  fanficCallBudget,
  fanficMessageChars,
  FanficReplyParseError,
  parseFanficJsonReply,
  FANFIC_CONNECTION_GONE,
  FANFIC_NO_CONNECTION,
  pickFanficHelperConnection,
} from "./llm-json";
import { renderFanficRequestForPrompt, renderFanficVoiceSheets } from "./prompts";
import { readFanficState } from "./request";
import { userFacingError } from "../../shared/user-facing-error";

const PLAN_MAX_TOKENS = 4000;
const PLAN_VERSION = 1;
const STEER_MAX_CHARS = 1500;

export class FanficPlanParseError extends FanficReplyParseError {
  constructor(detail: string) {
    super(`The updated plan could not be read (${detail}).`);
    this.name = "FanficPlanParseError";
  }
}

export interface FanficPlanChapter {
  number: number;
  title: string;
  summary: string;
  /** What the outline said before, when this chapter was planned already. */
  previous: { title: string; summary: string } | null;
  /** False when the plan for this chapter didn't change. */
  changed: boolean;
  reason: string;
}

/**
 * A suggested plan, stored on the chat as `metadata.fanficPlan` until the requester uses or dismisses it. "replan"
 * revises the outline's remaining chapters; "next" (once the fic is past its outline) suggests the next chapter's beats.
 */
export interface FanficPlanProposal {
  version: 1;
  mode: "replan" | "next";
  /** Chapters written when it was made, and the last one's text: a new or rewritten chapter makes it stale. */
  afterChapter: number;
  lastTextKey: string;
  /** The outline it was made against: editing the outline makes it stale too. */
  outlineKey: string;
  /** What changed and why, in a few sentences. */
  note: string;
  steer: string;
  chapters: FanficPlanChapter[];
  createdAt: string;
}

// ── Prompt ──────────────────────────────────────

function outlineLines(outline: FanficOutline): string {
  return outline.chapters
    .map((chapter) => `Chapter ${chapter.number}: ${chapter.title}\n${chapter.summary}`)
    .join("\n\n");
}

export function buildFanficPlanMessages(args: {
  state: FanficState;
  written: number;
  /** What the written chapters did: ledger summaries and state, or the chapters themselves. */
  story: string;
  steer: string;
}): LlmMessage[] {
  const { state, written } = args;
  const outline = state.outline!;
  const total = outline.chapters.length;
  const replan = written < total;
  const first = written + 1;
  const numbers = replan ? `${first} to ${total}` : `${first}`;
  const system = [
    replan
      ? `You keep a fanfic's outline in step with the story as it is actually being written. Chapters 1 to ${written} are written; the plan for chapters ${numbers} was made before any of them existed. Re-plan chapters ${numbers} so they follow from what really happened.`
      : `You plan the next chapter of a fanfic that has gone past its original outline: all ${total} planned chapters are written, and the requester keeps going. Plan chapter ${first} so it follows from where the story really is.`,
    [
      "How to plan:",
      replan
        ? "- Keep each remaining chapter's plan as it is when it still fits (set keep to true and copy it), and keep the requester's beats and ending unless what was written made them impossible. Change only what the written chapters require, or what the requester's steer asks."
        : "- Pick up the threads the story has left open, and don't repeat the shape of the chapters before it: if the last few chapters played the same kind of scene, this one turns somewhere new.",
      "- Let the stakes keep building, keep a second thread alive, and give someone a choice that costs them something.",
      "- Respect every fact the written chapters set up (injuries, who knows what, where people are, what was promised).",
      "- Each chapter summary is 2-3 sentences of concrete events: the situation, what changes, and where it ends up. Leave lines and images for the chapter itself.",
    ].join("\n"),
    `## The request\n${renderFanficRequestForPrompt({ ...state.request, styleNotes: "" })}`,
    `## The outline as planned\n${outlineLines(outline)}`,
    renderFanficVoiceSheets(state.voices),
    "## Reply format",
    `Reply with JSON only: {"note": string, "chapters": [{"number": number, "title": string, "summary": string, "keep": boolean, "reason": string}]}, one entry for each of chapter${replan ? "s" : ""} ${numbers}, in order. note is 1-3 sentences on what changed and why. reason is one sentence (empty when keep is true).`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const user = [
    `## What has been written\n${args.story}`,
    args.steer.trim() ? `## The requester's steer\n${args.steer.trim()}` : "",
    replan ? `Re-plan chapters ${numbers} now.` : `Plan chapter ${first} now.`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

// ── Parsing ─────────────────────────────────────

export function parseFanficPlanReply(
  raw: string,
  outline: FanficOutline,
  numbers: readonly number[],
): Pick<FanficPlanProposal, "note" | "chapters"> {
  const parsed = parseFanficJsonReply(raw);
  if (!parsed || !Array.isArray(parsed.chapters)) throw new FanficPlanParseError("no chapters list");
  const byNumber = new Map<number, Record<string, unknown>>();
  for (const entry of parsed.chapters) {
    if (isRecord(entry) && Number.isInteger(Number(entry.number))) byNumber.set(Number(entry.number), entry);
  }
  const chapters = numbers.map((number) => {
    const entry = byNumber.get(number);
    if (!entry) throw new FanficPlanParseError(`no plan for chapter ${number}`);
    const planned = outline.chapters.find((chapter) => chapter.number === number) ?? null;
    const previous = planned ? { title: planned.title, summary: planned.summary } : null;
    if (entry.keep === true && previous) {
      return { number, ...previous, previous, changed: false, reason: "" };
    }
    const title = readString(entry.title).trim().slice(0, 200);
    const summary = readString(entry.summary).trim().slice(0, 2000);
    if (!title && !summary) throw new FanficPlanParseError(`chapter ${number} is empty`);
    const changed = !previous || previous.title !== title || previous.summary !== summary;
    return {
      number,
      title: title || previous?.title || `Chapter ${number}`,
      summary,
      previous,
      changed,
      reason: changed ? readString(entry.reason).trim().slice(0, 500) : "",
    };
  });
  return { note: readString(parsed.note).trim().slice(0, 1200), chapters };
}

// ── Storage ─────────────────────────────────────

function fanficOutlineKey(outline: FanficOutline): string {
  return fanficChapterTextKey(JSON.stringify(outline.chapters.map((chapter) => [chapter.title, chapter.summary])));
}

function isPlanChapter(value: unknown): value is FanficPlanChapter {
  return (
    isRecord(value) &&
    Number.isInteger(value.number) &&
    typeof value.title === "string" &&
    typeof value.summary === "string" &&
    typeof value.changed === "boolean" &&
    typeof value.reason === "string" &&
    (value.previous === null ||
      (isRecord(value.previous) &&
        typeof value.previous.title === "string" &&
        typeof value.previous.summary === "string"))
  );
}

/** The stored suggestion, only while it still matches the chapters as they are. */
export function readFanficPlan(
  metadata: unknown,
  chapters: ReadonlyArray<Pick<FanficChapterRef, "content">>,
): FanficPlanProposal | null {
  const raw = parseJsonObject(metadata).fanficPlan;
  if (!isRecord(raw) || raw.version !== PLAN_VERSION) return null;
  if (raw.mode !== "replan" && raw.mode !== "next") return null;
  if (!Array.isArray(raw.chapters) || !raw.chapters.every(isPlanChapter)) return null;
  if (raw.afterChapter !== chapters.length) return null;
  const last = chapters[chapters.length - 1];
  if (!last || raw.lastTextKey !== fanficChapterTextKey(last.content)) return null;
  const outline = readFanficState(parseRecord(metadata))?.outline;
  if (!outline || raw.outlineKey !== fanficOutlineKey(outline)) return null;
  return raw as unknown as FanficPlanProposal;
}

/** The outline with the suggested chapters in place of the old plan for them; the chapter count never changes. */
export function applyFanficPlan(state: FanficState, proposal: FanficPlanProposal): FanficState {
  if (proposal.mode !== "replan" || !state.outline) return state;
  const byNumber = new Map(proposal.chapters.map((chapter) => [chapter.number, chapter]));
  const chapters: FanficOutlineChapter[] = state.outline.chapters.map((chapter) => {
    const next = byNumber.get(chapter.number);
    return next ? { number: chapter.number, title: next.title, summary: next.summary } : chapter;
  });
  return { ...state, outline: { ...state.outline, chapters } };
}

/** Notes for writing the suggested next chapter (a fic past its outline). */
export function fanficPlanNotes(proposal: FanficPlanProposal): string {
  const chapter = proposal.chapters[0];
  return chapter ? `${chapter.title}: ${chapter.summary}` : "";
}

// ── Running ─────────────────────────────────────

function storySoFar(chapters: FanficChapterRef[], metadata: unknown, room: number): string {
  const fresh = fanficLedgerStatus(readFanficLedger(metadata), chapters).fresh;
  if (fresh.length === chapters.length && fresh.length > 0) {
    const latest = fresh[fresh.length - 1]!;
    const summaries = fresh.map((entry) => `Chapter ${entry.chapter}: ${entry.summary}`).join("\n");
    const ledger = `${summaries}\n\nWhere things stand after chapter ${latest.chapter}:\n${renderFanficLedgerState(latest)}`;
    // The latest chapter in full too, when it fits: the next one picks up from its last page.
    const last = chapters[chapters.length - 1]!;
    return ledger.length + last.content.length <= room
      ? `${ledger}\n\n### Chapter ${last.number} in full\n${last.content.trim()}`
      : ledger;
  }
  // No ledger: as many chapters in full as fit, newest kept.
  const kept: FanficChapterRef[] = [];
  let used = 0;
  for (const chapter of [...chapters].reverse()) {
    if (kept.length > 0 && used + chapter.content.length > room) break;
    kept.unshift(chapter);
    used += chapter.content.length;
  }
  const skipped = chapters.length - kept.length;
  return [
    skipped > 0 ? `(Chapters 1 to ${skipped} are too long to include; build the story ledger to cover them.)` : "",
    ...kept.map((chapter) => `### Chapter ${chapter.number}\n${chapter.content.trim()}`),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export interface ProposeFanficPlanInput {
  chatId: string;
  connectionId?: string | null;
  /** The requester's direction for the rest of the story. */
  steer?: string;
}

/**
 * Re-plans the chapters left in the outline from what was written (or suggests the next chapter once the fic is past
 * its outline) and stores the suggestion on `metadata.fanficPlan`. Nothing in the outline changes until the requester
 * uses it.
 */
export async function proposeFanficPlan(
  deps: { storage: StorageGateway; llm: LlmGateway },
  input: ProposeFanficPlanInput,
  options: { signal?: AbortSignal } = {},
): Promise<FanficPlanProposal> {
  const chat = await deps.storage.get("chats", input.chatId);
  if (!isRecord(chat)) throw new Error("Chat was not found.");
  if (readString(chat.mode) !== "fanfic") throw new Error("Plans are only kept for fanfic chats.");
  const state = readFanficState(parseRecord(chat.metadata));
  if (!state?.outline || !state.outlineApproved) throw userFacingError("Approve the outline first.");
  const { connectionId, connection } = await pickFanficHelperConnection(deps.storage, "fanficPlanning", chat, {
    chatId: input.chatId,
    connectionId: input.connectionId,
    job: "living outline",
    missing: FANFIC_NO_CONNECTION,
    gone: FANFIC_CONNECTION_GONE,
  });
  const chapters = fanficChapterRefs((await deps.storage.listChatMessages<JsonRecord>(input.chatId)).filter(isRecord));
  if (chapters.length === 0) throw userFacingError("Write the first chapter before re-planning.");

  const steer = readString(input.steer).trim().slice(0, STEER_MAX_CHARS);
  const total = state.outline.chapters.length;
  const mode = chapters.length < total ? "replan" : "next";
  const numbers =
    mode === "replan"
      ? state.outline.chapters.filter((chapter) => chapter.number > chapters.length).map((chapter) => chapter.number)
      : [chapters.length + 1];
  const frame = buildFanficPlanMessages({ state, written: chapters.length, story: "", steer });
  const budget = fanficCallBudget(connection ? effectiveMaxContext(connection, {}) : 0, {
    maxReplyTokens: PLAN_MAX_TOKENS,
    fixedChars: fanficMessageChars(frame),
    defaultChars: 400_000,
    maxChars: 400_000,
    what: "re-planning this fic",
  });
  const messages = buildFanficPlanMessages({
    state,
    written: chapters.length,
    story: storySoFar(chapters, chat.metadata, budget.proseChars),
    steer,
  });
  const parsed = await completeFanficJson(
    deps.llm,
    { connectionId, messages, maxTokens: budget.replyTokens },
    (raw) => parseFanficPlanReply(raw, state.outline!, numbers),
    options.signal,
  );
  const proposal: FanficPlanProposal = {
    version: PLAN_VERSION,
    mode,
    afterChapter: chapters.length,
    lastTextKey: fanficChapterTextKey(chapters[chapters.length - 1]!.content),
    outlineKey: fanficOutlineKey(state.outline),
    note: parsed.note,
    steer,
    chapters: parsed.chapters,
    createdAt: new Date().toISOString(),
  };
  await deps.storage.patchChatMetadata(input.chatId, { fanficPlan: proposal });
  return proposal;
}

/** Drops the stored suggestion (used or dismissed). */
export async function clearFanficPlan(storage: StorageGateway, chatId: string): Promise<void> {
  await storage.patchChatMetadata(chatId, { fanficPlan: null });
}
