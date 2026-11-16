// Reply steering: what the user's own words say the next reply must do, in Conversation and Roleplay.
//
// Three things showed up in real chats. When someone said a reply missed ("that's not horror", "too easy",
// "that's just kinky"), the next reply tried a small variation of the same idea, and after a few rounds teased
// them for being picky. What they had asked for ("make it actually scary") lost to the character's usual mood.
// When they were unsure or tired ("I dunno, whatever is scary?"), the character handed the choice back.
// Roleplay had the same misses, voiced in character ("Mnnnn, that isn't what I meaaaan~"), and the reply after
// one told the user to "use your words" and kept pushing the scene the way it was going.
// This note quotes their words so the next reply follows them. It reads only the user's messages.
import { boolish, parseRecord, readString } from "./runtime-records";

interface SteeringMessage {
  role?: unknown;
  content?: unknown;
  extra?: unknown;
}

export type ReplySteeringMode = "conversation" | "roleplay";

interface ReplySteeringInput {
  messages: SteeringMessage[];
  latestUserInput?: unknown;
  userName?: string | null;
  /** Conversation unless given. Roleplay words the note for a scene and its in-character lines. */
  mode?: ReplySteeringMode;
}

/** User messages looked at for redirects and the current ask. */
const STEERING_WINDOW = 6;
const MAX_QUOTED_REDIRECTS = 3;

