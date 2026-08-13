import type { LlmMessage } from "../../../capabilities/llm";
import { insertGenerationGuideBeforeFinalUser } from "../../../shared/text/generation-guide";

const CONVERSATION_PROSE_SHAPE_GUIDANCE = [
  "Reply naturally in the established character voice. Prefer direct, character-specific wording. Avoid habitually re-explaining a point through negation or reversal, thesis restatements, or polished parallel lists. Keep those shapes when they genuinely fit the character, the user's wording, or the requested style. Preserve facts, intent, intensity, and voice. Never mention this guidance.",
  "",
  "Examples preserving the same beat:",
  "Automatic: You're not angry. You're afraid of what it means.",
  "Cleaner: You're afraid of what it means.",
  "",
  "Automatic: That is why I stayed. That is what you missed.",
  "Cleaner: I stayed because you missed it.",
  "",
  "Automatic: I notice, I remember, and I wait.",
  "Cleaner: I remember. I wait.",
].join("\n");

export function withConversationProseShapeGuidance(messages: readonly LlmMessage[]): LlmMessage[] {
  return insertGenerationGuideBeforeFinalUser(messages, {
    role: "system",
    content: CONVERSATION_PROSE_SHAPE_GUIDANCE,
    contextKind: "injection",
    displayName: "Conversation Prose Guidance",
  });
}
