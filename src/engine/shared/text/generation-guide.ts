import type { LlmMessage } from "../../capabilities/llm";
import {
  CONVERSATION_CRAFT_BASELINE_GUIDANCE,
  CONVERSATION_CRAFT_GROUP_GUIDANCE,
  type ConversationCraftMode,
} from "../../contracts/constants/conversation-craft";

export const GENERATION_GUIDE_SOURCES = [
  "narrator",
  "guide",
  "amend",
  "game_start",
  "game_turn",
  "game_retry",
] as const;

export type GenerationGuideSource = (typeof GENERATION_GUIDE_SOURCES)[number];

export interface ProseGuardianAvoidanceSource {
  agentType?: string | null;
  text?: string | null;
}

export interface GenerationGuideMessage extends LlmMessage {
  contextKind: "prompt" | "injection";
  displayName: string;
}

export interface BuildGenerationGuideMessagesInput {
  generationGuide?: string | null;
  generationGuideSource?: GenerationGuideSource | null;
  contextInjections?: readonly ProseGuardianAvoidanceSource[] | null;
  internalGuides?: readonly (string | null | undefined)[] | null;
  conversationCraftMode?: ConversationCraftMode | null;
}

const GUIDE_SOURCE_LABELS: Record<GenerationGuideSource, string> = {
  narrator: "Narrator Guide",
  guide: "Generation Guide",
  amend: "Amend Guide",
  game_start: "Game Start Guide",
  game_turn: "Game Turn Guide",
  game_retry: "Game Retry Guide",
};

const PROSE_GUARDIAN_AGENT_TYPE = "prose-guardian";
const NARRATIVE_CRAFT_AGENT_TYPE = "narrative-craft";

function uniqueTrimmedLines(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const line = value.trim();
    if (!line || seen.has(line)) continue;
    seen.add(line);
    result.push(line);
  }
  return result;
}

export function buildProseGuardianAvoidanceGuide(
  injections: readonly ProseGuardianAvoidanceSource[] | null | undefined,
): string | null {
  const directives = uniqueTrimmedLines(
    (injections ?? [])
      .filter((injection) => injection.agentType === PROSE_GUARDIAN_AGENT_TYPE)
      .map((injection) => injection.text ?? ""),
  );

  if (directives.length === 0) return null;

  return [
    "[Prose Guardian avoidance instruction - high priority for this generation.",
    "Do not reuse the banned or recently repeated phrases, wording patterns, or prose devices called out below unless the user explicitly asks for them.",
    "Follow the story request normally while varying diction, rhythm, imagery, and character action away from these flagged patterns. Do not mention this instruction in the reply.",
    "",
    "<prose_guardian_avoidance>",
    directives.join("\n\n"),
    "</prose_guardian_avoidance>]",
  ].join("\n");
}

function buildNarrativeCraftGuide(
  injections: readonly ProseGuardianAvoidanceSource[] | null | undefined,
): string | null {
  const directives = uniqueTrimmedLines(
    (injections ?? [])
      .filter((injection) => injection.agentType === NARRATIVE_CRAFT_AGENT_TYPE)
      .map((injection) => injection.text ?? ""),
  );

  if (directives.length === 0) return null;

  return [
    "[Narrative Craft instruction - high priority for this generation.",
    "Before returning the response, silently revise the draft using the directive below. Do not mention this instruction in the reply.",
    "",
    "<narrative_craft>",
    directives.join("\n\n"),
    "</narrative_craft>]",
  ].join("\n");
}

function buildConversationCraftGuide(
  mode: ConversationCraftMode | null | undefined,
  injections: readonly ProseGuardianAvoidanceSource[] | null | undefined,
): string | null {
  if (!mode) return null;
  const adaptive = uniqueTrimmedLines(
    (injections ?? [])
      .filter((injection) => injection.agentType === NARRATIVE_CRAFT_AGENT_TYPE)
      .map((injection) => injection.text ?? ""),
  );
  const directives = [
    CONVERSATION_CRAFT_BASELINE_GUIDANCE,
    mode === "group" ? CONVERSATION_CRAFT_GROUP_GUIDANCE : "",
    ...adaptive,
  ].filter(Boolean);
  return [
    "[Conversation Craft instruction - high priority for this generation.",
    "Silently revise the draft using the directives below. Do not mention this instruction.",
    "",
    "<conversation_craft>",
    directives.join("\n\n"),
    "</conversation_craft>]",
  ].join("\n");
}

export function buildNarratorInstructionMessage(direction: string): string {
  return `[Narrator instruction — do not include a reply from {{user}}. Instead, write the next part of the narrative steering it toward the following: ${direction.trim()}]`;
}

export function buildGuidedGenerationInstructionMessage(direction: string): string {
  return `[Guided generation instruction — do not include a reply from {{user}}. Instead, write the next generated message steering it toward the following: ${direction.trim()}]`;
}

export function buildAmendGenerationInstructionMessage(direction: string, previousResponse: string): string {
  return [
    "[Amend generation instruction — do not include a reply from {{user}}.",
    "Revise the previous generated response according to the instruction below.",
    "Preserve the parts that already work, keep the same speaker/format unless the instruction says otherwise, and output only the revised response.",
    "",
    "Previous generated response:",
    previousResponse.trim(),
    "",
    "Revision instruction:",
    direction.trim(),
    "]",
  ].join("\n");
}

export function buildGenerationGuideMessages(input: BuildGenerationGuideMessagesInput): GenerationGuideMessage[] {
  const messages: GenerationGuideMessage[] = [];
  const userGuide = input.generationGuide?.trim();
  if (userGuide) {
    messages.push({
      role: "user",
      content: userGuide,
      contextKind: "prompt",
      displayName: input.generationGuideSource ? GUIDE_SOURCE_LABELS[input.generationGuideSource] : "Generation Guide",
    });
  }

  const internalContent = [
    buildProseGuardianAvoidanceGuide(input.contextInjections),
    input.conversationCraftMode ? null : buildNarrativeCraftGuide(input.contextInjections),
    buildConversationCraftGuide(input.conversationCraftMode, input.contextInjections),
    ...(input.internalGuides ?? []),
  ]
    .map((guide) => (guide ?? "").trim())
    .filter((guide) => guide.length > 0)
    .join("\n\n");
  if (internalContent) {
    messages.push({
      role: "system",
      content: internalContent,
      contextKind: "injection",
      displayName: "Internal Avoidance Guidance",
    });
  }

  return messages;
}

export function stripGenerationGuideInstruction(value: string): string {
  const amendMatch = value.match(/^\[Amend generation instruction [\s\S]*?\nRevision instruction:\n([\s\S]*)\]$/);
  if (amendMatch) return amendMatch[1]?.trim() || value;
  const match = value.match(/^\[(?:Narrator|Guided generation) instruction [^\]]*? following:\s*([\s\S]*)\]$/);
  return match?.[1]?.trim() || value;
}
