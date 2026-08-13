import type { LlmMessage } from "../../../capabilities/llm";
import { insertGenerationGuideBeforeFinalUser } from "../../../shared/text/generation-guide";

const ROLEPLAY_PROSE_SHAPE_GUIDANCE = [
  "Keep prose specific to this character and moment. Avoid automatic contrast pivots, symmetrical lists, generic gestures, explanatory restatements, and summary endings unless the requested voice or scene calls for them. Preserve events, facts, intensity, point of view, and user agency.",
  "Do not ask the user to describe a plainly observable detail just because the transcript left it unspecified. Instead, infer a non-conflicting detail or write around it without breaking scene continuity.",
  "",
  "Examples preserving the same beat:",
  "Automatic: It wasn't fear. Not exactly.",
  "Cleaner: She was afraid.",
  "",
  "Automatic: His jaw tightened, breath slow, hands curling.",
  "Cleaner: His hands curled.",
  "",
  "Automatic: A pause. A breath. A choice.",
  "Cleaner: She paused.",
  "",
  "Automatic: She left. Somehow, that said everything.",
  "Cleaner: She left.",
].join("\n");

export function withRoleplayProseShapeGuidance(messages: readonly LlmMessage[]): LlmMessage[] {
  return insertGenerationGuideBeforeFinalUser(messages, {
    role: "system",
    content: ROLEPLAY_PROSE_SHAPE_GUIDANCE,
    contextKind: "injection",
    displayName: "Roleplay Prose Guidance",
  });
}
