import type { LlmMessage } from "../../capabilities/llm";

export const GENERATION_GUIDE_SOURCES = [
  "narrator",
  "guide",
  "amend",
  "game_start",
  "game_turn",
  "game_retry",
] as const;

export type GenerationGuideSource = (typeof GENERATION_GUIDE_SOURCES)[number];

export interface GenerationGuideMessage extends LlmMessage {
  contextKind: "prompt" | "injection";
  displayName: string;
}

export interface BuildGenerationGuideMessagesInput {
  generationGuide?: string | null;
  generationGuideSource?: GenerationGuideSource | null;
  internalGuides?: readonly (string | null | undefined)[] | null;
}

const GUIDE_SOURCE_LABELS: Record<GenerationGuideSource, string> = {
  narrator: "Narrator Guide",
  guide: "Generation Guide",
  amend: "Amend Guide",
  game_start: "Game Start Guide",
  game_turn: "Game Turn Guide",
  game_retry: "Game Retry Guide",
};

const ROLEPLAY_PROSE_SHAPE_GUIDANCE = [
  "Keep prose specific to this character and moment. Avoid automatic contrast pivots, symmetrical lists, generic gestures, explanatory restatements, and summary endings unless the requested voice or scene calls for them. Preserve events, facts, intensity, point of view, and user agency.",
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

export function withRoleplayProseShapeGuidance(
  messages: readonly LlmMessage[],
  chatMode: string | null | undefined,
): LlmMessage[] {
  if (chatMode?.trim() !== "roleplay") return [...messages];

  const guidance: GenerationGuideMessage = {
    role: "system",
    content: ROLEPLAY_PROSE_SHAPE_GUIDANCE,
    contextKind: "injection",
    displayName: "Roleplay Prose Guidance",
  };
  let insertionIndex = messages.length;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      insertionIndex = index;
      break;
    }
  }
  return [...messages.slice(0, insertionIndex), guidance, ...messages.slice(insertionIndex)];
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

  const internalContent = [...(input.internalGuides ?? [])]
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
