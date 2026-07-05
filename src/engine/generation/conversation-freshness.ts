import { boolish, parseRecord, readString } from "./runtime-records";

interface ConversationFreshnessMessage {
  role?: unknown;
  content?: unknown;
  extra?: unknown;
}

interface ConversationFreshnessInput {
  messages: ConversationFreshnessMessage[];
  latestUserInput?: unknown;
}

const RECENT_ASSISTANT_MESSAGE_LIMIT = 8;

const SUPPORTIVE_CHECK_IN_PATTERN =
  /\b(i hear you|that sounds|that must be|i'?m sorry|you'?re valid|how are you feeling|do you want to talk)\b/i;
const SUMMARY_BACK_PATTERN = /\b(it sounds like|sounds like you|what i'?m hearing|so you'?re saying|if i understand)\b/i;
const STOCK_OPENER_CLOSER_PATTERN = /\b(totally|get that|no worries|for sure|let me know|i'?m here)\b/i;
const QUESTION_REQUEST_PATTERN = /\b(ask me|questions?|interview me|walk me through|help me unpack|keep asking)\b/i;

function hiddenFromFreshness(message: ConversationFreshnessMessage): boolean {
  const directHidden = boolish((message as { hiddenFromAI?: unknown }).hiddenFromAI, false);
  const extraHidden = boolish(parseRecord(message.extra).hiddenFromAI, false);
  return directHidden || extraHidden;
}

function assistantMessages(messages: ConversationFreshnessMessage[]): string[] {
  return messages
    .filter((message) => readString(message.role).trim() === "assistant")
    .filter((message) => !hiddenFromFreshness(message))
    .map((message) => readString(message.content).trim())
    .filter(Boolean)
    .slice(-RECENT_ASSISTANT_MESSAGE_LIMIT);
}

function countMatches(messages: string[], pattern: RegExp): number {
  return messages.reduce((count, message) => count + (pattern.test(message) ? 1 : 0), 0);
}

function endsWithQuestion(message: string): boolean {
  return /\?\s*(?:[)\]"'’”.!]*)?$/.test(message.trim());
}

function latestUserRequestsQuestions(input: unknown): boolean {
  return QUESTION_REQUEST_PATTERN.test(readString(input).toLowerCase());
}

export function buildConversationFreshnessGuidance(input: ConversationFreshnessInput): string | null {
  const recentAssistantMessages = assistantMessages(input.messages);
  if (recentAssistantMessages.length < 2) return null;

  const lines: string[] = [];
  const questionEndings = recentAssistantMessages.filter(endsWithQuestion).length;
  if (questionEndings >= 2 && !latestUserRequestsQuestions(input.latestUserInput)) {
    lines.push(
      "Recent replies leaned on question endings; do not end with another question unless the character genuinely needs an answer.",
    );
  }

  if (countMatches(recentAssistantMessages, SUPPORTIVE_CHECK_IN_PATTERN) >= 2) {
    lines.push(
      "Recent replies used supportive check-in phrasing; answer more concretely in the character's own voice instead of repeating therapy-style validation.",
    );
  }

  if (countMatches(recentAssistantMessages, SUMMARY_BACK_PATTERN) >= 2) {
    lines.push("Recent replies summarized the user back to them; respond to the next beat instead of restating it.");
  }

  if (countMatches(recentAssistantMessages, STOCK_OPENER_CLOSER_PATTERN) >= 3) {
    lines.push("Recent replies reused stock openers or closers; vary the entry and exit shape of the next text.");
  }

  return lines.length > 0 ? lines.join("\n") : null;
}