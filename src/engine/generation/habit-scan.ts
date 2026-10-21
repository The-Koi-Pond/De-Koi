// ──────────────────────────────────────────────
// Roleplay and Conversation: a model reads the latest replies and names the habits a reader would notice
// ──────────────────────────────────────────────
import { z } from "zod";

import type { LlmGateway, LlmMessage } from "../capabilities/llm";
import type { StorageGateway } from "../capabilities/storage";
import { boolish, parseRecord, readString, type JsonRecord } from "./runtime-records";
import { generateStructured } from "./structured-generation";

const HABIT_SCAN_VERSION = 2;
/** How many of the latest assistant replies one scan reads. */
const HABIT_SCAN_REPLIES = 8;
/**
 * A habit counts once it shows up in two replies. Waiting for three let a new running bit land a third and fourth
 * time before the note named it, and a reader already notices the second time.
 */
const HABIT_MIN_REPLIES = 2;
/** Replies needed before the first scan. */
const FIRST_SCAN_REPLIES = HABIT_MIN_REPLIES;
const MAX_HABITS = 6;
const MAX_REPLY_CHARS = 2_400;
const MAX_USER_CHARS = 400;

export type HabitScanMode = "roleplay" | "conversation";

const scanSchema = z.object({
  habits: z
    .array(
      z.object({
        habit: z.string().trim().min(3).max(160),
        replies: z.array(z.number().int().min(1)).max(HABIT_SCAN_REPLIES),
        quotes: z.array(z.string().trim().min(3).max(240)).min(1).max(3),
      }),
    )
    .max(10),
});

const SCHEMA_DESCRIPTION = `{
  "habits": [
    { "habit": "short plain name of the habit", "replies": [2, 5], "quotes": ["exact words from one reply", "exact words from another"] }
  ]
}`;

export interface HabitScanEntry {
  habit: string;
  /** How many of the scanned replies show it. */
  replies: number;
  /** Exact excerpts, each found in the scanned replies. */
  quotes: string[];
}

export interface HabitScan {
  version: typeof HABIT_SCAN_VERSION;
  /** The newest assistant message the scan read. */
  throughMessageId: string;
  scannedReplies: number;
  habits: HabitScanEntry[];
  scannedAt: string;
}

interface VisibleMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

function hidden(message: JsonRecord): boolean {
  return boolish(message.hiddenFromAI, false) || boolish(parseRecord(message.extra).hiddenFromAI, false);
}

function visibleMessages(messages: readonly JsonRecord[]): VisibleMessage[] {
  return messages
    .filter((message) => !hidden(message))
    .map((message) => ({
      id: readString(message.id).trim(),
      role: readString(message.role).trim(),
      content: readString(message.content).trim(),
    }))
    .filter((message): message is VisibleMessage => message.role === "user" || message.role === "assistant")
    .filter((message) => message.content.length > 0);
}

function visibleAssistantReplies(messages: readonly JsonRecord[]): VisibleMessage[] {
  return visibleMessages(messages).filter((message) => message.role === "assistant");
}

