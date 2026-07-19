import type { GenerationContextAttribution, Message, MessageSwipe } from "../../../../engine/contracts/types/chat";
import type { PromptBudgetEstimate } from "../../../../engine/generation/prompt-budget";
import type { ChatMLMessage } from "../../../../engine/contracts/types/prompt";
import type { PromptAttachment } from "../../../../engine/shared/attachments/image-attachments";
export type { CharacterMap, PersonaInfo } from "../../../runtime/visuals/types";

type PeekPromptMessage = {
  role: string;
  content: string;
  contextKind?: ChatMLMessage["contextKind"];
  displayName?: string;
  images?: string[];
};

export type PeekPromptData = {
  messages: PeekPromptMessage[];
  previewMessages?: PeekPromptMessage[];
  parameters: unknown;
  promptPresetId?: string | null;
  contextAttribution?: GenerationContextAttribution | null;
  source?: "cached" | "live_preview" | "raw_messages";
  exact?: boolean;
  generationInfo?: {
    model?: string;
    provider?: string;
    temperature?: number | null;
    maxTokens?: number | null;
    topP?: number | null;
    topK?: number | null;
    frequencyPenalty?: number | null;
    presencePenalty?: number | null;
    showThoughts?: boolean | null;
    reasoningEffort?: string | null;
    verbosity?: string | null;
    serviceTier?: string | null;
    assistantPrefill?: string | null;
    tokensPrompt?: number | null;
    tokensCompletion?: number | null;
    tokensCachedPrompt?: number | null;
    tokensCacheWritePrompt?: number | null;
    durationMs?: number | null;
    finishReason?: string | null;
  } | null;
  agentNote?: string;
  loading?: boolean;
  error?: string;
  budget?: PromptBudgetEstimate;
};

export type PeekPromptOptions = {
  forCharacterId?: string | null;
  messageId?: string | null;
  promptSnapshot?: Message["extra"]["generationPromptSnapshot"] | null;
  message?: string | null;
  userMessage?: string | null;
  attachments?: PromptAttachment[] | null;
};

export type RegenerateOptions = {
  chatId?: string;
  skipTouchConfirm?: boolean;
  forCharacterId?: string | null;
  propagateErrors?: boolean;
};

export type MessageWithSwipes = Message & {
  swipes?: Array<Pick<MessageSwipe, "content" | "extra" | "characterId"> & { id?: string }>;
  swipePreviews?: Array<Pick<MessageSwipe, "content" | "characterId"> & { id?: string }>;
};

export type ExpressionAvatarResolver = (message: MessageWithSwipes, characterId: string) => string | null;

export type MessageSelectionToggle = {
  messageId: string;
  orderIndex: number;
  checked: boolean;
  shiftKey: boolean;
};
