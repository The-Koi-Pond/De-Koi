import { boolish, parseRecord, readString } from "./runtime-records";

interface ConversationFreshnessMessage {
  role?: unknown;
  content?: unknown;
  extra?: unknown;
}

interface ConversationFreshnessInput {
  messages: ConversationFreshnessMessage[];
  latestUserInput?: unknown;
  /** The user's persona name, to notice when replies keep using it as a beat. */
  userName?: string | null;
  /** Character names, never reported as a running gag. */
  characterNames?: string[];
}

const RECENT_ASSISTANT_MESSAGE_LIMIT = 8;
const OVERSIZED_TEXT_WORD_THRESHOLD = 80;
const OVERSIZED_TEXT_REPEAT_THRESHOLD = 2;

const SUPPORTIVE_CHECK_IN_PATTERN =
  /\b(i hear you|that sounds|that must be|i'?m sorry|you'?re valid|how are you feeling|do you want to talk)\b/i;
const SUMMARY_BACK_PATTERN =
  /\b(it sounds like|sounds like you|what i'?m hearing|so you'?re saying|if i understand)\b/i;
const STOCK_OPENER_CLOSER_PATTERN = /\b(totally|get that|no worries|for sure|let me know|i'?m here)\b/i;
const QUESTION_REQUEST_PATTERN = /\b(ask me|questions?|interview me|walk me through|help me unpack|keep asking)\b/i;

// Repeated-habit checks. Long chats drift into the same exit ("Bed, Dev." / "Now go to sleep."), the user's
// name as a beat in every text, and a running gag only the character keeps raising (a pet, an in-joke). Each
// note quotes what repeated, so the next reply knows exactly what to drop.
const CLOSER_WINDOW = 6;
const CLOSER_REPEAT_THRESHOLD = 3;
const MOTIF_WINDOW = 6;
const MOTIF_REPEAT_THRESHOLD = 4;
const NAME_REPEAT_THRESHOLD = 4;
const MAX_MOTIFS = 2;
const MOTIF_USER_TOPIC_TEXTS = 2;
const CARE_REPEAT_THRESHOLD = 2;
const CARE_ORDER_PATTERN =
  /^(?:go\s+(?:to\s+)?)?(?:eat|sleep|bed|rest|nap|drink\s+(?:some\s+)?water|hydrate|get\s+some\s+(?:sleep|rest|food)|go\s+home)\b/i;

const REPLY_COMMAND_PATTERN = /\[[a-z_ -]+:[^\]]*\]/gi;
const REPLY_TAG_PATTERN = /<(influence|note)>[\s\S]*?<\/\1>/gi;
const SENTENCE_BREAK_PATTERN = /(?<!\b(?:Mr|Mrs|Ms|Dr|St|Jr|Sr|vs)\.)(?<=[.!?…])\s+|\n+/;
const ORDER_LEAD_PATTERN = /^(?:(?:now|so|ok|okay|and|then|just|seriously|please|right)[,.]?\s+)*/i;
const ORDER_VERB_PATTERN =
  /^(?:go|get|eat|sleep|drink|text|send|come|bring|ice|rest|stop|take|put|do|don'?t|call|tell|hurry|bed|shower|wear|keep|hydrate|stretch|breathe|finish|start|grab|buy|try|sit|lie|log|turn|leave|save|stay|show|wake|set|pick|enjoy|be)\b/i;
const SUBJECT_PATTERN = /\b(i|i'?m|i'?ll|i'?ve|you|you'?re|we|it|it'?s|he|she|they|that|this|there)\b/i;
const WORD_PATTERN = /\p{L}[\p{L}'’-]*/gu;
const MOTIF_STOPWORDS = new Set(
  (
    "about above after again against also always another anyone anything anyway around asked back because been before " +
    "being better between both bring came cannot can't come coming could couldn't didn't does doesn't doing done don't " +
    "down during each either else enough even ever every everything fine first from gets getting give going gonna good " +
    "got gotta great have haven't having here hers he's honestly hope how i'd i'll i'm into isn't it's i've just keep " +
    "kind know last later least less let's like little long look looks lot made make many maybe mean might mine more most " +
    "much must myself need never next nice night nothing okay once only other ours over own pretty probably quite " +
    "rather really right said same saying says should shouldn't since some someone something sorry still such sure take " +
    "tell than thank thanks that that's their them then there there's these they they're thing things think this those " +
    "though thought through time today tomorrow tonight told too totally under until very wait want wanted wants wasn't " +
    "way well were weren't what what's when where which while who whole why will with without won't work would wouldn't " +
    "yeah year years yes yet you'd you'll your you're yours yourself you've actually already literally definitely " +
    "obviously exactly almost minute minutes hour hours week weeks morning evening day days"
  ).split(" "),
);

function hiddenFromFreshness(message: ConversationFreshnessMessage): boolean {
  const directHidden = boolish((message as { hiddenFromAI?: unknown }).hiddenFromAI, false);
  const extraHidden = boolish(parseRecord(message.extra).hiddenFromAI, false);
  return directHidden || extraHidden;
}

function replyText(content: string): string {
  return content.replace(REPLY_COMMAND_PATTERN, " ").replace(REPLY_TAG_PATTERN, " ").trim();
}

/** Every sentence of a reply, with reply commands removed. Each text line ends a sentence; "Mr." does not. */
function replySentences(content: string): string[] {
  return replyText(content)
    .split(SENTENCE_BREAK_PATTERN)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function closingSentence(content: string): string {
  const sentences = replySentences(content);
  return sentences[sentences.length - 1] ?? "";
}

/** A short order or send-off: "Go to sleep.", "Bed, Dev.", "Now ice the shin." */
function isOrderCloser(sentence: string): boolean {
  if (!sentence || endsWithQuestion(sentence)) return false;
  const body = sentence.replace(ORDER_LEAD_PATTERN, "");
  if (ORDER_VERB_PATTERN.test(body)) return true;
  return wordCount(body) <= 2 && !SUBJECT_PATTERN.test(body);
}

function quote(text: string, maxLength = 60): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return `"${clean.length > maxLength ? `${clean.slice(0, maxLength - 1).trimEnd()}…` : clean}"`;
}

function words(text: string): string[] {
  return (text.toLowerCase().match(WORD_PATTERN) ?? []).map((word) => word.replace(/['’]s$/, "").replace(/’/g, "'"));
}

/** Content words worth tracking: no stopwords, no names, plural folded ("shoes" and "shoe" match). */
function contentStems(text: string, excluded: Set<string>): Set<string> {
  const stems = new Set<string>();
  for (const word of words(text)) {
    if (word.length < 4 || MOTIF_STOPWORDS.has(word) || excluded.has(word)) continue;
    stems.add(word.length > 4 ? word.replace(/s$/, "") : word);
  }
  return stems;
}

function nameTokens(names: Array<string | null | undefined>): Set<string> {
  const tokens = new Set<string>();
  for (const name of names) {
    for (const word of words(readString(name))) tokens.add(word);
  }
  return tokens;
}

/** `excluded` holds names, the user's current topic and words already reported as a running gag. */
function repeatedCloserNote(replies: string[], excluded: Set<string>): string | null {
  const closers = replies.slice(-CLOSER_WINDOW).map(closingSentence).filter(Boolean);
  const orders = closers.filter(isOrderCloser);
  if (orders.length >= CLOSER_REPEAT_THRESHOLD) {
    const examples = [...new Set(orders.slice(-2).reverse())].map((closer) => quote(closer, 40));
    return `Recent texts keep ending on a short order or send-off (${examples.join(", ")}); end the next one on something else, or just stop after the point.`;
  }
  const closerCounts = new Map<string, number>();
  for (const closer of closers) {
    for (const stem of contentStems(closer, excluded)) closerCounts.set(stem, (closerCounts.get(stem) ?? 0) + 1);
  }
  const repeated = [...closerCounts.entries()].find(([, count]) => count >= CLOSER_REPEAT_THRESHOLD)?.[0];
  if (!repeated) return null;
  const examples = closers
    .filter((closer) => contentStems(closer, excluded).has(repeated))
    .slice(-2)
    .reverse()
    .map((closer) => quote(closer, 40));
  return `Recent texts keep ending on the same thing (${examples.join(", ")}); end the next one somewhere else, or just stop after the point.`;
}

/** Caretaking orders ("Go eat.", "Now sleep.", "And eat the second meal.") in reply after reply. */
function repeatedCareOrderNote(replies: string[]): string | null {
  const careOrders = replies.slice(-MOTIF_WINDOW).flatMap((reply) => {
    const order = replySentences(reply).find((sentence) =>
      CARE_ORDER_PATTERN.test(sentence.replace(ORDER_LEAD_PATTERN, "")),
    );
    return order ? [order] : [];
  });
  if (careOrders.length < CARE_REPEAT_THRESHOLD) return null;
  const examples = [...new Set(careOrders.slice(-2).reverse())].map((order) => quote(order, 40));
  return `Recent texts keep telling the user to eat, sleep or rest (${examples.join(", ")}); no caretaking order in the next one.`;
}

function userNameBeatNote(replies: string[], userName: string | null | undefined): string | null {
  const name = readString(userName).trim();
  const tokens = [...nameTokens([name])].filter((token) => token.length >= 2);
  if (tokens.length === 0) return null;
  const recent = replies.slice(-MOTIF_WINDOW);
  const uses = recent.filter((reply) => {
    const replyWords = new Set(words(replyText(reply)));
    return tokens.some((token) => replyWords.has(token));
  }).length;
  if (uses < NAME_REPEAT_THRESHOLD) return null;
  const firstName = name.split(/\s+/)[0] || name;
  return `Recent texts used ${quote(firstName)} in ${uses} of the last ${recent.length} replies; people rarely text someone's name, so leave it out of the next one.`;
}

/**
 * A word the character keeps bringing up far more than the user does: a pet, an in-joke, a prop. Words in the
 * user's latest texts are the current topic, and words the user uses about as often are a shared topic.
 */
function runningMotifs(
  replies: string[],
  userTexts: string[],
  currentTopic: Set<string>,
  excluded: Set<string>,
): string[] {
  const recent = replies.slice(-MOTIF_WINDOW);
  if (recent.length < MOTIF_REPEAT_THRESHOLD) return [];
  const userCounts = new Map<string, number>();
  for (const text of userTexts.slice(-MOTIF_WINDOW)) {
    for (const stem of contentStems(text, excluded)) userCounts.set(stem, (userCounts.get(stem) ?? 0) + 1);
  }
  const replyCounts = new Map<string, number>();
  for (const reply of recent) {
    for (const stem of contentStems(replyText(reply), excluded)) {
      replyCounts.set(stem, (replyCounts.get(stem) ?? 0) + 1);
    }
  }
  return [...replyCounts.entries()]
    .filter(([stem, count]) => count >= MOTIF_REPEAT_THRESHOLD && !currentTopic.has(stem))
    .filter(([stem, count]) => (userCounts.get(stem) ?? 0) * 2 < count)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_MOTIFS)
    .map(([stem]) => stem);
}

function runningMotifNote(motifs: string[]): string | null {
  if (motifs.length === 0) return null;
  const pronoun = motifs.length > 1 ? "them" : "it";
  return `Recent texts keep bringing back ${motifs.map((motif) => quote(motif)).join(" and ")}; leave ${pronoun} out of the next one.`;
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

function wordCount(message: string): number {
  return message.trim() ? message.trim().split(/\s+/).length : 0;
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

  if (
    recentAssistantMessages.filter((message) => wordCount(message) >= OVERSIZED_TEXT_WORD_THRESHOLD).length >=
    OVERSIZED_TEXT_REPEAT_THRESHOLD
  ) {
    lines.push(
      "Recent replies were much longer than normal texts; make the next reply substantially shorter unless the user explicitly asks for detail.",
    );
  }

  const names = nameTokens([input.userName, ...(input.characterNames ?? [])]);
  const userTexts = input.messages
    .filter((message) => !hiddenFromFreshness(message))
    .filter((message) => readString(message.role).trim() === "user")
    .map((message) => readString(message.content).trim());
  // Stored history usually already ends with the text being answered.
  const latestUserText = readString(input.latestUserInput).trim();
  if (latestUserText && userTexts[userTexts.length - 1] !== latestUserText) userTexts.push(latestUserText);
  const currentTopic = contentStems(userTexts.slice(-MOTIF_USER_TOPIC_TEXTS).join("\n"), names);
  const motifs = runningMotifs(recentAssistantMessages, userTexts, currentTopic, names);
  // The caretaking note is the more specific one; when it fires, the closer note would quote the same lines.
  const careNote = repeatedCareOrderNote(recentAssistantMessages);
  const closerNote = careNote
    ? null
    : repeatedCloserNote(recentAssistantMessages, new Set([...names, ...currentTopic, ...motifs]));
  if (careNote) lines.push(careNote);
  if (closerNote) lines.push(closerNote);
  const nameNote = userNameBeatNote(recentAssistantMessages, input.userName);
  if (nameNote) lines.push(nameNote);
  const motifNote = runningMotifNote(motifs);
  if (motifNote) lines.push(motifNote);

  return lines.length > 0 ? lines.join("\n") : null;
}
