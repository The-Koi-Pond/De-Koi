// ──────────────────────────────────────────────
// Roleplay: a model reads the latest replies and names the habits a reader would notice
// ──────────────────────────────────────────────
import { z } from "zod";

import type { LlmGateway, LlmMessage } from "../capabilities/llm";
import type { StorageGateway } from "../capabilities/storage";
import { boolish, parseRecord, readString, type JsonRecord } from "./runtime-records";
import { generateStructured } from "./structured-generation";

const ROLEPLAY_HABIT_SCAN_VERSION = 1;
/** How many of the latest assistant replies one scan reads. */
const ROLEPLAY_HABIT_SCAN_REPLIES = 8;
/** A new scan is due after this many new assistant replies. */
const ROLEPLAY_HABIT_SCAN_EVERY = 3;
/** Replies needed before the first scan; a habit has to show up in three of them. */
const FIRST_SCAN_REPLIES = 4;
const MAX_HABITS = 5;
const MAX_REPLY_CHARS = 2_400;

const scanSchema = z.object({
  habits: z
    .array(
      z.object({
        habit: z.string().trim().min(3).max(160),
        replies: z.array(z.number().int().min(1)).max(ROLEPLAY_HABIT_SCAN_REPLIES),
        quotes: z.array(z.string().trim().min(3).max(240)).min(1).max(3),
      }),
    )
    .max(8),
});

const SCHEMA_DESCRIPTION = `{
  "habits": [
    { "habit": "short plain name of the habit", "replies": [1, 4, 7], "quotes": ["exact words from one reply", "exact words from another"] }
  ]
}`;

export interface RoleplayHabitScanEntry {
  habit: string;
  /** How many of the scanned replies show it. */
  replies: number;
  /** Exact excerpts, each found in the scanned replies. */
  quotes: string[];
}

export interface RoleplayHabitScan {
  version: typeof ROLEPLAY_HABIT_SCAN_VERSION;
  /** The newest assistant message the scan read. */
  throughMessageId: string;
  scannedReplies: number;
  habits: RoleplayHabitScanEntry[];
  scannedAt: string;
}

interface VisibleReply {
  id: string;
  content: string;
}

function hidden(message: JsonRecord): boolean {
  return boolish(message.hiddenFromAI, false) || boolish(parseRecord(message.extra).hiddenFromAI, false);
}

