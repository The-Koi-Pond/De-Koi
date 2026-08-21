import type { LlmMessage } from "../../../capabilities/llm";
import { insertGenerationGuideBeforeFinalUser } from "../../../shared/text/generation-guide";

const ROLEPLAY_PROSE_SHAPE_GUIDANCE = [
  "Keep prose specific to this character and moment.",
  "Let sentence rhythm come from the active character and scene pressure. Favor concrete action, causal detail, and a live point of tension that leaves room for the user's next choice.",
  "Preserve events, facts, intensity, point of view, and user agency.",
  "When the transcript leaves a plainly observable detail unspecified, infer a non-conflicting detail or write around it without breaking scene continuity.",
].join("\n");

export function withRoleplayProseShapeGuidance(messages: readonly LlmMessage[]): LlmMessage[] {
  return insertGenerationGuideBeforeFinalUser(messages, {
    role: "system",
    content: ROLEPLAY_PROSE_SHAPE_GUIDANCE,
    contextKind: "injection",
    displayName: "Roleplay Prose Guidance",
  });
}
