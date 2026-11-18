// Types for Roleplay scenes: a Roleplay chat branched off another chat that plays out one focused story and ends with
// a summary written back to the chat it came from. Behavior spec: docs/provenance/roleplay-scenes.md.
import type { LlmGateway } from "../../../capabilities/llm";
import type { StorageGateway } from "../../../capabilities/storage";

export interface SceneCapabilities {
  storage: StorageGateway;
  llm: LlmGateway;
}

type SceneRating = "sfw" | "nsfw";

/**
 * A checked scene plan. `universal-preset.ts` reads `description`, `scenario`, `firstMessage`, `systemPrompt`,
 * `relationshipHistory`, `rating` and `presetChoices`; the planner never fills `presetChoices`.
 */
export interface SceneFullPlan {
  name: string;
  description: string;
  scenario: string;
  /** The opening beat brief (three labeled lines), not prose. */
  firstMessage: string;
  characterIds: string[];
  systemPrompt: string;
  rating: SceneRating;
  relationshipHistory: string;
  presetChoices?: Record<string, unknown>;
}

/** `planned` writes the opening as a message; `generated` leaves it to the Roleplay writer. */
export type SceneOpeningMode = "planned" | "generated";

export type SceneForkMode = "clone" | "convert";

export interface CreateSceneRequest {
  originChatId: string;
  plan: SceneFullPlan;
  /** The character that started the scene, or null when the user did. */
  initiatorCharId: string | null;
  connectionId?: string | null;
  openingMode: SceneOpeningMode;
}

export interface CreatedScene {
  chatId: string;
  chatName: string;
  description: string;
  /** Always null: scenes never pick a background. Kept so older readers see the same shape. */
  background: null;
}

export interface ConcludedScene {
  summary: string;
  originChatId: string;
}

export interface ForkedScene {
  chatId: string;
  chatName: string;
  mode: SceneForkMode;
  originChatId: string | null;
}

/** The model calls a scene makes. The opening reply is an ordinary Roleplay generation, not one of these. */
export type SceneCallKind = "plan" | "section_summary" | "whole_summary" | "whole_summary_retry";
