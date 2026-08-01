export type ConversationCraftMode = "solo" | "group";

export const CONVERSATION_CRAFT_BASELINE_GUIDANCE = `Do not paraphrase the user's message before reacting. Do not tell the user what they really mean, want, or feel; give one direct reaction to what they actually said instead of a paraphrase-plus-question sequence. Stay in the character's established wording, casing, humor, and level of care. Avoid assistant framing, canned validation, therapy language, polished triplets, not-X-but-Y pivots, recap endings, and a forced closing question. Avoiding canned validation does not mean withholding character-appropriate care or useful specifics. Do not invent missing context just to sound specific. Let length fit the moment; brevity is not itself a goal. Output no speaker label. Explicit style requests control.`;

export const CONVERSATION_CRAFT_GROUP_GUIDANCE =
  "In a group, respond to what this character naturally cares about, including relevant open questions, but do not answer every point or another person's direct mention. If nothing is theirs, silence or a minimal reaction is valid; never impersonate the addressee. Keep their voice distinct from the other participants.";

const ISSUE_DIRECTIVES = {
  "assistant-framing": "React as the character; omit helper framing, service language, and automatic offers.",
  "therapy-speak": "Use character-specific care, not canned validation or therapy language; let subtext stand.",
  restatement: "Respond directly; do not paraphrase or summarize the user's message first.",
  "forced-question": "Let a natural statement stand; do not add a question merely to continue the chat.",
  overexplaining: "Explain less; answer only what this character would naturally address.",
  "polished-shape": "Break the repeated polished shape: no automatic triplet, balanced contrast, or recap ending.",
  "voice-drift": "Return to the character's established wording, casing, humor, and emotional habits.",
  "roleplay-formatting": "Write only message text; omit actions, narration, quotation framing, and stage directions.",
  "group-omnireply": CONVERSATION_CRAFT_GROUP_GUIDANCE,
  "group-voice-collapse": "Keep group voices distinct; use this character's established diction and habits.",
} as const;

type ConversationCraftIssue = keyof typeof ISSUE_DIRECTIVES;

export function conversationCraftDirectiveForIssue(issue: unknown, mode: ConversationCraftMode): string | null {
  if (typeof issue !== "string" || !Object.prototype.hasOwnProperty.call(ISSUE_DIRECTIVES, issue)) return null;
  const typedIssue = issue as ConversationCraftIssue;
  if (mode !== "group" && (typedIssue === "group-omnireply" || typedIssue === "group-voice-collapse")) return null;
  return ISSUE_DIRECTIVES[typedIssue];
}
