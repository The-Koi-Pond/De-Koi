export interface ConversationFreshnessGuideMessage {
  role?: string | null;
  content?: string | null;
}

export interface ConversationFreshnessGuideOptions {
  chatMode?: string | null;
  messages?: readonly ConversationFreshnessGuideMessage[] | null;
  latestUserInput?: string | null;
}

const RECENT_ASSISTANT_MESSAGE_LIMIT = 8;
const MIN_REPEATED_PATTERN_COUNT = 2;

const STOCK_CHECK_IN_PATTERN =
  /\b(?:how are you feeling|how does that feel|does that make sense|i hear you|i get that|that makes sense|it sounds like|what would help|i'?m here|no pressure)\b/i;

const SUMMARY_BACK_PATTERN =
  /\b(?:it sounds like|what i'?m hearing|so you'?re saying|to summarize|in other words|basically)\b/i;

const STOCK_OPENER_PATTERN = /^\s*(?:hey|hi|okay|totally|absolutely|yeah|i get that|that makes sense)\b/i;

const STOCK_CLOSER_PATTERN = /\b(?:if you want|let me know|happy to help|i'?m here|no pressure)\b/i;

const APOLOGY_PATTERN = /\b(?:sorry|i apologize|my apologies)\b/i;

const SIGNATURE_DETAIL_PATTERN =
  /\b([a-z][a-z'-]{2,}\s+(?:eyes|hair|smile|voice|scar|tattoo|coat|dress|jacket|hands|tail|wings|horns|ears))\b/gi;

const STOCK_LANGUAGE_PATTERNS = [
  STOCK_CHECK_IN_PATTERN,
  SUMMARY_BACK_PATTERN,
  STOCK_OPENER_PATTERN,
  STOCK_CLOSER_PATTERN,
  APOLOGY_PATTERN,
];

const EXPLICIT_QUESTION_REQUEST_PATTERN =
  /\b(?:ask me|ask a|ask another|question|end with a question|finish with a question)\b/i;

const EXPLICIT_SUMMARY_REQUEST_PATTERN = /\b(?:summarize|summary|recap|reflect back|repeat back|mirror back)\b/i;

function normalizedMode(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function assistantMessages(messages: readonly ConversationFreshnessGuideMessage[]): string[] {
  return messages
    .filter((message) => (message.role ?? "").toLowerCase() === "assistant")
    .map((message) => (message.content ?? "").trim())
    .filter((content) => content.length > 0)
    .slice(-RECENT_ASSISTANT_MESSAGE_LIMIT);
}

function hasStockLanguage(value: string): boolean {
  return STOCK_LANGUAGE_PATTERNS.some((pattern) => pattern.test(value));
}

function normalizeSignatureDetail(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9' -]+/g, " ").replace(/\s+/g, " ").trim();
}

function repeatedSignatureDetails(values: readonly string[], latestUserInput: string): string[] {
  const userInput = normalizeSignatureDetail(latestUserInput);
  const seenByPhrase = new Map<string, Set<number>>();
  for (const [index, value] of values.entries()) {
    for (const match of value.matchAll(SIGNATURE_DETAIL_PATTERN)) {
      const phrase = normalizeSignatureDetail(match[1] ?? "");
      if (!phrase || userInput.includes(phrase)) continue;
      const seenInMessages = seenByPhrase.get(phrase) ?? new Set<number>();
      seenInMessages.add(index);
      seenByPhrase.set(phrase, seenInMessages);
    }
  }
  return [...seenByPhrase.entries()]
    .filter(([, messageIndexes]) => messageIndexes.size >= MIN_REPEATED_PATTERN_COUNT)
    .map(([phrase]) => phrase);
}

function endsWithQuestion(value: string): boolean {
  return /\?\s*(?:["')\]]+)?\s*$/.test(value.trim());
}

function userAskedForQuestion(latestUserInput: string): boolean {
  return EXPLICIT_QUESTION_REQUEST_PATTERN.test(latestUserInput);
}

function userAskedForSummary(latestUserInput: string): boolean {
  return EXPLICIT_SUMMARY_REQUEST_PATTERN.test(latestUserInput);
}

export function buildConversationFreshnessGuide({
  chatMode,
  messages,
  latestUserInput,
}: ConversationFreshnessGuideOptions): string | null {
  if (normalizedMode(chatMode) !== "conversation") return null;

  const recentAssistantMessages = assistantMessages(messages ?? []);
  if (recentAssistantMessages.length === 0) return null;

  const userInput = (latestUserInput ?? "").trim();
  const directives: string[] = [];

  const questionEndingCount = recentAssistantMessages.filter(endsWithQuestion).length;
  if (questionEndingCount >= MIN_REPEATED_PATTERN_COUNT && !userAskedForQuestion(userInput)) {
    directives.push(
      "Recent assistant turns repeatedly ended with questions; avoid ending this reply with another question unless the user explicitly asks for one.",
    );
  }

  const stockLanguageCount = recentAssistantMessages.filter(hasStockLanguage).length;
  if (stockLanguageCount >= MIN_REPEATED_PATTERN_COUNT && !userAskedForSummary(userInput)) {
    directives.push(
      "Recent assistant turns reused conversational stock language; avoid stock reassurance, therapy-style check-ins, or summary-back phrasing and answer in a fresher, more specific voice.",
    );
  }

  const repeatedDetails = repeatedSignatureDetails(recentAssistantMessages, userInput);
  if (repeatedDetails.length > 0) {
    directives.push(
      `Recent assistant turns repeated the character detail "${repeatedDetails[0]}"; avoid reusing that exact signature detail unless it matters now.`,
    );
  }

  if (directives.length === 0) return null;

  return [
    "[Conversation freshness guide - high priority for this generation.",
    "Use this only to vary the next reply; do not mention this guide in the response.",
    "",
    ...directives.map((directive) => `- ${directive}`),
    "]",
  ].join("\n");
}
