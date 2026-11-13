// Conversation steering: what the user's own words say the next reply must do.
//
// Three things showed up in real chats. When someone said a reply missed ("that's not horror", "too easy",
// "that's just kinky"), the next reply tried a small variation of the same idea, and after a few rounds teased
// them for being picky. What they had asked for ("make it actually scary") lost to the character's usual mood.
// When they were unsure or tired ("I dunno, whatever is scary?"), the character handed the choice back.
// This note quotes their words so the next reply follows them. It reads only the user's messages.
import { boolish, parseRecord, readString } from "./runtime-records";

interface SteeringMessage {
  role?: unknown;
  content?: unknown;
  extra?: unknown;
}

interface ConversationSteeringInput {
  messages: SteeringMessage[];
  latestUserInput?: unknown;
  userName?: string | null;
}

/** User messages looked at for redirects and the current ask. */
const STEERING_WINDOW = 6;
const MAX_QUOTED_REDIRECTS = 3;

// Words people use for what a reply should have been. Kept to tone, genre and "it": "that's not fair" is banter.
const TARGET =
  "horror|horrific|horrifying|scary|creepy|spooky|frightening|dark|disturbing|unsettling|gory|funny|romantic|" +
  "sexy|hot|spicy|kinky|mean|cruel|cute|sweet|cozy|cosy|sad|angsty|intense|tense|dramatic|wholesome|gentle|" +
  "intimate|serious|real|it|enough|right|working|landing|helping|the\\s+point|what\\s+i\\s+(?:asked|meant|wanted|said)";
