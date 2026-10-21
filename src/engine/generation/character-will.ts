// ──────────────────────────────────────────────
// Roleplay and Conversation: keep characters from folding when the user pushes
// ──────────────────────────────────────────────

/**
 * The preset already says characters don't give in just because the user pushes, but from deep in the system prompt
 * it lost to the pull to please: a character "set terms" and then handed over exactly what was asked. Said again on
 * the latest turn, next to what the user is pushing for, it holds. It goes only on turns where the user asks for
 * something or argues a point: on every turn it pushed the writer to script whole exchanges, the user's side
 * included.
 */
export const CHARACTER_WILL_NOTES = {
  roleplay:
    "[Character will for this reply, do not mention it] The user is asking, insisting or arguing for something. Decide as each character would from their own goals, duties and fears, not to keep the user happy. A good argument earns a hearing, not a yes. Someone who would risk what they care about refuses, or gives much less than was asked. Terms that end in handing over what was asked are still giving in. Agree only when the story gives the character a real reason to. Refusing or arguing happens in the characters' own words and actions; never write the user's reply or decide what the user does next.",
  conversation:
    "[Character will for this text, do not mention it] The user is pushing a view or a request. If the character disagrees, they say what they think and argue it in their own voice with the real reason, something specific from their own life or values; a flat no or a brush-off isn't arguing. They don't drop it, joke it away or concede to keep things nice, and they change their mind only when the user gives them something new. Warmth and a firm opinion go together.",
} as const;

/** Asking a character for something: "let me take the wheel", "can I come", "trust me", "you should...". */
const REQUEST_PATTERN =
  /\b(?:let me|let us|give me|hand (?:me|it over)|can i|could i|may i|i want to|i need to|i'm going (?:to|out|up|down|in|with)|i am going (?:to|out|up|down|in|with)|i insist|trust me|please|you have to|you've got to|you need to|you should|you could just|come on|allow me|i'll take|i'm taking|i'm coming|don't stop me|just let)\b/i;
/** Arguing a point at a character: "theo's probably right", "ebooks are just better", "it'd be so much easier". */
const OPINION_PATTERN =
  /\b(?:probably right|is right|are right|just better|better than|worse than|pointless|overrated|admit it|be honest|you know i'm right|why don't you|why not just|(?:it'd|it would|that'd|that would) be (?:so much )?easier|so much easier|should just|you're wrong|that's wrong|i disagree)\b/i;

/** True when the user's latest turn asks the character for something or argues a point at them. */
export function userIsPushing(latestUserInput: string): boolean {
  const text = latestUserInput.replace(/[’‘]/g, "'");
  return REQUEST_PATTERN.test(text) || OPINION_PATTERN.test(text);
}

/** The will note for this turn, or "" when the mode has none or the user isn't pushing. */
export function characterWillNote(mode: string, latestUserInput: string, impersonate: boolean): string {
  if (impersonate || !userIsPushing(latestUserInput)) return "";
  if (mode === "roleplay" || mode === "visual_novel") return CHARACTER_WILL_NOTES.roleplay;
  if (mode === "conversation") return CHARACTER_WILL_NOTES.conversation;
  return "";
}
