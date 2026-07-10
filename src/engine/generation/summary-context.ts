import { normalizeChatSummaryMetadata } from "../shared/text/chat-summary-entries";

export interface SummaryContextProjection {
  text: string | null;
  estimatedTokens: number;
  coversPriorHistory: boolean;
  omittedDailyCount: number;
  deduplicatedDailyCount: number;
  budgetOmittedDailyCount: number;
  omittedWeeklyCount: number;
}

interface SummaryMapEntry {
  key: string;
  timestamp: number | null;
  text: string;
}

interface ProjectionBlock {
  text: string;
  kind: "rolling" | "scene" | "daily" | "weekly" | "legacy";
  truncateFromEnd?: boolean;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") return JSON.stringify(value);
  return "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function formatSummaryEntry(label: "Day" | "Week", key: string, value: unknown): string {
  const entry = record(value);
  const summary = typeof value === "string" ? value.trim() : textValue(entry.summary);
  const keyDetails = stringArray(entry.keyDetails);
  if (!summary && keyDetails.length === 0) return "";
  const parts = [`${label} summary ${key}`];
  if (summary) parts.push(summary);
  if (keyDetails.length > 0) {
    parts.push(["Key details:", ...keyDetails.map((detail) => `- ${detail}`)].join("\n"));
  }
  return parts.join("\n");
}

function dottedDateTimestamp(key: string): number | null {
  const match = key.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? timestamp
    : null;
}

function isMondayTimestamp(timestamp: number | null): timestamp is number {
  return timestamp !== null && new Date(timestamp).getUTCDay() === 1;
}

function summaryMapEntries(label: "Day" | "Week", value: unknown): SummaryMapEntry[] {
  return Object.entries(record(value))
    .map(([key, entry]) => ({ key, timestamp: dottedDateTimestamp(key), text: formatSummaryEntry(label, key, entry) }))
    .filter((entry) => entry.text.length > 0)
    .sort((a, b) => {
      if (a.timestamp !== null && b.timestamp !== null) return b.timestamp - a.timestamp;
      if (a.timestamp !== null) return -1;
      if (b.timestamp !== null) return 1;
      return b.key.localeCompare(a.key);
    });
}

function trimSplitSurrogateBoundary(text: string): string {
  let start = 0;
  let end = text.length;
  const first = text.charCodeAt(0);
  const last = text.charCodeAt(text.length - 1);
  if (first >= 0xdc00 && first <= 0xdfff) start += 1;
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return text.slice(start, Math.max(start, end));
}

function truncateBlock(text: string, maxChars: number, fromEnd: boolean): string {
  if (maxChars <= 0) return "";
  if (text.length <= maxChars) return text;
  const sliced = fromEnd ? text.slice(-maxChars) : text.slice(0, maxChars);
  const newline = fromEnd ? sliced.indexOf("\n") : sliced.lastIndexOf("\n");
  if (newline < 0) return trimSplitSurrogateBoundary(sliced.trim());
  const atBoundary = fromEnd ? sliced.slice(newline + 1) : sliced.slice(0, newline);
  return trimSplitSurrogateBoundary((atBoundary.length >= Math.floor(maxChars / 2) ? atBoundary : sliced).trim());
}

/** Build the bounded, prompt-only projection of persisted chat summaries. */
export function buildSummaryContextProjection(input: {
  chat: Record<string, unknown>;
  budgetTokens: number;
}): SummaryContextProjection {
  const metadata = record(input.chat.metadata);
  const rollingEntries = normalizeChatSummaryMetadata(metadata).entries.filter((entry) => entry.enabled);
  const weeklyEntries = summaryMapEntries("Week", metadata.weekSummaries);
  const weeklyRanges = weeklyEntries
    .filter((entry): entry is SummaryMapEntry & { timestamp: number } => isMondayTimestamp(entry.timestamp))
    .map((entry) => ({ start: entry.timestamp, end: entry.timestamp + 6 * 86_400_000 }));
  const allDailyEntries = summaryMapEntries("Day", metadata.daySummaries);
  const dailyEntries = allDailyEntries.filter(
    (entry) =>
      entry.timestamp === null ||
      !weeklyRanges.some((range) => entry.timestamp! >= range.start && entry.timestamp! <= range.end),
  );
  const mode = textValue(input.chat.mode ?? input.chat.chatMode) || "conversation";
  const includeSceneSummary = mode !== "conversation" || metadata.crossChatAwareness !== false;
  const rollingText = rollingEntries
    .map((entry) => entry.content.trim())
    .filter(Boolean)
    .join("\n\n");
  const blocks: ProjectionBlock[] = [
    ...(rollingText
      ? [
          {
            text: rollingText,
            kind: "rolling" as const,
            truncateFromEnd: true,
          },
        ]
      : []),
    ...(includeSceneSummary && textValue(metadata.lastRoleplaySceneSummary)
      ? [
          {
            text: textValue(metadata.lastRoleplaySceneSummary),
            kind: "scene" as const,
          },
        ]
      : []),
    ...dailyEntries.map((entry) => ({
      text: entry.text,
      kind: "daily" as const,
    })),
    ...weeklyEntries.map((entry) => ({
      text: entry.text,
      kind: "weekly" as const,
    })),
    ...(textValue(metadata.conversationSummary)
      ? [
          {
            text: textValue(metadata.conversationSummary),
            kind: "legacy" as const,
          },
        ]
      : []),
  ];
  const maxChars = Math.max(0, Math.floor(input.budgetTokens)) * 4;
  const selected: Array<{ block: ProjectionBlock; text: string; complete: boolean }> = [];
  let usedChars = 0;
  for (const block of blocks) {
    const separatorLength = selected.length > 0 ? 2 : 0;
    const remainingChars = maxChars - usedChars - separatorLength;
    if (remainingChars <= 0) break;
    if (block.text.length <= remainingChars) {
      selected.push({ block, text: block.text, complete: true });
      usedChars += separatorLength + block.text.length;
      continue;
    }
    const truncated = truncateBlock(block.text, remainingChars, block.truncateFromEnd === true);
    if (truncated) {
      selected.push({ block, text: truncated, complete: false });
      usedChars += separatorLength + truncated.length;
    }
    break;
  }
  const text = selected.map((entry) => entry.text).join("\n\n") || null;
  const selectedDailyCount = selected.filter((entry) => entry.block.kind === "daily").length;
  const completeSelectedDailyCount = selected.filter((entry) => entry.block.kind === "daily" && entry.complete).length;
  const selectedWeeklyCount = selected.filter((entry) => entry.block.kind === "weekly").length;
  const deduplicatedDailyCount = allDailyEntries.length - dailyEntries.length;

  return {
    text,
    estimatedTokens: text ? Math.ceil(text.length / 4) : 0,
    // Dated summary keys and partial rolling metadata do not prove a contiguous
    // summarized range through the retained history tail. Fail closed until the
    // caller can provide both boundaries and they can be verified here.
    coversPriorHistory: false,
    omittedDailyCount: allDailyEntries.length - selectedDailyCount,
    deduplicatedDailyCount,
    budgetOmittedDailyCount: dailyEntries.length - completeSelectedDailyCount,
    omittedWeeklyCount: weeklyEntries.length - selectedWeeklyCount,
  };
}
