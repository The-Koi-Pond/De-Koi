import type { LlmMessage } from "../../../capabilities/llm";
import { insertGenerationGuideBeforeFinalUser } from "../../../shared/text/generation-guide";

const CONVERSATION_PROSE_SHAPE_GUIDANCE = [
  "Reply naturally in the established character voice.",
  "Let sentence shape follow the character's diction and current emotion. Prefer direct, character-specific wording and trust short or uneven phrasing when it fits.",
  "Preserve facts, intent, intensity, and voice. Never mention this guidance.",
].join("\n");

export function withConversationProseShapeGuidance(messages: readonly LlmMessage[]): LlmMessage[] {
  return insertGenerationGuideBeforeFinalUser(messages, {
    role: "system",
    content: CONVERSATION_PROSE_SHAPE_GUIDANCE,
    contextKind: "injection",
    displayName: "Conversation Prose Guidance",
  });
}