// Words people use for what a reply should have been. Kept to tone, genre and "it": "that's not fair" is banter.
const TARGET =
  "horror|horrific|horrifying|scary|creepy|spooky|frightening|dark|disturbing|unsettling|gory|funny|romantic|" +
  "sexy|hot|spicy|kinky|mean|cruel|cute|sweet|cozy|cosy|sad|angsty|intense|tense|dramatic|wholesome|gentle|" +
  "intimate|serious|real|it|enough|right|working|landing|helping|the\\s+point|what\\s+i\\s+(?:asked|meant|mean|wanted|said)";
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
  // "You have it so backwards", "you've got it all backwards"
  /\byou(?:['’]ve|\s+have)?\s+(?:got\s+)?(?:it|this|that)\s+(?:all\s+|so\s+|completely\s+|totally\s+)?backwards\b/i,
  // "You two are completely reversing this"
  /\byou(?:\s+(?:two|both|guys|all))?(?:['’]re|\s+are)\s+(?:completely\s+|totally\s+|kinda\s+|so\s+)?(?:reversing|flipping)\s+(?:this|it|that|what\s+i)\b/i,
];

// What they asked the scene or story to be.
const ASK_PATTERNS: readonly RegExp[] = [
  // "make your kidnapping scenario actually scary", "make it more romantic", "make him more possessive"
  /\bmake\s+(?:it|this|that|him|her|them|(?:your|the)\s+[\w\s]{1,30}?)\s+(?:actually|more|really|properly|genuinely|way\s+more)\s+\w+/i,
  /\bi['’]?m\s+in\s+the\s+mood\s+for\s+\w+/i,
  // "what I was considering was... Horror?"
  /\bwhat\s+i\s+(?:was\s+considering|had\s+in\s+mind|want(?:ed)?)\s+(?:was|is)[\s.…]+\w+/i,
  /\bi\s+(?:want|wanna|would\s+like)\s+(?:a|an|some|something)\s+(?:\w+\s+){0,3}(?:story|scene|fantasy|scenario|horror|roleplay|session)\b/i,
  // "Let's lean into the ravenous and drinking more"
  /\b(?:let['’]?s|can\s+(?:you|we)|please)\s+lean\s+(?:more\s+|harder\s+)?into\b/i,
];
// "I want it to be scary" in a text; in a scene, "I need it to be a clean line" is a story line, so Conversation only.
const CONVERSATION_ASK_PATTERNS: readonly RegExp[] = [
  ...ASK_PATTERNS,
  /\bi\s+(?:want|need)\s+(?:it|this)\s+to\s+be\s+(?:more\s+)?\w+/i,
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

/** "meaaaan" -> "mean", "Noooo" -> "No": drawn-out words still match. Only for matching; quotes keep their words. */
function unstretch(text: string): string {
  return text.replace(/(\p{L})\1{2,}/gu, "$1");
}

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  const plain = unstretch(text);
  return patterns.some((pattern) => pattern.test(plain));
}

/** Whether a message says the last reply missed what they wanted. */
export function isReplyRedirect(text: string): boolean {
  return matchesAny(text, MISS_PATTERNS);
}

/** Whether a message asks for a tone, genre or kind of scene. */
export function isSceneAsk(text: string, mode: ReplySteeringMode = "conversation"): boolean {
  return matchesAny(text, mode === "roleplay" ? ASK_PATTERNS : CONVERSATION_ASK_PATTERNS);
}

/** Out-of-character asides: "(idk, you pick)", "((ooc))", "[OOC: ...]", "ooc: ...". */
function outOfCharacterText(text: string): string {
  const parts = text.match(/\([^()]*\)|\[\s*ooc\b[^\]]*\]|\booc\s*:[^\n]*/gi);
  return parts ? parts.join(" ") : "";
}

/**
 * Whether a message says they're unsure or low on energy. In a scene "I don't know how it got here" or "It's up to
 * you, Captain" is their character talking, so Roleplay only reads out-of-character asides.
 */
export function isUnsureMessage(text: string, mode: ReplySteeringMode = "conversation"): boolean {
  return UNSURE_PATTERN.test(unstretch(mode === "roleplay" ? outOfCharacterText(text) : text));
}

/** The user's recent texts, oldest first, ending with the one being answered. */
function recentUserTexts(input: ReplySteeringInput): string[] {
  const texts = input.messages
    .filter((message) => readString(message.role) === "user" && !hidden(message))
    .map((message) => readString(message.content).trim())
    .filter(Boolean);
  const latest = readString(input.latestUserInput).trim();
  if (latest && texts[texts.length - 1] !== latest) texts.push(latest);
  return texts.slice(-STEERING_WINDOW);
}

function redirectCountLine(texts: readonly string[]): string | null {
  const redirects = texts.filter(isReplyRedirect);
  if (redirects.length < 2) return null;
  return `They have now redirected ${redirects.length} times (${redirects
    .slice(-MAX_QUOTED_REDIRECTS)
    .map((text) => quote(text, 50))
    .join(", ")}). Whatever you keep reaching for isn't landing; change the approach itself, not the details.`;
}

function conversationLines(texts: readonly string[], latest: string, user: string): string[] {
  const lines: string[] = [];
  if (isReplyRedirect(latest)) {
    lines.push(
      `${user}'s last message says your previous reply missed: ${quote(latest)}. Don't offer a small variation of the same idea; take a clearly different approach to what they asked for. Stay in character, and don't tease them for the feedback, call them picky or give up on it.`,
    );
    const count = redirectCountLine(texts);
    if (count) lines.push(count);
  }

  const ask = [...texts].reverse().find((text) => isSceneAsk(text));
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
  return lines;
}

// Roleplay pushback usually comes in character, so the note lets the writer tell feedback from a story line, and
// points at the message the missed reply answered: in a scene that is usually where they said what they wanted.
function roleplayLines(texts: readonly string[], latest: string, user: string): string[] {
  const lines: string[] = [];
  const redirect = isReplyRedirect(latest);
  if (redirect) {
    const before = texts
      .slice(0, -1)
      .reverse()
      .find((text) => !isReplyRedirect(text));
    lines.push(
      [
        `${user}'s last message pushes back on how your previous reply took the scene: ${quote(latest)}.`,
        "If that is them saying the scene went the wrong way, and not just their character reacting to something in the story, treat it as direction.",
        before ? `The message your previous reply answered says what they were after: ${quote(before, 240)}.` : "",
        "Give them that now, in character, with a clearly different approach rather than a small variation. Don't make them explain it again, tease them for the correction, or keep pushing the scene the way it was going.",
      ]
        .filter(Boolean)
        .join(" "),
    );
    const count = redirectCountLine(texts);
    if (count) lines.push(count);
  }

  const ask = [...texts].reverse().find((text) => isSceneAsk(text, "roleplay"));
  if (ask && (ask === latest || redirect)) {
    lines.push(
      `What ${user} asked the scene to be, in their words: ${quote(ask)}. Deliver that; it outranks the character's usual mood and habits until they change it.`,
    );
  }

  if (isUnsureMessage(latest, "roleplay")) {
    lines.push(
      `${user} sounds unsure or low on energy right now (${quote(latest, 60)}). Lead: choose one concrete thing yourself and move the scene with it. Don't hand the choice back, offer a this-or-that, or ask them to describe what they want.`,
    );
  }
  return lines;
}

/** The steering lines for the next reply, or null when the user's words call for none. */
export function buildReplySteeringGuidance(input: ReplySteeringInput): string | null {
  const texts = recentUserTexts(input);
  const latest = texts[texts.length - 1];
  if (!latest) return null;
  const user = input.userName?.trim() || "The user";
  const lines = input.mode === "roleplay" ? roleplayLines(texts, latest, user) : conversationLines(texts, latest, user);
  return lines.length ? lines.join("\n") : null;
}
