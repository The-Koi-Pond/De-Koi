export const CONVERSATION_CRAFT_AGENT_TYPE = "conversation-craft";

export type ConversationCraftMode = "solo" | "group";

export const CONVERSATION_CRAFT_ISSUES = [
  "assistant-framing",
  "therapy-speak",
  "restatement",
  "forced-question",
  "overexplaining",
  "polished-shape",
  "voice-drift",
  "roleplay-formatting",
  "group-omnireply",
  "group-voice-collapse",
] as const;

export type ConversationCraftIssue = (typeof CONVERSATION_CRAFT_ISSUES)[number];

export interface ConversationCraftState {
  version: 1;
  conversationMode: ConversationCraftMode;
  recentPatterns: string[];
  recentStrengths: string[];
  pendingGuidance: string[];
  lastAnalysisReason: string;
}

export const CONVERSATION_CRAFT_BASELINE_GUIDANCE = `Do not paraphrase the user's message before reacting. Stay in the character's established wording, casing, humor, and level of care. Avoid assistant framing, canned validation, therapy language, polished triplets, not-X-but-Y pivots, recap endings, and a forced closing question. Avoiding canned validation does not mean withholding character-appropriate care or useful specifics. Do not invent missing context just to sound specific. Let length fit the moment; brevity is not itself a goal. Output no speaker label. Explicit style requests control.`;

export const CONVERSATION_CRAFT_GROUP_GUIDANCE =
  "In a group, respond to what this character naturally cares about, including relevant open questions, but do not answer every point or another person's direct mention. If nothing is theirs, silence or a minimal reaction is valid; never impersonate the addressee. Keep their voice distinct from the other participants.";

const ISSUE_DIRECTIVES: Record<ConversationCraftIssue, string> = {
  "assistant-framing": "React as the character, without helper framing, service language, or an automatic offer to help.",
  "therapy-speak": "Avoid canned validation and therapy language; react in this character's specific voice and let subtext stand.",
  restatement: "Respond directly instead of paraphrasing or summarizing the user's message first.",
  "forced-question": "Do not add a closing question merely to continue the chat; let a reaction or statement stand when natural.",
  overexplaining: "Use less explanation and leave more implied; answer only the parts this character would naturally address.",
  "polished-shape": "Break the repeated polished structure; avoid another triplet, balanced contrast, or recap ending.",
  "voice-drift": "Return to this character's established wording, casing, directness, humor, and emotional habits.",
  "roleplay-formatting": "Write only the character's message text, without actions, narration, quotation framing, or stage directions.",
  "group-omnireply": CONVERSATION_CRAFT_GROUP_GUIDANCE,
  "group-voice-collapse": "Keep the group voices distinct; use only this character's established diction and conversational habits.",
};

const ISSUE_SET = new Set<string>(CONVERSATION_CRAFT_ISSUES);
const GROUP_ONLY_ISSUES = new Set<ConversationCraftIssue>(["group-omnireply", "group-voice-collapse"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function boundedText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function boundedList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    const text = boundedText(item, maxLength);
    if (!text || result.includes(text)) continue;
    result.push(text);
    if (result.length >= maxItems) break;
  }
  return result;
}

export function emptyConversationCraftState(): ConversationCraftState {
  return {
    version: 1,
    conversationMode: "solo",
    recentPatterns: [],
    recentStrengths: [],
    pendingGuidance: [],
    lastAnalysisReason: "",
  };
}

export function normalizeConversationCraftState(value: unknown): ConversationCraftState {
  if (!isRecord(value)) return emptyConversationCraftState();
  return {
    version: 1,
    conversationMode: value.conversationMode === "group" ? "group" : "solo",
    recentPatterns: boundedList(value.recentPatterns, 6, 240),
    recentStrengths: boundedList(value.recentStrengths, 4, 240),
    pendingGuidance: boundedList(value.pendingGuidance, 1, 480),
    lastAnalysisReason: boundedText(value.lastAnalysisReason, 480),
  };
}

export function conversationCraftDirectiveForIssue(
  issue: unknown,
  mode: ConversationCraftMode,
): string | null {
  if (typeof issue !== "string" || !ISSUE_SET.has(issue)) return null;
  const typedIssue = issue as ConversationCraftIssue;
  if (mode !== "group" && GROUP_ONLY_ISSUES.has(typedIssue)) return null;
  return ISSUE_DIRECTIVES[typedIssue];
}