function visibleAssistantReplies(messages: readonly JsonRecord[]): VisibleReply[] {
  return messages
    .filter((message) => readString(message.role).trim() === "assistant" && !hidden(message))
    .map((message) => ({ id: readString(message.id).trim(), content: readString(message.content).trim() }))
    .filter((reply) => reply.content.length > 0);
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

export function readRoleplayHabitScan(metadata: unknown): RoleplayHabitScan | null {
  const record = parseRecord(parseRecord(metadata).roleplayHabitScan);
  if (record.version !== ROLEPLAY_HABIT_SCAN_VERSION || !Array.isArray(record.habits)) return null;
  const habits = record.habits
    .map((entry) => parseRecord(entry))
    .map((entry) => ({
      habit: readString(entry.habit).trim(),
      replies: typeof entry.replies === "number" ? entry.replies : 0,
      quotes: Array.isArray(entry.quotes) ? entry.quotes.map((quote) => readString(quote).trim()).filter(Boolean) : [],
    }))
    .filter((entry) => entry.habit && entry.quotes.length > 0);
  return {
    version: ROLEPLAY_HABIT_SCAN_VERSION,
    throughMessageId: readString(record.throughMessageId).trim(),
    scannedReplies: typeof record.scannedReplies === "number" ? record.scannedReplies : 0,
    habits,
    scannedAt: readString(record.scannedAt).trim(),
  };
}

/**
 * True when enough new replies have landed since the reply the last scan ended on (or none ran yet, or that reply is
 * gone) to be worth another look. `messages` only needs the latest page of the chat, oldest first.
 */
export function roleplayHabitScanDue(messages: readonly JsonRecord[], scan: RoleplayHabitScan | null): boolean {
  const visible = visibleAssistantReplies(messages);
  if (visible.length < FIRST_SCAN_REPLIES) return false;
  if (!scan) return true;
  const through = visible.findIndex((reply) => reply.id === scan.throughMessageId);
  return through < 0 || visible.length - 1 - through >= ROLEPLAY_HABIT_SCAN_EVERY;
}

const runningScans = new WeakMap<object, Set<string>>();
/** How much of the chat a scheduled scan loads: enough for the scanned replies plus the user turns between them. */
const SCHEDULED_SCAN_PAGE = ROLEPLAY_HABIT_SCAN_REPLIES * 3;

export interface ScheduleRoleplayHabitScanInput {
  storage: Pick<StorageGateway, "get" | "listChatMessages" | "patchChatMetadata">;
  llm: LlmGateway;
  chatId: string;
  connectionId?: string | null;
}

/**
 * After a reply is saved: if a scan is due, run it in the background and store it on the chat for the next turns.
 * One scan per chat at a time. Nothing waits on it; a lost or failed scan just runs again after the next reply,
 * because it is still due then.
 */
export function scheduleRoleplayHabitScan(input: ScheduleRoleplayHabitScanInput): void {
  const running = runningScans.get(input.storage) ?? new Set<string>();
  runningScans.set(input.storage, running);
  if (!input.chatId || running.has(input.chatId)) return;
  running.add(input.chatId);
  setTimeout(() => {
    void scanIfDue(input)
      .catch((error: unknown) =>
        console.warn("[roleplay-habit-scan] scan failed; it runs again after the next reply", error),
      )
      .finally(() => running.delete(input.chatId));
  }, 0);
}

async function scanIfDue(input: ScheduleRoleplayHabitScanInput): Promise<void> {
  const chat = await input.storage.get<JsonRecord>("chats", input.chatId);
  if (!chat) return;
  const page = await input.storage.listChatMessages<JsonRecord>(input.chatId, {
    orderBy: "createdAt",
    descending: true,
    limit: SCHEDULED_SCAN_PAGE,
    fields: ["id", "role", "content", "extra", "hiddenFromAI", "createdAt"],
  });
  const messages = [...page].reverse();
  if (!roleplayHabitScanDue(messages, readRoleplayHabitScan(chat.metadata))) return;
  const scan = await runRoleplayHabitScan({ llm: input.llm }, { messages, connectionId: input.connectionId });
  if (scan) await input.storage.patchChatMetadata(input.chatId, { roleplayHabitScan: scan });
}

function roleplayHabitScanMessages(replies: readonly string[]): LlmMessage[] {
  return [
    {
      role: "system",
      content: [
        "You read the latest replies of an interactive story, numbered from oldest to newest, and find the habits a reader starts to notice.",
        'A habit is the same move coming back across replies: an opener, a gesture or body beat, a prop handled as a fidget, a background noise used as a pause, a sentence shape ("He doesn\'t X. He Y."), a closing move, a pet name, or a phrase.',
        "Count only habits that show up in 3 or more different replies. Skip the people, places and plot objects the story is about unless the writing keeps using them as filler.",
        `List at most ${MAX_HABITS}, most noticeable first. For each, give a short plain name, the numbers of the replies it shows up in, and 1 to 3 short quotes copied exactly from different replies.`,
        "Return an empty list when nothing recurs. Respond with only one JSON object in this exact shape:",
        SCHEMA_DESCRIPTION,
      ].join("\n"),
    },
    {
      role: "user",
      content: replies.map((reply, index) => `Reply ${index + 1}:\n${reply.slice(0, MAX_REPLY_CHARS)}`).join("\n\n"),
    },
  ];
}

/** Keeps habits the replies back up: quotes must appear in the scanned text and the habit in 3+ replies. */
export function groundRoleplayHabitScan(
  habits: z.infer<typeof scanSchema>["habits"],
  replies: readonly string[],
): RoleplayHabitScanEntry[] {
  const texts = replies.map(comparable);
  const grounded: RoleplayHabitScanEntry[] = [];
  for (const entry of habits) {
    const quotes = entry.quotes.filter((quote) => texts.some((text) => text.includes(comparable(quote))));
    const replyNumbers = new Set(entry.replies.filter((number) => number >= 1 && number <= replies.length));
    if (quotes.length === 0 || replyNumbers.size < 3) continue;
    grounded.push({ habit: entry.habit, replies: replyNumbers.size, quotes });
    if (grounded.length >= MAX_HABITS) break;
  }
  return grounded;
}

export async function runRoleplayHabitScan(
  capabilities: { llm: LlmGateway },
  input: { messages: readonly JsonRecord[]; connectionId?: string | null; now?: () => Date },
  signal?: AbortSignal,
): Promise<RoleplayHabitScan | null> {
  const visible = visibleAssistantReplies(input.messages);
  const scanned = visible.slice(-ROLEPLAY_HABIT_SCAN_REPLIES);
  if (visible.length < FIRST_SCAN_REPLIES) return null;
  const replies = scanned.map((reply) => reply.content);
  const result = await generateStructured(
    capabilities,
    {
      taskName: "roleplay_habit_scan",
      connectionId: input.connectionId,
      messages: roleplayHabitScanMessages(replies),
      parameters: { temperature: 0, maxTokens: 900, reasoningEffort: "low" },
      schema: scanSchema,
      schemaDescription: SCHEMA_DESCRIPTION,
      maxRepairAttempts: 1,
      failureMessage: "The roleplay habit scan did not return valid JSON.",
    },
    signal,
  );
  if (!result.ok) return null;
  return {
    version: ROLEPLAY_HABIT_SCAN_VERSION,
    throughMessageId: scanned.at(-1)?.id ?? "",
    scannedReplies: scanned.length,
    habits: groundRoleplayHabitScan(result.data.habits, replies),
    scannedAt: (input.now?.() ?? new Date()).toISOString(),
  };
}

function clip(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= 90 ? compact : `${compact.slice(0, 89).trimEnd()}…`;
}

/** Steering lines for the next reply, one per habit. */
export function roleplayHabitScanGuidance(scan: RoleplayHabitScan | null): string[] {
  if (!scan) return [];
  return scan.habits.map(
    (entry) =>
      `- ${entry.habit} (in ${entry.replies} of the last ${scan.scannedReplies} replies, e.g. ${entry.quotes
        .slice(0, 2)
        .map((quote) => `"${clip(quote)}"`)
        .join("; ")}). Leave it out of this reply, and don't swap in a new recurring move.`,
  );
}
