import type { GenerationContextAttributionItem } from "../../../contracts/types/chat";
import type { RoleplayContinuityDirectorState } from "../../../contracts/types/roleplay-continuity-director";
import { normalizeContinuityDirectorState } from "./continuity-director-state";

export interface ContinuityDirectorContextInput {
  chatId: string;
  chatMode: string;
  state: RoleplayContinuityDirectorState | unknown;
}

export interface ContinuityDirectorPromptContext {
  block: string;
  attributionItems: GenerationContextAttributionItem[];
}

const MAX_INJECTED_BEATS = 6;

export function buildContinuityDirectorContext(
  input: ContinuityDirectorContextInput,
): ContinuityDirectorPromptContext | null {
  if (input.chatMode !== "roleplay") return null;
  const state = normalizeContinuityDirectorState(input.state);
  if (!state.enabled) return null;

  const approved = state.beats
    .filter((beat) => beat.status === "approved")
    .sort((left, right) => left.order - right.order)
    .slice(0, MAX_INJECTED_BEATS);
  if (approved.length === 0) return null;

  const block = [
    "<continuity_director>",
    "The latest explicit user request overrides every beat below.",
    "These are approved structural possibilities, not prose. The writer owns wording and pacing.",
    "Never supply the user persona's dialogue, deliberate action, belief, intent, decision, or strategic choice.",
    ...approved.map((beat, index) => `${index + 1}. ${beat.text}`),
    "</continuity_director>",
  ].join("\n");

  return {
    block,
    attributionItems: approved.map((beat, index) => ({
      kind: "continuity_director",
      label: `Approved beat ${index + 1}`,
      status: "injected",
      sourceId: beat.id,
      sourceCollection: "chats",
      parentSourceId: input.chatId,
      snippet: beat.text,
      metadata: {
        planRevision: state.revision,
        order: beat.order,
        beatStatus: beat.status,
        itemSource: beat.source,
        sourceIds: beat.sourceIds,
        characterIds: beat.characterIds,
        threadIds: beat.threadIds,
      },
    })),
  };
}
