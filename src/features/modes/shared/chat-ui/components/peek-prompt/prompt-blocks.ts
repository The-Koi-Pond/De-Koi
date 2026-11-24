import type { PeekPromptData } from "../../types";

type PromptMessage = PeekPromptData["messages"][number];

export type SectionBlock = { kind: "section"; label: string; role: string; content: string };
export type HistoryEntry = { role: string; content: string };
export type HistoryBlock = { kind: "history"; entries: HistoryEntry[] };
export type PromptBlock = SectionBlock | HistoryBlock;

// `<name>` alone on a line (at the start or after a newline), a newline, the shortest run of text, a newline and the
// matching `</name>`, then a newline or the end. The newline after the closing tag belongs to the section.
const TAGGED_SECTION = /(^|\n)<([A-Za-z_][A-Za-z0-9_-]*)>\n[\s\S]*?\n<\/\2>(?:\n|$)/gi;

// Tags are found in the original text with case-insensitive patterns, never in a lower-cased copy: lower-casing can
// change the string's length (`İ` becomes two characters) and shift every index after it.
const LAST_MESSAGE_OPEN = /<last_message>/i;
const LAST_MESSAGE_CLOSE = /<\/last_message>/i;
const LAST_MESSAGE_HEADING = /^## last message\n/i;
const CHAT_HISTORY_OPEN = /<chat_history>/i;
const CHAT_HISTORY_CLOSE = /<\/chat_history>/i;
const CHAT_HISTORY_HEADING = /^## chat history\n/i;
// Heading removal takes the literal heading and at most one newline after it, not the rest of the line.
const LAST_MESSAGE_HEADING_PREFIX = /^## last message\n?/i;
const CHAT_HISTORY_HEADING_PREFIX = /^## chat history\n?/i;

const section = (label: string, role: string, content: string): SectionBlock => ({
  kind: "section",
  label,
  role,
  content,
});

/** Split one message's text into its tagged sections and the fallback-labelled text around them. */
export function splitTaggedSections(text: string, fallbackLabel: string, role: string): SectionBlock[] {
  const blocks: SectionBlock[] = [];
  let cursor = 0;
  for (const match of text.matchAll(TAGGED_SECTION)) {
    const start = match.index + match[1]!.length;
    const before = text.slice(cursor, start).trim();
    if (before) blocks.push(section(fallbackLabel, role, before));
    blocks.push(section(match[2]!, role, text.slice(start, match.index + match[0].length).trimEnd()));
    cursor = match.index + match[0].length;
  }
  const after = text.slice(cursor).trim();
  if (after) blocks.push(section(fallbackLabel, role, after));
  return blocks.length > 0 ? blocks : [section(fallbackLabel, role, text)];
}

function isLastMessage(content: string) {
  return LAST_MESSAGE_OPEN.test(content) || LAST_MESSAGE_HEADING.test(content);
}

/** Steps 2 and 3 of a prompt message: a `<last_message>` pair, or a lone opening tag / `## Last Message` heading. */
function lastMessageBlocks(content: string, fallbackLabel: string, role: string): SectionBlock[] | null {
  const open = content.search(LAST_MESSAGE_OPEN);
  const close = content.search(LAST_MESSAGE_CLOSE);
  if (open >= 0 && close >= 0) {
    const blocks: SectionBlock[] = [];
    const before = content.slice(0, open).trim();
    if (before) blocks.push(...splitTaggedSections(before, fallbackLabel, role));
    const inner = content.slice(content.indexOf(">", open) + 1, close).trim();
    if (inner) blocks.push(section("last_message", role, inner));
    const after = content.slice(content.indexOf(">", close) + 1).trim();
    if (after) blocks.push(...splitTaggedSections(after, fallbackLabel, role));
    return blocks;
  }
  if (isLastMessage(content)) {
    return [section("last_message", role, content.replace(LAST_MESSAGE_HEADING_PREFIX, "").trim())];
  }
  return null;
}

