import type { LlmMessage } from "../capabilities/llm";
import { withConversationProseShapeGuidance } from "../modes/chat/core/conversation-prose-guidance";
import { withRoleplayProseShapeGuidance } from "../modes/roleplay/core/roleplay-prose-guidance";

export function withModeProseShapeGuidance(
  messages: readonly LlmMessage[],
  chatMode: string | null | undefined,
): LlmMessage[] {
  const mode = chatMode?.trim();
  if (mode === "conversation") return withConversationProseShapeGuidance(messages);
  if (mode === "roleplay") return withRoleplayProseShapeGuidance(messages);
  return [...messages];
}
