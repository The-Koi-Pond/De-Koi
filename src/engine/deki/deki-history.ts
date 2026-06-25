import type { LlmGateway } from "../capabilities/llm";
import { extractLeadingThinkingBlocks } from "../generation-core/llm/inline-thinking";
import type { DekiMessage } from "./deki-entry";

export const DEKI_CHAT_ID = "deki";
const DEKI_COMPACTION_THRESHOLD = 0.8;
const DEFAULT_MAX_CONTEXT = 128_000;
const COMPACTION_TAIL_CONTEXT_SHARE = 0.25;
const COMPACTION_TAIL_MIN_MESSAGES = 16;
const COMPACTION_TAIL_MAX_MESSAGES = 48;
const COMPACTION_RESPONSE_TOKENS = 2048;

export type DekiCompactionState = {
  compactedSummary: string | null;
  compactedAt: string | null;
  compactedThroughMessageId: string | null;
};

export type DekiCompactionConnection = {
  id?: string | null;
  model?: string | null;
  maxContext?: unknown;
};

export type DekiSession = {
  id: string;
  title: string;
  messages: DekiMessage[];
  compaction: DekiCompactionState;
  createdAt: string;
  updatedAt: string;
};

export type DekiSessionsState = {
  activeSessionId: string;
  sessions: DekiSession[];
};

export const EMPTY_DEKI_COMPACTION: DekiCompactionState = {
  compactedSummary: null,
  compactedAt: null,
  compactedThroughMessageId: null,
};

export function isDekiResetCommand(value: string): boolean {
  return value.trim().toLowerCase() === "/reset";
}

export function createDekiSession({
  id,
  title,
  messages = [],
  compaction = EMPTY_DEKI_COMPACTION,
  now = new Date().toISOString(),
}: {
  id: string;
  title?: string | null;
  messages?: DekiMessage[];
  compaction?: DekiCompactionState;
  now?: string;
}): DekiSession {
  const trimmedTitle = typeof title === "string" ? title.trim() : "";
  return {
    id,
    title: trimmedTitle || "New Deki Chat",
    messages,
    compaction,
    createdAt: now,
    updatedAt: messages.at(-1)?.createdAt ?? now,
  };
}

export function getActiveDekiSession(state: DekiSessionsState): DekiSession {
  return state.sessions.find((session) => session.id === state.activeSessionId) ?? state.sessions[0]!;
}

function estimateDekiTextTokens(text: string): number {
  const trimmed = text.trim();
  return trimmed ? Math.max(1, Math.ceil(trimmed.length / 4)) : 0;
}

function messageTokens(message: DekiMessage): number {
  return estimateDekiTextTokens(message.content) + 8;
}

function readPositiveInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

function dekiConnectionMaxContext(connection: DekiCompactionConnection | null | undefined): number {
  return readPositiveInteger(connection?.maxContext) ?? DEFAULT_MAX_CONTEXT;
}

function compactedThroughIndex(messages: DekiMessage[], compaction: DekiCompactionState): number {
  const id = compaction.compactedThroughMessageId;
  if (!id) return -1;
  return messages.findIndex((message) => message.id === id);
}

export function dekiContextMessages(messages: DekiMessage[], compaction: DekiCompactionState): DekiMessage[] {
  const index = compactedThroughIndex(messages, compaction);
  return index >= 0 ? messages.slice(index + 1) : messages;
}

function estimateDekiContextTokens(messages: DekiMessage[], compaction: DekiCompactionState): number {
  const summaryTokens = estimateDekiTextTokens(compaction.compactedSummary ?? "");
  return (
    summaryTokens +
    dekiContextMessages(messages, compaction).reduce((total, message) => total + messageTokens(message), 0) +
    512
  );
}

function shouldCompactDekiHistory(
  messages: DekiMessage[],
  compaction: DekiCompactionState,
  connection: DekiCompactionConnection | null | undefined,
): boolean {
  const maxContext = dekiConnectionMaxContext(connection);
  const threshold = Math.floor(maxContext * DEKI_COMPACTION_THRESHOLD);
  if (estimateDekiContextTokens(messages, compaction) < threshold) return false;
  return messages.length - compactedThroughIndex(messages, compaction) > COMPACTION_TAIL_MIN_MESSAGES + 2;
}