const MISS_PATTERNS: readonly RegExp[] = [
  // "that's not horror", "this isn't scary", "it's not really working"
  new RegExp(
    `\\b(?:that|this|it)(?:['’]?s|\\s+is|\\s+was)?\\s+(?:not|n['’]?t)\\s+(?:very\\s+|really\\s+|even\\s+|actually\\s+|quite\\s+|scary\\s+)?(?:${TARGET})\\b`,
    "i",
  ),
  new RegExp(
    `\\b(?:that|this|it)\\s+(?:isn['’]?t|wasn['’]?t)\\s+(?:very\\s+|really\\s+|even\\s+)?(?:${TARGET})\\b`,
    "i",
  ),
  // "that's just kinky", "this is just foreplay", "that's just not intimate"
  /\b(?:that|this|it)(?:['’]s|\s+is)\s+just\s+(?:\w+\s+)?(?:kinky|boring|foreplay|sex|smut|fluff|romance|romantic|cozy|cosy|cute|sweet|vanilla|tame|flirting|banter|not)\b/i,
  /\b(?:that|this|it)(?:['’]s|\s+is)\s+(?:so\s+|kinda\s+|pretty\s+)?boring\b/i,
  /\btoo\s+(?:easy|soft|tame|nice|sweet|safe|vanilla|cute|cozy|cosy|gentle|romantic)\b/i,
  /\b(?:try\s+again|missed\s+the\s+(?:point|mark)|not\s+what\s+i\s+(?:asked|meant|wanted|said)|that['’]?s\s+not\s+it|didn['’]?t\s+land|(?:isn['’]?t|not)\s+landing)\b/i,
  /\bi\s+don['’]?t\s+feel\s+(?:it|anything|scared|turned\s+on|(?:\w+\s+)?or\s+\w+)\b/i,
];

// What they asked the scene or story to be.
const ASK_PATTERNS: readonly RegExp[] = [
  // "make your kidnapping scenario actually scary", "make it more romantic"
  /\bmake\s+(?:it|this|that|(?:your|the)\s+[\w\s]{1,30}?)\s+(?:actually|more|really|properly|genuinely|way\s+more)\s+\w+/i,
  /\bi\s+(?:want|need)\s+(?:it|this)\s+to\s+be\s+(?:more\s+)?\w+/i,
  /\bi['’]?m\s+in\s+the\s+mood\s+for\s+\w+/i,
  // "what I was considering was... Horror?"
  /\bwhat\s+i\s+(?:was\s+considering|had\s+in\s+mind|want(?:ed)?)\s+(?:was|is)[\s.…]+\w+/i,
  /\bi\s+(?:want|wanna|would\s+like)\s+(?:a|an|some|something)\s+(?:\w+\s+){0,3}(?:story|scene|fantasy|scenario|horror|roleplay|session)\b/i,
];

// "I don't know" only as an answer ("I dunno, whatever", "idk what"), not "I don't know why he's like that".
const UNSURE_PATTERN =
  /\b(?:i\s+(?:dunno|don['’]?t\s+know|do\s+not\s+know|have\s+no\s+idea)(?=\s*(?:[,.!?…~]|$|what\b|which\b|how\b|lol\b|tbh\b))|i\s+can['’]?t\s+(?:figure\s+out|decide|think\s+of)|idk|not\s+sure\s+what|whatever\s+(?:you\s+(?:want|think|like)|is\s+\w+)|(?:you|u)\s+(?:pick|choose|decide)|up\s+to\s+you|surprise\s+me|(?:too\s+)?(?:tired|drained|exhausted|fried)\s+to\s+(?:think|decide|choose)|no\s+energy)\b/i;

function hidden(message: SteeringMessage): boolean {
  return (
    boolish((message as { hiddenFromAI?: unknown }).hiddenFromAI, false) ||
    boolish(parseRecord(message.extra).hiddenFromAI, false)
  );
}

function quote(text: string, maxLength = 90): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return `"${clean.length > maxLength ? `${clean.slice(0, maxLength - 1).trimEnd()}…` : clean}"`;
}

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/** Whether a message says the last reply missed what they wanted. */
export function isReplyRedirect(text: string): boolean {
  return matchesAny(text, MISS_PATTERNS);
}

/** Whether a message asks for a tone, genre or kind of scene. */
export function isSceneAsk(text: string): boolean {
  return matchesAny(text, ASK_PATTERNS);
}

/** Whether a message says they're unsure or low on energy. */
export function isUnsureMessage(text: string): boolean {
  return UNSURE_PATTERN.test(text);
}

/** The user's recent texts, oldest first, ending with the one being answered. */
function recentUserTexts(input: ConversationSteeringInput): string[] {
  const texts = input.messages
    .filter((message) => readString(message.role) === "user" && !hidden(message))
    .map((message) => readString(message.content).trim())
    .filter(Boolean);
  const latest = readString(input.latestUserInput).trim();
  if (latest && texts[texts.length - 1] !== latest) texts.push(latest);
  return texts.slice(-STEERING_WINDOW);
}

/** The steering lines for the next reply, or null when the user's words call for none. */
export function buildConversationSteeringGuidance(input: ConversationSteeringInput): string | null {
  const texts = recentUserTexts(input);
  const latest = texts[texts.length - 1];
  if (!latest) return null;
  const user = input.userName?.trim() || "The user";
  const lines: string[] = [];

  if (isReplyRedirect(latest)) {
    lines.push(
      `${user}'s last message says your previous reply missed: ${quote(latest)}. Don't offer a small variation of the same idea; take a clearly different approach to what they asked for. Stay in character, and don't tease them for the feedback, call them picky or give up on it.`,
    );
    const redirects = texts.filter(isReplyRedirect);
    if (redirects.length >= 2) {
      lines.push(
        `They have now redirected ${redirects.length} times (${redirects
          .slice(-MAX_QUOTED_REDIRECTS)
          .map((text) => quote(text, 50))
          .join(", ")}). Whatever you keep reaching for isn't landing; change the approach itself, not the details.`,
      );
    }
  }

  const ask = [...texts].reverse().find(isSceneAsk);
  if (ask && (ask === latest || isReplyRedirect(latest))) {
    lines.push(
      `What ${user} asked for, in their words: ${quote(ask)}. Deliver that; it outranks the character's usual mood and habits until they change it.`,
    );
  }

  if (isUnsureMessage(latest)) {
    lines.push(
      `${user} sounds unsure or low on energy right now (${quote(latest, 60)}). Lead: choose one concrete thing yourself and go with it. Don't hand the choice back, offer a this-or-that, or ask them to describe what they want.`,
    );
  }

  return lines.length ? lines.join("\n") : null;
}