function fallbackLabelOf(message: PromptMessage) {
  return message.displayName || message.role;
}

function promptMessageBlocks(message: PromptMessage): SectionBlock[] {
  const { role, content } = message;
  if (message.contextKind === "injection" && message.displayName === "Trackers") {
    return [section("Trackers", role, content.trim())];
  }
  const label = fallbackLabelOf(message);
  return lastMessageBlocks(content, label, role) ?? splitTaggedSections(content, label, role);
}

function blocksWithContextKinds(messages: PromptMessage[]): PromptBlock[] {
  const blocks: PromptBlock[] = [];
  let run: HistoryEntry[] | null = null;
  for (const message of messages) {
    if (message.contextKind === "history") {
      run ??= [];
      const content = message.content.trim();
      if (content) run.push({ role: message.role, content });
      continue;
    }
    if (run) {
      if (run.length > 0) blocks.push({ kind: "history", entries: run });
      run = null;
    }
    blocks.push(...promptMessageBlocks(message));
  }
  if (run && run.length > 0) blocks.push({ kind: "history", entries: run });
  return blocks;
}

function isHistoryStart(content: string) {
  return CHAT_HISTORY_OPEN.test(content) || CHAT_HISTORY_HEADING.test(content);
}

function cleanHistoryEntry(content: string) {
  return content
    .replace(/^<chat_history>\n?/i, "")
    .replace(/\n?<\/chat_history>\s*$/i, "")
    .replace(CHAT_HISTORY_HEADING_PREFIX, "")
    .trim();
}

function findLastIndex<T>(list: T[], test: (item: T) => boolean) {
  for (let i = list.length - 1; i >= 0; i--) if (test(list[i]!)) return i;
  return -1;
}

/**
 * The last message of the history: the last `</chat_history>`; else the message before the last message when the
 * last message comes after the start (that can be the start itself); else the run of user/assistant messages right
 * after the start.
 */
function historyEnd(messages: PromptMessage[], start: number, lastMessage: number) {
  const end = findLastIndex(messages, (message) => CHAT_HISTORY_CLOSE.test(message.content));
  if (end >= 0) return end;
  if (lastMessage > start) return lastMessage - 1;
  let last = start;
  for (let i = start + 1; i < messages.length; i++) {
    const role = messages[i]!.role;
    if (role !== "user" && role !== "assistant") break;
    last = i;
  }
  return last;
}

/** Older snapshots: find the chat history and the last message across the messages. */
function blocksWithoutContextKinds(messages: PromptMessage[]): PromptBlock[] {
  const start = messages.findIndex((message) => isHistoryStart(message.content));
  const lastMessage = findLastIndex(messages, (message) => isLastMessage(message.content));
  const end = start >= 0 ? historyEnd(messages, start, lastMessage) : -1;
  const inHistory = (i: number) => start >= 0 && end >= start && i >= start && i <= end;

  const blocks: PromptBlock[] = [];
  messages.forEach((message, i) => {
    if (inHistory(i)) {
      if (i !== start) return;
      const entries = messages
        .slice(start, end + 1)
        .map((entry) => ({ role: entry.role, content: cleanHistoryEntry(entry.content) }))
        .filter((entry) => entry.content);
      if (entries.length > 0) blocks.push({ kind: "history", entries });
      return;
    }
    if (i === lastMessage) {
      blocks.push(...(lastMessageBlocks(message.content, message.role, message.role) ?? []));
      return;
    }
    blocks.push(...promptMessageBlocks(message));
  });
  return blocks;
}

/** The messages the viewer shows: preview messages win whenever they have a length (as the old viewer read them). */
export function shownMessages(data: Pick<PeekPromptData, "messages" | "previewMessages">): PromptMessage[] {
  return data.previewMessages?.length ? data.previewMessages : data.messages;
}

export function buildPromptBlocks(messages: PromptMessage[]): PromptBlock[] {
  return messages.some((message) => message.contextKind)
    ? blocksWithContextKinds(messages)
    : blocksWithoutContextKinds(messages);
}