function selectRecentTail(messages: DekiMessage[], maxContext: number): DekiMessage[] {
  const tokenBudget = Math.max(1024, Math.floor(maxContext * COMPACTION_TAIL_CONTEXT_SHARE));
  const tail: DekiMessage[] = [];
  let tokens = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    const nextTokens = tokens + messageTokens(message);
    if (
      tail.length >= COMPACTION_TAIL_MIN_MESSAGES &&
      (nextTokens > tokenBudget || tail.length >= COMPACTION_TAIL_MAX_MESSAGES)
    ) {
      break;
    }
    tail.unshift(message);
    tokens = nextTokens;
  }

  return tail;
}

function fitCompactionTranscript(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const headChars = Math.floor(maxChars * 0.35);
  const tailChars = Math.floor(maxChars * 0.6);
  return `${value.slice(0, headChars)}\n\n[Transcript middle omitted during compaction input trimming.]\n\n${value.slice(-tailChars)}`;
}

function formatCompactionTranscript(messages: DekiMessage[], maxContext: number): string {
  const transcript = messages
    .map((message) => `${message.role === "assistant" ? "Deki-senpai" : "User"}: ${message.content.trim()}`)
    .filter((line) => line.trim().length > 0)
    .join("\n\n");
  const maxChars = Math.max(12_000, Math.min(96_000, Math.floor(maxContext * 2.4)));
  return fitCompactionTranscript(transcript, maxChars);
}

function normalizeDekiCompactionSummary(value: string): string {
  return extractLeadingThinkingBlocks(value)
    .cleanText.trim()
    .replace(/^```(?:markdown|md|text)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

export async function compactDekiHistory({
  messages,
  compaction,
  connection,
  llm,
}: {
  messages: DekiMessage[];
  compaction: DekiCompactionState;
  connection: DekiCompactionConnection;
  llm: LlmGateway;
}): Promise<{ compacted: boolean; compaction: DekiCompactionState }> {
  if (!shouldCompactDekiHistory(messages, compaction, connection)) {
    return { compacted: false, compaction };
  }

  const maxContext = dekiConnectionMaxContext(connection);
  const recentTail = selectRecentTail(messages, maxContext);
  const tailStartId = recentTail[0]?.id;
  const tailStartIndex = tailStartId ? messages.findIndex((message) => message.id === tailStartId) : messages.length;
  const firstUncompactedIndex = compactedThroughIndex(messages, compaction) + 1;
  const messagesToCompact = messages.slice(firstUncompactedIndex, Math.max(firstUncompactedIndex, tailStartIndex));
  const compactedThroughMessageId = messagesToCompact.at(-1)?.id ?? compaction.compactedThroughMessageId;

  if (!messagesToCompact.length || !compactedThroughMessageId) {
    return { compacted: false, compaction };
  }

  const previousSummary = compaction.compactedSummary?.trim()
    ? `Existing compact summary:\n${compaction.compactedSummary.trim()}`
    : "Existing compact summary: none";
  const transcript = formatCompactionTranscript(messagesToCompact, maxContext);
  const summary = normalizeDekiCompactionSummary(
    await llm.complete({
      connectionId: connection.id ?? null,
      model: connection.model ?? undefined,
      messages: [
        {
          role: "system",
          content: [
            "You compact Deki-senpai's conversation history for future turns.",
            "Preserve durable user preferences, implementation decisions, unresolved tasks, important discoveries, and the latest project state.",
            "Discard greetings, filler, repeated status updates, and details superseded by later messages.",
            "Write concise but specific notes that Deki-senpai can rely on as memory. Do not answer the user.",
          ].join("\n"),
        },
        {
          role: "user",
          content: `${previousSummary}\n\nTranscript to merge into the compact summary:\n${transcript}`,
        },
      ],
      parameters: {
        temperature: 0.2,
        maxTokens: COMPACTION_RESPONSE_TOKENS,
      },
    }),
  );

  return {
    compacted: true,
    compaction: {
      compactedSummary: summary,
      compactedAt: new Date().toISOString(),
      compactedThroughMessageId,
    },
  };
}