function comparable(value: string): string {
  return value
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[*_]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function readHabitScan(metadata: unknown): HabitScan | null {
  const record = parseRecord(parseRecord(metadata).habitScan);
  if (record.version !== HABIT_SCAN_VERSION || !Array.isArray(record.habits)) return null;
  const habits = record.habits
    .map((entry) => parseRecord(entry))
    .map((entry) => ({
      habit: readString(entry.habit).trim(),
      replies: typeof entry.replies === "number" ? entry.replies : 0,
      quotes: Array.isArray(entry.quotes) ? entry.quotes.map((quote) => readString(quote).trim()).filter(Boolean) : [],
    }))
    .filter((entry) => entry.habit && entry.quotes.length > 0);
  return {
    version: HABIT_SCAN_VERSION,
    throughMessageId: readString(record.throughMessageId).trim(),
    scannedReplies: typeof record.scannedReplies === "number" ? record.scannedReplies : 0,
    habits,
    scannedAt: readString(record.scannedAt).trim(),
  };
}

/**
 * True when a reply has landed since the reply the last scan ended on (or none ran yet, or that reply is gone).
 * `messages` only needs the latest page of the chat, oldest first.
 */
export function habitScanDue(messages: readonly JsonRecord[], scan: HabitScan | null): boolean {
  const visible = visibleAssistantReplies(messages);
  if (visible.length < FIRST_SCAN_REPLIES) return false;
  if (!scan) return true;
  return visible.at(-1)?.id !== scan.throughMessageId;
}

const runningScans = new WeakMap<object, Set<string>>();
/** How much of the chat a scheduled scan loads: enough for the scanned replies plus the user turns between them. */
const SCHEDULED_SCAN_PAGE = HABIT_SCAN_REPLIES * 3;

export interface ScheduleHabitScanInput {
  storage: Pick<StorageGateway, "get" | "listChatMessages" | "patchChatMetadata">;
  llm: LlmGateway;
  chatId: string;
  mode: HabitScanMode;
  connectionId?: string | null;
}

/**
 * After a reply is saved: if a scan is due, run it in the background and store it on the chat for the next turns.
 * One scan per chat at a time. Nothing waits on it; a lost or failed scan just runs again after the next reply,
 * because it is still due then.
 */
export function scheduleHabitScan(input: ScheduleHabitScanInput): void {
  const running = runningScans.get(input.storage) ?? new Set<string>();
  runningScans.set(input.storage, running);
  if (!input.chatId || running.has(input.chatId)) return;
  running.add(input.chatId);
  setTimeout(() => {
    void runHabitScanIfDue(input)
      .catch((error: unknown) => console.warn("[habit-scan] scan failed; it runs again after the next reply", error))
      .finally(() => running.delete(input.chatId));
  }, 0);
}

/** Loads the chat, scans it if due and stores the result. Returns the stored scan, or null when none ran. */
export async function runHabitScanIfDue(input: ScheduleHabitScanInput): Promise<HabitScan | null> {
  const chat = await input.storage.get<JsonRecord>("chats", input.chatId);
  if (!chat) return null;
  const page = await input.storage.listChatMessages<JsonRecord>(input.chatId, {
    orderBy: "createdAt",
    descending: true,
    limit: SCHEDULED_SCAN_PAGE,
    fields: ["id", "role", "content", "extra", "hiddenFromAI", "createdAt"],
  });
  const messages = [...page].reverse();
  if (!habitScanDue(messages, readHabitScan(chat.metadata))) return null;
  const scan = await runHabitScan({ llm: input.llm }, { messages, mode: input.mode, connectionId: input.connectionId });
  if (scan) await input.storage.patchChatMetadata(input.chatId, { habitScan: scan });
  return scan;
}

const MODE_WORDS: Record<HabitScanMode, { replies: string; reader: string; moves: string }> = {
  roleplay: {
    replies: "replies of an interactive story",
    reader: "a reader",
    moves:
      'an opener, a gesture or body beat, a prop handled as a fidget, a background noise or weather used as a pause, a sentence shape ("He doesn\'t X. He Y."), a closing move (an ultimatum, someone waiting on the user), a pet name, a simile, or a phrase.',
  },
  conversation: {
    replies: "texts a character sent in a chat with the user",
    reader: "the user",
    moves:
      "an opener or verdict word, a closing line or sign-off, a reminder or nag, a running joke or callback the character keeps raising (a pet, a neighbour, an earlier joke), the user's name used as a jab, a stock reassurance, or a phrase.",
  },
};

function habitScanMessages(mode: HabitScanMode, window: readonly VisibleMessage[]): LlmMessage[] {
  const words = MODE_WORDS[mode];
  let reply = 0;
  const lines = window.map((message) => {
    if (message.role === "user") return `(User: ${message.content.slice(0, MAX_USER_CHARS)})`;
    reply += 1;
    return `Reply ${reply}:\n${message.content.slice(0, MAX_REPLY_CHARS)}`;
  });
  return [
    {
      role: "system",
      content: [
        `You read the latest ${words.replies}, numbered from oldest to newest, and find the habits ${words.reader} starts to notice. The user's turns are shown in brackets for context only.`,
        `A habit is the same move coming back across replies: ${words.moves}`,
        "Count habits that show up in 2 or more different replies. A bit the character invented and keeps bringing back counts even when it is funny or in character. Skip the people, places and plot objects the story is about, and anything the user brought up in their latest turn, unless the writing keeps using them as filler.",
        `List at most ${MAX_HABITS}, most noticeable first. For each, give a short plain name, the numbers of the replies it shows up in, and 1 to 3 short quotes copied exactly from different replies.`,
        "Return an empty list when nothing recurs. Respond with only one JSON object in this exact shape:",
        SCHEMA_DESCRIPTION,
      ].join("\n"),
    },
    { role: "user", content: lines.join("\n\n") },
  ];
}

/** Keeps habits the replies back up: quotes must appear in the scanned text and the habit in 2+ replies. */
export function groundHabitScan(
  habits: z.infer<typeof scanSchema>["habits"],
  replies: readonly string[],
): HabitScanEntry[] {
  const texts = replies.map(comparable);
  const grounded: HabitScanEntry[] = [];
  for (const entry of habits) {
    const quotes = entry.quotes.filter((quote) => texts.some((text) => text.includes(comparable(quote))));
    const replyNumbers = new Set(entry.replies.filter((number) => number >= 1 && number <= replies.length));
    if (quotes.length === 0 || replyNumbers.size < HABIT_MIN_REPLIES) continue;
    grounded.push({ habit: entry.habit, replies: replyNumbers.size, quotes });
    if (grounded.length >= MAX_HABITS) break;
  }
  return grounded;
}

export async function runHabitScan(
  capabilities: { llm: LlmGateway },
  input: {
    messages: readonly JsonRecord[];
    mode: HabitScanMode;
    connectionId?: string | null;
    now?: () => Date;
  },
  signal?: AbortSignal,
): Promise<HabitScan | null> {
  const visible = visibleMessages(input.messages);
  const assistant = visible.filter((message) => message.role === "assistant");
  if (assistant.length < FIRST_SCAN_REPLIES) return null;
  const scanned = assistant.slice(-HABIT_SCAN_REPLIES);
  // The scanned replies plus the user turns between them.
  const window = visible.slice(visible.indexOf(scanned[0]!));
  const result = await generateStructured(
    capabilities,
    {
      taskName: "habit_scan",
      connectionId: input.connectionId,
      messages: habitScanMessages(input.mode, window),
      parameters: { temperature: 0, maxTokens: 1_000, reasoningEffort: "low" },
      schema: scanSchema,
      schemaDescription: SCHEMA_DESCRIPTION,
      maxRepairAttempts: 1,
      failureMessage: "The habit scan did not return valid JSON.",
    },
    signal,
  );
  if (!result.ok) return null;
  return {
    version: HABIT_SCAN_VERSION,
    throughMessageId: scanned.at(-1)?.id ?? "",
    scannedReplies: scanned.length,
    habits: groundHabitScan(
      result.data.habits,
      scanned.map((reply) => reply.content),
    ),
    scannedAt: (input.now?.() ?? new Date()).toISOString(),
  };
}

function clip(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= 90 ? compact : `${compact.slice(0, 89).trimEnd()}…`;
}

/** Steering lines for the next reply, one per habit. */
export function habitScanGuidance(scan: HabitScan | null): string[] {
  if (!scan) return [];
  return scan.habits.map(
    (entry) =>
      `- ${entry.habit} (in ${entry.replies} of the last ${scan.scannedReplies} replies, e.g. ${entry.quotes
        .slice(0, 2)
        .map((quote) => `"${clip(quote)}"`)
        .join("; ")}). Leave it out of this reply, and don't swap in a new recurring move.`,
  );
}
