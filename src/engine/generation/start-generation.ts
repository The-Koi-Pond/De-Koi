import {
  BUILT_IN_AGENTS,
  BUILT_IN_AGENT_RUN_INTERVAL_DEFAULTS,
  enabledChatAgentIdSet,
  type AgentResult,
} from "../contracts/types/agent";
import {
  getEffectiveMemoryRecallEnabled,
  type DaySummaryEntry,
  type DialogueAttributionsExtra,
  type GenerationContextAttribution,
  type GenerationPromptSnapshot,
  type GenerationPromptSnapshotMessage,
  type WeekSummaryEntry,
} from "../contracts/types/chat";
import type { GameState } from "../contracts/types/game-state";
import type { EventGateway } from "../capabilities/events";
import type { IntegrationGateway } from "../capabilities/integrations";
import type { LlmGateway, LlmMessage } from "../capabilities/llm";
import type { AddChatMessageSwipeOptions, ChatMessageListOptions, StorageGateway } from "../capabilities/storage";
import type { SpriteOwnerType, VisualAssetGateway } from "../capabilities/visual-assets";
import { buildGenerationGuideMessages } from "../shared/text/generation-guide";
import { chatSummaryFingerprintMatches, fingerprintChatSummary } from "../shared/text/chat-summary-fingerprint";
import { collapseExcessBlankLines } from "../shared/text/newlines";
import {
  buildDialogueAttributions,
  createDialogueAttributionTextHash,
  type DialogueAttributionSpeaker,
} from "../shared/text/dialogue-attribution";
import { normalizeUserTimeZone } from "../shared/time/timezone";
import { buildImpersonateInstruction } from "../modes/chat/commands/impersonate-prompt";
import { conversationCommandPromptEnabled } from "../modes/chat/commands/activation";
import { detectConversationSelfieRequestIntent } from "../modes/chat/commands/selfie-intent";
import { getConversationStatus } from "../modes/chat/autonomous/autonomous.service";
import {
  backfillConversationSummaries,
  type ConversationSummaryBackfillResult,
} from "../modes/chat/core/summaries/auto-summary.service";
import {
  getAvailabilityDecision,
  getAvailabilityResponseDelay,
  type ConversationAvailabilityDecision,
  type WeekSchedule,
} from "../modes/chat/schedules/schedule.service";
import {
  activeCharacterIds,
  assertChatHasActiveCharacters,
  assertRequestedCharacterIsActive,
} from "./active-characters";
import { persistSecretPlotAgentMemory, type SecretPlotRerollMode } from "./agent-memory-runtime";
import { createGenerationAgentRuntime } from "./agent-runner";
import { buildBuiltInAgentFallback } from "./built-in-agent-fallback";
import { generationContextAttribution } from "./context-attribution";
import {
  consumePendingConnectedInfluences,
  persistConnectedCommandTags,
  type ConnectedCommandResult,
} from "./connected-commands";
import { fitLlmRequestToContextWindow } from "./context-window";
import type { LLMToolCall } from "../generation-core/llm/base-provider";
import { createInlineThinkingStreamParser, extractLeadingThinkingBlocks } from "../generation-core/llm/inline-thinking";
import {
  buildMainToolDefinitions,
  executeMainToolCall,
  normalizeToolCall,
  type MainToolDefinitions,
  type ToolRuntimeInput,
} from "./tools-runtime";
import {
  llmParameters,
  loadChatMessage,
  loadChatMessages,
  requireRecord,
  resolveGenerationConnection,
} from "./context";
import {
  appendReadableAttachmentsToContent,
  buildUserMessageRegenerationPromptFromSource,
  buildUserMessageRegenerationSourceMessage,
  promptAttachmentsFromExtra,
  resolveRegenerationGameStateAnchor,
  resolveRegenerationGameStateFallbackMessageIds,
  resolveVisibleGameStateAnchor,
  shouldPreferLatestVisibleGameState,
  type PromptAttachment,
  type SimplePromptMessage,
} from "./generate-route-utils";
import {
  deletePreparedManagedImageAttachments,
  isImageAttachment,
  prepareManagedImageAttachmentBatch,
  resolveImageAttachmentDelivery,
  type ImageAttachmentDeliveryWarning,
  type PreparedManagedImageAttachments,
} from "../shared/attachments/image-attachments";
import type { GenerationEvent } from "./generation-events";
import {
  enqueueAndScheduleAutomaticMemoryCapture,
  scheduleAutomaticMemoryCaptureQueueProcessing,
} from "./automatic-memory-capture-queue";
import {
  applyCachedContextInjectionsToRegenerateInput,
  applyGenerationReplayToRegenerateInput,
  buildGenerationReplay,
  normalizeGenerationReplay,
  type GenerationReplay,
} from "./generation-replay";
import { loadPersonaSnapshotForChat } from "./persona-snapshot";
import { assembleGenerationPrompt, chatSummaryForGeneration } from "./prompt-assembly";
import type { GenerationCharacterContext, GenerationPersonaContext } from "./prompt-assembly";
import { generationInfoFromVisibleParameters, providerVisibleLlmParameters } from "./provider-visible-parameters";
import { applyRuntimeRegexScripts } from "./regex-runtime";
import { illustratorAvatarReferencesEnabled } from "./illustrator-settings";
import { illustrationSubjectMatches } from "../generation-core/images/illustration-reference-matching";
import {
  illustrationImageRequestWireBytes,
  illustrationReferencesForRequest,
  usableIllustrationReferenceImage,
  type IllustrationReferenceData,
} from "../generation-core/images/illustration-reference-selection";
export {
  illustrationImageRequestWireBytes,
  illustrationReferenceImagesForRequest,
  illustrationReferencesForRequest,
} from "../generation-core/images/illustration-reference-selection";
import {
  normalizeStartGenerationInput,
  type AgentInjectionOverride,
  type StartGenerationInput,
} from "./start-generation-input";
import {
  completeRequiredSpriteExpressionEntries,
  type AvailableSpriteCharacter,
  type SpriteExpressionCompletionOptions,
  type SpriteExpressionEntry,
} from "./sprite-expression-validation";
import {
  boolish,
  hiddenFromAi,
  isRecord,
  nowIso,
  parseRecord,
  readNumber,
  readString,
  stringArray,
  type JsonRecord,
} from "./runtime-records";
import {
  commitTrackerSnapshotForTarget,
  createTrackerSnapshotReadContext,
  getTrackerSnapshotForTarget,
  persistTrackerSnapshotForTurn,
  resolveVisibleGameStateFallbackMessageIds,
  selectTrackerSnapshotForGeneration,
  trackerSnapshotTargetFromMessage,
  type TrackerSnapshotSavedHook,
} from "./tracker-snapshots";

export type { StartGenerationInput } from "./start-generation-input";

export interface GenerationEngineDeps {
  storage: StorageGateway;
  llm: LlmGateway;
  integrations: IntegrationGateway;
  visuals?: VisualAssetGateway;
  events?: EventGateway;
  onTrackerSnapshotSaved?: TrackerSnapshotSavedHook;
}

export interface RetryAgentsInput extends JsonRecord {
  chatId: string;
  connectionId?: string | null;
  agentTypes?: string[];
  hideAutomatedSummarySourceMessages?: boolean;
  imagePromptSettings?: StartGenerationInput["imagePromptSettings"];
  options?: Record<string, unknown>;
}

interface PreparedUserInput {
  content: string;
  attachments: PromptAttachment[];
  preparedAttachments: PreparedManagedImageAttachments;
  images: string[];
  imageWarnings: ImageAttachmentDeliveryWarning[];
  mentionedCharacterNames: string[];
}

interface StoredImageAttachmentDelivery {
  messages: JsonRecord[];
  warnings: ImageAttachmentDeliveryWarning[];
}

interface CyoaChoice {
  label: string;
  text: string;
}

const DEFAULT_GENERATION_HISTORY_LIMIT = 300;
const GENERATION_MESSAGE_LOAD_MARGIN = 20;
const MIN_GENERATION_MESSAGE_LOAD_LIMIT = 40;
const MAX_GENERATION_MESSAGE_LOAD_LIMIT = DEFAULT_GENERATION_HISTORY_LIMIT + GENERATION_MESSAGE_LOAD_MARGIN;
const LOREBOOK_KEEPER_BACKFILL_TARGET_SCAN_FIELDS = ["id", "chatId", "role", "extra", "createdAt"];
const LOREBOOK_KEEPER_RUN_SCAN_FIELDS = ["chatId", "messageId", "agentType", "agentConfigId", "success"];
const MAX_LOREBOOK_KEEPER_BACKFILL_RUNS = 4;
const MAX_LOREBOOK_KEEPER_BACKFILL_CANDIDATES = 16;

const LOREBOOK_KEEPER_AGENT_TYPE = "lorebook-keeper";
const DEFAULT_LOREBOOK_KEEPER_RUN_INTERVAL = BUILT_IN_AGENT_RUN_INTERVAL_DEFAULTS[LOREBOOK_KEEPER_AGENT_TYPE] ?? 8;

const CONTINUE_ASSISTANT_RESPONSE_INSTRUCTION =
  "[Generation instruction: continue from the latest assistant message. Do not repeat or summarize the previous response; pick up naturally from where it stopped.]";
const MAX_RANDOM_LLM_SEED_EXCLUSIVE = 4_294_967_295;
const MAX_SAME_SEND_PEER_CONTEXT_CHARS = 4_000;

type SameSendPeerContribution = {
  characterName: string;
  content: string;
};

function boundedSameSendPeerContext(contributions: SameSendPeerContribution[]): string {
  if (contributions.length === 0) return "";
  const labels = contributions.map(({ characterName }) => `${characterName}: `);
  const fixedChars = labels.reduce((total, label) => total + label.length, contributions.length - 1);
  const excerptBudget = Math.max(0, Math.floor((MAX_SAME_SEND_PEER_CONTEXT_CHARS - fixedChars) / contributions.length));
  const context = contributions
    .map(({ content }, index) => {
      const label = labels[index]!;
      const excerpt =
        excerptBudget === 0
          ? ""
          : content.length <= excerptBudget
            ? content
            : `${content.slice(0, excerptBudget - 1)}…`;
      return `${label}${excerpt}`;
    })
    .join("\n");
  return context.slice(0, MAX_SAME_SEND_PEER_CONTEXT_CHARS);
}

type InternalStartGenerationOptions = {
  groupTurnChild?: boolean;
  latestUserInput?: string | null;
  sameSendPeerContext?: string;
  skipUserMessageSave?: boolean;
};

const internalStartGenerationOptions = new WeakMap<StartGenerationInput, InternalStartGenerationOptions>();

type MainGenerationPromptSnapshot = Pick<
  GenerationPromptSnapshot,
  | "messages"
  | "previewMessages"
  | "parameters"
  | "tools"
  | "promptPresetId"
  | "lorebookActivationTrace"
  | "contextAttribution"
>;

type GenerationDryRunPromptSnapshot = MainGenerationPromptSnapshot;

export interface GenerationDryRunInput extends StartGenerationInput {
  runId?: string | null;
}

interface GenerationDryRunResult {
  runId: string | null;
  content: string;
  thinking: string;
  usage: unknown;
  providerMetadata: unknown;
  promptSnapshot: GenerationDryRunPromptSnapshot | null;
  promptPresetId: string | null;
  messageCount: number;
}

export type GenerationDryRunEvent =
  | GenerationEvent
  | {
      type: "dry_run_start";
      data: { runId: string | null };
    }
  | {
      type: "dry_run_result";
      data: GenerationDryRunResult;
    };

const REVIEWABLE_WRITER_AGENT_TYPES = new Set(
  BUILT_IN_AGENTS.filter(
    (agent) =>
      agent.category === "writer" &&
      agent.phase === "pre_generation" &&
      agent.id !== "knowledge-retrieval" &&
      agent.id !== "knowledge-router",
  ).map((agent) => agent.id),
);
const AGENT_INJECTION_REVIEW_CHAT_MODES = new Set(["roleplay", "visual_novel"]);

function abortGenerationError(): Error {
  return Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortGenerationError();
}

function inputUserMessage(input: StartGenerationInput): string {
  return collapseExcessBlankLines(readString(input.message) || readString(input.userMessage));
}

function normalizedAgentInjectionOverrides(input: StartGenerationInput): AgentInjectionOverride[] {
  if (!Array.isArray(input.agentInjectionOverrides)) return [];
  const overrides: AgentInjectionOverride[] = [];
  for (const entry of input.agentInjectionOverrides) {
    if (!isRecord(entry)) continue;
    const agentType = readString(entry.agentType).trim();
    const text = readString(entry.text).trim();
    if (!agentType || !text) continue;
    const agentName = readString(entry.agentName).trim();
    overrides.push({ agentType, ...(agentName ? { agentName } : {}), text });
  }
  return overrides;
}

function shouldPauseForAgentInjectionReview(
  chat: JsonRecord,
  input: StartGenerationInput,
  injections: AgentInjectionOverride[],
): boolean {
  if (normalizedAgentInjectionOverrides(input).length > 0) return false;
  if (readString(input.regenerateMessageId).trim()) return false;
  if (!AGENT_INJECTION_REVIEW_CHAT_MODES.has(readString(chat.mode || chat.chatMode).trim())) return false;
  if (injections.length === 0) return false;
  return parseRecord(chat.metadata).reviewWriterAgentOutputs === true;
}

async function spotifyPlaybackAvailableForConversationCommand(integrations: IntegrationGateway): Promise<boolean> {
  try {
    const player = await integrations.spotify.player<JsonRecord>({});
    return parseRecord(player).connected !== false;
  } catch {
    return false;
  }
}

async function withRuntimeConversationCommandCapabilities(
  chat: JsonRecord,
  integrations: IntegrationGateway,
): Promise<JsonRecord> {
  if (!conversationCommandPromptEnabled(chat)) return chat;
  const spotifyPlaybackAvailable = await spotifyPlaybackAvailableForConversationCommand(integrations);
  const metadata = parseRecord(chat.metadata);
  return {
    ...chat,
    metadata: {
      ...metadata,
      commandCapabilities: {
        ...parseRecord(metadata.commandCapabilities),
        spotifyPlaybackAvailable,
      },
    },
  };
}

function reviewableAgentInjections(injections: AgentInjectionOverride[]): AgentInjectionOverride[] {
  return injections.filter((injection) => REVIEWABLE_WRITER_AGENT_TYPES.has(injection.agentType));
}

function generationEmbeddingSource(llm: LlmGateway, connection: JsonRecord) {
  if (!llm.embed) return null;
  const connectionId = readString(connection.id).trim() || null;
  const model = readString(connection.embeddingModel).trim() || null;
  const cache = new Map<string, Promise<number[][] | null>>();
  return {
    embed: (texts: string[], request?: { connectionId?: string | null; model?: string | null }) => {
      const payload = {
        texts,
        connectionId: request?.connectionId !== undefined ? request.connectionId : connectionId,
        model: request?.model !== undefined ? request.model : model,
      };
      const key = JSON.stringify(payload);
      const existing = cache.get(key);
      if (existing) return existing;
      const embedding = llm.embed!(payload);
      cache.set(key, embedding);
      return embedding;
    },
  };
}

function hasPromptAgentData(agentData: Record<string, string> | null | undefined): agentData is Record<string, string> {
  return Object.values(agentData ?? {}).some((value) => readString(value).trim().length > 0);
}

function inputAttachments(input: StartGenerationInput): PromptAttachment[] {
  return Array.isArray(input.attachments)
    ? input.attachments.filter(isRecord).map((attachment) => attachment as PromptAttachment)
    : [];
}

function assertChatCanGenerate(chat: JsonRecord, input?: { forCharacterId?: unknown }) {
  const mode = readString(chat.mode || chat.chatMode);
  const metadata = parseRecord(chat.metadata);
  if (mode === "roleplay" && metadata.sceneStatus === "concluded") {
    throw new Error("This scene is concluded. Convert or reopen it before sending new messages.");
  }
  assertChatHasActiveCharacters(chat);
  assertRequestedCharacterIsActive(chat, input?.forCharacterId);
}

async function prepareUserInput(
  storage: StorageGateway,
  input: StartGenerationInput,
  chat: JsonRecord,
): Promise<PreparedUserInput> {
  const raw = inputUserMessage(input).trim();
  const attachments = inputAttachments(input);
  const imageDelivery = await resolveImageAttachmentDelivery(storage, attachments);
  const preparedAttachments = await prepareManagedImageAttachmentBatch(storage, input.chatId, attachments);
  try {
    const managedAttachments = preparedAttachments.attachments;
    const mentionedCharacterNames = stringArray(input.mentionedCharacterNames).filter((name) => name.trim().length > 0);
    const regexed = raw
      ? await applyRuntimeRegexScripts(storage, "user_input", raw, { chatCharacterIds: activeCharacterIds(chat) })
      : "";
    const withReadableAttachments = appendReadableAttachmentsToContent(regexed, managedAttachments);
    return {
      content: collapseExcessBlankLines(withReadableAttachments),
      attachments: managedAttachments,
      preparedAttachments,
      images: imageDelivery.images,
      imageWarnings: imageDelivery.warnings,
      mentionedCharacterNames,
    };
  } catch (error) {
    if (preparedAttachments.createdGalleryIds.length > 0) {
      await deletePreparedManagedImageAttachments(storage, preparedAttachments).catch((rollbackError) => {
        console.warn(
          "[generation] Failed to roll back prepared image attachments after input preparation failure",
          rollbackError,
        );
      });
    }
    throw error;
  }
}

async function prepareDryRunUserInput(
  storage: StorageGateway,
  input: StartGenerationInput,
): Promise<PreparedUserInput> {
  const raw = inputUserMessage(input).trim();
  const attachments = inputAttachments(input);
  const imageDelivery = await resolveImageAttachmentDelivery(storage, attachments);
  const mentionedCharacterNames = stringArray(input.mentionedCharacterNames).filter((name) => name.trim().length > 0);
  const regexed = raw ? await applyRuntimeRegexScripts(storage, "user_input", raw) : "";
  const withReadableAttachments = appendReadableAttachmentsToContent(regexed, attachments);
  return {
    content: collapseExcessBlankLines(withReadableAttachments),
    attachments,
    preparedAttachments: { attachments, createdGalleryIds: [] },
    images: imageDelivery.images,
    imageWarnings: imageDelivery.warnings,
    mentionedCharacterNames,
  };
}

async function deletePreparedUserInputAttachmentsSafely(
  storage: StorageGateway,
  prepared: PreparedUserInput,
  reason: string,
): Promise<void> {
  if (prepared.preparedAttachments.createdGalleryIds.length === 0) return;
  try {
    await deletePreparedManagedImageAttachments(storage, prepared.preparedAttachments);
  } catch (error) {
    console.warn(`[generation] Failed to roll back prepared image attachments after ${reason}`, error);
  }
}

function shouldSaveUserMessage(
  input: StartGenerationInput,
  prepared: PreparedUserInput,
  internalOptions: InternalStartGenerationOptions = {},
): boolean {
  if (internalOptions.skipUserMessageSave === true) return false;
  return (
    (!!prepared.content.trim() || prepared.attachments.length > 0) &&
    input.impersonate !== true &&
    !readString(input.regenerateMessageId).trim()
  );
}

async function saveUserMessage(
  storage: StorageGateway,
  chat: JsonRecord,
  input: StartGenerationInput,
  prepared: PreparedUserInput,
  internalOptions: InternalStartGenerationOptions = {},
): Promise<unknown | null> {
  if (!shouldSaveUserMessage(input, prepared, internalOptions)) return null;
  const extra: Record<string, unknown> = {};
  if (prepared.attachments.length) extra.attachments = prepared.attachments;
  if (prepared.mentionedCharacterNames.length) extra.mentionedCharacterNames = prepared.mentionedCharacterNames;
  const personaSnapshot = await loadPersonaSnapshotForChat(storage, chat);
  if (personaSnapshot) extra.personaSnapshot = personaSnapshot;
  const generationReplay = buildGenerationReplay({
    userMessage: inputUserMessage(input) || null,
    impersonate: false,
    generationGuide: input.generationGuide,
    generationGuideSource: input.generationGuideSource,
    impersonatePresetId: readString(input.impersonatePresetId) || null,
    impersonateConnectionId: readString(input.impersonateConnectionId) || null,
    impersonateBlockAgents: input.impersonateBlockAgents === true,
    impersonatePromptTemplate: input.impersonatePromptTemplate,
  });
  if (generationReplay) extra.generationReplay = generationReplay;
  return storage.createChatMessage(input.chatId, {
    role: "user",
    content: prepared.content,
    extra,
  });
}

function savedUserMessageForTimeline(saved: unknown, chatId: string): JsonRecord | null {
  if (!isRecord(saved)) return null;
  if (!readString(saved.id).trim()) return null;
  if (readString(saved.chatId).trim() !== chatId) return null;
  if (readString(saved.role).trim() !== "user") return null;
  if (!readString(saved.content).trim()) return null;
  return saved;
}

function discordWebhookUrl(chat: JsonRecord): string {
  return readString(parseRecord(chat.metadata).discordWebhookUrl).trim();
}

function limitedDiscordName(value: string | null | undefined, fallback: string): string {
  const trimmed = readString(value).trim() || fallback;
  return [...trimmed].slice(0, 80).join("");
}

async function characterNameById(
  storage: StorageGateway,
  characters: GenerationCharacterContext[],
  characterId: string,
): Promise<string | null> {
  const known = characters.find((character) => character.id === characterId);
  if (known?.name) return known.name;
  const row = await storage.get<JsonRecord>("characters", characterId).catch(() => null);
  if (!isRecord(row)) return null;
  return readString(parseRecord(row.data).name).trim() || readString(row.name).trim() || null;
}

async function assistantDiscordName(args: {
  storage: StorageGateway;
  chat: JsonRecord;
  saved: unknown;
  characters: GenerationCharacterContext[];
}): Promise<string> {
  const mode = readString(args.chat.mode || args.chat.chatMode).trim();
  const metadata = parseRecord(args.chat.metadata);
  if (mode === "game") {
    const gmCharacterId = readString(metadata.gameGmCharacterId).trim();
    if (readString(metadata.gameGmMode).trim() === "character" && gmCharacterId) {
      return limitedDiscordName(await characterNameById(args.storage, args.characters, gmCharacterId), "Narrator");
    }
    return "Narrator";
  }

  const characterId = isRecord(args.saved) ? readString(args.saved.characterId).trim() : "";
  if (characterId) {
    return limitedDiscordName(await characterNameById(args.storage, args.characters, characterId), "Character");
  }
  return limitedDiscordName(args.characters.length === 1 ? args.characters[0]?.name : null, "Assistant");
}

function mirrorDiscordMessage(args: {
  integrations: IntegrationGateway;
  chat: JsonRecord;
  content: string;
  username: string;
  avatarUrl?: string | null;
}): void {
  const webhookUrl = discordWebhookUrl(args.chat);
  const content = args.content.trim();
  if (!webhookUrl || !content) return;
  if (!args.integrations.discord) {
    console.warn("[generation] Discord mirror skipped: integration gateway unavailable");
    return;
  }
  const payload: {
    webhookUrl: string;
    content: string;
    username: string;
    avatarUrl?: string;
  } = {
    webhookUrl,
    content,
    username: limitedDiscordName(args.username, "De-Koi"),
  };
  if (args.avatarUrl) payload.avatarUrl = args.avatarUrl;
  void args.integrations.discord.mirrorMessage(payload).catch((error) => {
    console.warn("[generation] Discord mirror failed", error);
  });
}

function mirrorSavedUserMessageToDiscord(args: {
  deps: GenerationEngineDeps;
  chat: JsonRecord;
  characters?: GenerationCharacterContext[];
  input: StartGenerationInput;
  prepared: PreparedUserInput;
  persona: GenerationPersonaContext | null;
}): void {
  if (!shouldSaveUserMessage(args.input, args.prepared)) return;
  mirrorDiscordMessage({
    integrations: args.deps.integrations,
    chat: args.chat,
    content: args.prepared.content || inputUserMessage(args.input),
    username: limitedDiscordName(args.persona?.name, "User"),
  });
}

function savedUserPersonaContext(saved: unknown): GenerationPersonaContext | null {
  if (!isRecord(saved)) return null;
  const snapshot = parseRecord(parseRecord(saved.extra).personaSnapshot);
  const name = readString(snapshot.name).trim();
  if (!name) return null;
  return {
    name,
    description: readString(snapshot.description),
    personality: readString(snapshot.personality),
    backstory: readString(snapshot.backstory),
    appearance: readString(snapshot.appearance),
    scenario: readString(snapshot.scenario),
    tags: [],
  };
}

function imageExtension(mimeType: string): string {
  const subtype = mimeType.split("/")[1]?.split(";")[0]?.toLowerCase() || "png";
  if (subtype === "jpeg") return "jpg";
  if (/^[a-z0-9]+$/.test(subtype)) return subtype;
  return "png";
}

function generatedImageExtension(ext: unknown, mimeType: string): string {
  const normalized = readString(ext).trim().toLowerCase().replace(/^\./, "");
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(normalized)) {
    return normalized === "jpeg" ? "jpg" : normalized;
  }
  return imageExtension(mimeType);
}

function illustrationSize(value: unknown): { width: number; height: number } {
  const text = readString(value).trim();
  const match = text.match(/^(\d{2,5})\s*x\s*(\d{2,5})$/i);
  const width = match ? readNumber(match[1], 1024) : 1024;
  const height = match ? readNumber(match[2], 768) : 768;
  return {
    width: Math.max(256, Math.min(2048, Math.trunc(width))),
    height: Math.max(256, Math.min(2048, Math.trunc(height))),
  };
}

type IllustrationPromptData = {
  agentId: string;
  prompt: string;
  reason: string;
  negativePrompt: string;
  characterNames: string[];
};

type IllustrationImageSettings = {
  connectionId: string;
  positivePrompt: string;
  negativePrompt: string;
  useAvatarReferences: boolean;
};

export const ILLUSTRATOR_TEXT_NEGATIVE_PROMPT =
  "dialogue boxes, speech bubbles, word balloons, captions, narration boxes, text boxes, manga sound effect text, SFX lettering, readable text, letters, subtitles, watermark, logo, signature";

type IllustrationReferenceSubject = {
  id: string;
  name: string;
  avatar: string;
  avatarFilePath?: string | null;
  avatarFilename?: string | null;
  spriteOwnerType: SpriteOwnerType;
};

function promptContainsTag(prompt: string, tag: string): boolean {
  const normalizedPrompt = prompt.toLowerCase();
  const normalizedTag = tag.toLowerCase();
  if (!normalizedTag) return true;
  if (normalizedPrompt.includes(normalizedTag)) return true;
  const compactTag = normalizedTag.replace(/\s+/g, " ");
  const compactPrompt = normalizedPrompt.replace(/[{}()[\]"']/g, " ").replace(/\s+/g, " ");
  return compactPrompt.includes(compactTag);
}

function appendMissingPositiveTags(prompt: string, positive: string): string {
  const basePrompt = prompt.trim();
  const tags = positive
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  if (!basePrompt || tags.length === 0) return basePrompt;

  const missing = tags.filter((tag) => !promptContainsTag(basePrompt, tag));
  return missing.length > 0 ? `${basePrompt}, ${missing.join(", ")}` : basePrompt;
}

function combinedPromptParts(parts: string[]): string {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of parts) {
    const text = part.trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result.join(", ");
}

export function buildIllustrationNegativePrompt(args: {
  itemNegativePrompt?: unknown;
  agentNegativePrompt?: unknown;
  chatIllustrationNegativePrompt?: unknown;
  chatSelfieNegativePrompt?: unknown;
}): string {
  return combinedPromptParts([
    readString(args.itemNegativePrompt).trim(),
    readString(args.agentNegativePrompt).trim(),
    readString(args.chatIllustrationNegativePrompt).trim(),
    readString(args.chatSelfieNegativePrompt).trim(),
    ILLUSTRATOR_TEXT_NEGATIVE_PROMPT,
  ]);
}

function recordName(record: JsonRecord): string {
  const data = parseRecord(record.data);
  return readString(data.name).trim() || readString(record.name).trim();
}

function recordAvatar(record: JsonRecord): string {
  const data = parseRecord(record.data);
  return readString(
    record.avatarPath ?? record.avatar ?? record.avatarUrl ?? data.avatarPath ?? data.avatar ?? data.avatarUrl,
  ).trim();
}

function matchesIllustrationSubject(subject: IllustrationReferenceSubject, item: IllustrationPromptData): boolean {
  return illustrationSubjectMatches(subject, {
    requestedNames: item.characterNames,
    prompt: item.prompt,
  });
}

async function resolveIllustrationReferenceImage(
  visuals: VisualAssetGateway | undefined,
  source: {
    image?: unknown;
    url?: unknown;
    base64?: unknown;
    mimeType?: unknown;
    avatarFilePath?: unknown;
    avatarFilename?: unknown;
  },
): Promise<string> {
  const inline =
    usableIllustrationReferenceImage(source.image) ||
    usableIllustrationReferenceImage(source.url) ||
    usableIllustrationReferenceImage(source.base64);
  if (inline) return inline;
  return (
    (visuals?.resolveReferenceImage
      ? await visuals
          .resolveReferenceImage({
            image: readString(source.image).trim() || null,
            url: readString(source.url).trim() || null,
            base64: readString(source.base64).trim() || null,
            mimeType: readString(source.mimeType).trim() || null,
            avatarFilePath: readString(source.avatarFilePath).trim() || null,
            avatarFilename: readString(source.avatarFilename).trim() || null,
          })
          .catch(() => null)
      : null) ?? ""
  );
}

async function fullBodySpriteReference(
  visuals: VisualAssetGateway | undefined,
  sprites: Array<Record<string, unknown>>,
): Promise<string> {
  const fullBody = sprites.filter((sprite) => readString(sprite.expression).trim().toLowerCase().startsWith("full_"));
  const preferred =
    fullBody.find((sprite) =>
      ["full_idle", "full_neutral", "full_default"].includes(readString(sprite.expression).trim().toLowerCase()),
    ) ?? fullBody[0];
  return preferred ? resolveIllustrationReferenceImage(visuals, preferred) : "";
}

async function defaultAgentImageConnectionId(storage: StorageGateway): Promise<string> {
  const connections = await storage.list<JsonRecord>("connections").catch(() => []);
  const connection = connections.find(
    (item) => readString(item.provider).trim() === "image_generation" && boolish(item.defaultForAgents, false),
  );
  return readString(connection?.id).trim();
}

async function illustratorAgentSettings(storage: StorageGateway, agentId: string): Promise<JsonRecord> {
  const direct = agentId ? await storage.get<JsonRecord>("agents", agentId).catch(() => null) : null;
  if (isRecord(direct)) return parseRecord(direct.settings);
  const agents = await storage.list<JsonRecord>("agents").catch(() => []);
  const agent = agents.find(
    (item) => readString(item.id).trim() === agentId || readString(item.type).trim() === "illustrator",
  );
  return isRecord(agent) ? parseRecord(agent.settings) : {};
}

export async function resolveIllustrationImageConnectionId(args: {
  storage: StorageGateway;
  chat: JsonRecord;
  agentId: string;
}): Promise<string> {
  const meta = parseRecord(args.chat.metadata);
  const settings = await illustratorAgentSettings(args.storage, args.agentId);
  return (
    readString(settings.imageConnectionId).trim() ||
    readString(meta.illustrationImageConnectionId).trim() ||
    (await defaultAgentImageConnectionId(args.storage))
  );
}

async function illustrationImageSettings(args: {
  storage: StorageGateway;
  chat: JsonRecord;
  item: IllustrationPromptData;
}): Promise<IllustrationImageSettings> {
  const meta = parseRecord(args.chat.metadata);
  const settings = await illustratorAgentSettings(args.storage, args.item.agentId);
  const connectionId = await resolveIllustrationImageConnectionId({
    storage: args.storage,
    chat: args.chat,
    agentId: args.item.agentId,
  });
  return {
    connectionId,
    positivePrompt:
      readString(settings.imagePositivePrompt).trim() || readString(meta.illustrationPositivePrompt).trim(),
    negativePrompt: buildIllustrationNegativePrompt({
      itemNegativePrompt: args.item.negativePrompt,
      agentNegativePrompt: settings.imageNegativePrompt,
      chatIllustrationNegativePrompt: meta.illustrationNegativePrompt,
      chatSelfieNegativePrompt: meta.selfieNegativePrompt,
    }),
    useAvatarReferences: illustratorAvatarReferencesEnabled(settings, meta),
  };
}

async function loadIllustrationReferenceSubjects(
  storage: StorageGateway,
  chat: JsonRecord,
): Promise<IllustrationReferenceSubject[]> {
  const characterRows = await Promise.all(
    activeCharacterIds(chat).map((id) => storage.get<JsonRecord>("characters", id).catch(() => null)),
  );
  const subjects: IllustrationReferenceSubject[] = characterRows.filter(isRecord).map((row) => ({
    id: readString(row.id).trim(),
    name: recordName(row),
    avatar: recordAvatar(row),
    avatarFilePath: readString(row.avatarFilePath ?? parseRecord(row.data).avatarFilePath).trim() || null,
    avatarFilename: readString(row.avatarFilename ?? parseRecord(row.data).avatarFilename).trim() || null,
    spriteOwnerType: "character",
  }));
  const personaId = readString(chat.personaId).trim();
  const persona = personaId ? await storage.get<JsonRecord>("personas", personaId).catch(() => null) : null;
  if (isRecord(persona)) {
    subjects.push({
      id: personaId || readString(persona.id).trim(),
      name: recordName(persona),
      avatar: recordAvatar(persona),
      avatarFilePath: readString(persona.avatarFilePath ?? parseRecord(persona.data).avatarFilePath).trim() || null,
      avatarFilename: readString(persona.avatarFilename ?? parseRecord(persona.data).avatarFilename).trim() || null,
      spriteOwnerType: "persona",
    });
  }
  return subjects.filter((subject) => subject.id && subject.name);
}

async function illustrationReferenceData(args: {
  storage: StorageGateway;
  visuals?: VisualAssetGateway;
  chat: JsonRecord;
  item: IllustrationPromptData;
  useAvatarReferences: boolean;
}): Promise<IllustrationReferenceData> {
  const subjects = await loadIllustrationReferenceSubjects(args.storage, args.chat);
  const referenceCandidates: Array<{ image: string; subjectName: string }> = [];
  const referenceSubjects = subjects.filter((subject) => matchesIllustrationSubject(subject, args.item));
  for (const subject of referenceSubjects) {
    if (!args.useAvatarReferences) continue;
    const sprites = args.visuals
      ? await args.visuals.listSprites(subject.id, subject.spriteOwnerType).catch(() => [])
      : [];
    const spriteReference = await fullBodySpriteReference(args.visuals, sprites as Array<Record<string, unknown>>);
    const reference =
      spriteReference ||
      (await resolveIllustrationReferenceImage(args.visuals, {
        image: subject.avatar,
        url: subject.avatar,
        avatarFilePath: subject.avatarFilePath,
        avatarFilename: subject.avatarFilename,
      }));
    if (reference) referenceCandidates.push({ image: reference, subjectName: subject.name });
  }
  return illustrationReferencesForRequest(referenceCandidates);
}

function promptAlreadyMentionsReferences(prompt: string): boolean {
  const text = prompt.toLowerCase();
  return (
    /\bconsult\b[\s\S]{0,80}\breference/.test(text) ||
    /\b(attached|provided|included)\s+reference/.test(text) ||
    /\breference\s+image/.test(text)
  );
}

function appendReferenceGuidance(prompt: string, subjectNames: string[]): string {
  const names = subjectNames.map((name) => name.trim()).filter(Boolean);
  if (names.length === 0) return prompt.trim();
  if (promptAlreadyMentionsReferences(prompt)) return prompt.trim();
  const label = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return [
    prompt.trim(),
    `Reference guidance: Consult the attached reference image(s) for ${label} to preserve identity, face, hair, body proportions, and distinctive visible features. Follow the scene prompt for the current outfit, pose, expression, injuries, lighting, and other moment-specific details; scene-specific appearance overrides default reference clothing.`,
  ].join("\n\n");
}

function illustrationPromptText(data: JsonRecord): string {
  return readString(
    data.prompt ??
      data.imagePrompt ??
      data.image_prompt ??
      data.positivePrompt ??
      data.positive_prompt ??
      data.promptText ??
      data.prompt_text,
  ).trim();
}

function illustrationShouldGenerate(data: JsonRecord): boolean {
  const flag =
    data.shouldGenerate ??
    data.should_generate ??
    data.generateImage ??
    data.generate_image ??
    data.createImage ??
    data.create_image ??
    data.generate;
  if (flag === undefined || flag === null) return false;
  if (typeof flag === "string" && flag.trim() === "") return false;
  return boolish(flag, false);
}

export function illustratorPromptData(result: AgentResult): IllustrationPromptData | null {
  if (result.agentType !== "illustrator" && result.type !== "image_prompt") return null;
  if (!result.success) return null;
  const data = parseRecord(result.data);
  const prompt = illustrationPromptText(data);
  if (!prompt || !illustrationShouldGenerate(data)) return null;
  return {
    agentId: result.agentId,
    prompt,
    reason: readString(data.reason ?? data.rationale ?? data.why).trim(),
    negativePrompt: readString(data.negativePrompt ?? data.negative_prompt ?? data.negative).trim(),
    characterNames: stringArray(
      data.characters ??
        data.characterNames ??
        data.character_names ??
        data.visibleCharacters ??
        data.visible_characters,
    ),
  };
}

function isIllustratorResult(result: AgentResult): boolean {
  return result.agentType === "illustrator" || result.type === "image_prompt";
}

function manualIllustratorFallbackPrompt(target: JsonRecord | null): string {
  const content = readString(target?.content).replace(/\s+/g, " ").trim();
  if (!content) return "";
  return ["Illustrate the selected roleplay message as a visual scene.", `Selected message: ${content}`].join("\n\n");
}

function manualIllustratorFallbackResult(args: {
  target: JsonRecord | null;
  illustratorManualRequest: boolean;
  agentTypes: ReadonlySet<string>;
  results: readonly AgentResult[];
}): AgentResult | null {
  if (!args.target || !args.illustratorManualRequest || !args.agentTypes.has("illustrator")) return null;
  if (args.results.some((result) => illustratorPromptData(result) !== null)) return null;
  const illustratorResults = args.results.filter(isIllustratorResult);
  if (illustratorResults.length === 0 || illustratorResults.some((result) => !result.success)) return null;
  const prompt = manualIllustratorFallbackPrompt(args.target);
  if (!prompt) return null;
  const source = illustratorResults[0];
  return {
    agentId: source?.agentId || "illustrator",
    agentType: "illustrator",
    type: "image_prompt",
    data: {
      shouldGenerate: true,
      reason: "Manual paintbrush fallback from the selected message.",
      prompt,
    },
    tokensUsed: 0,
    durationMs: 0,
    success: true,
    error: null,
  };
}

export function shouldReturnManualIllustratorRetryWithoutCommit(args: {
  hasTarget: boolean;
  illustratorManualRequest: boolean;
  agentTypes: ReadonlySet<string>;
  results: readonly AgentResult[];
}): boolean {
  if (!args.hasTarget || !args.illustratorManualRequest || !args.agentTypes.has("illustrator")) return false;
  if (args.results.some((result) => illustratorPromptData(result) !== null)) return false;
  return args.results.every((result) => result.agentType === "illustrator");
}

async function generateIllustrationAttachments(args: {
  deps: GenerationEngineDeps;
  chat: JsonRecord;
  results: AgentResult[];
  signal?: AbortSignal;
}): Promise<{ attachments: JsonRecord[]; events: GenerationEvent[] }> {
  const attachments: JsonRecord[] = [];
  const events: GenerationEvent[] = [];
  const meta = parseRecord(args.chat.metadata);
  const prompts = args.results.map(illustratorPromptData).filter((value): value is IllustrationPromptData => !!value);
  if (prompts.length === 0) return { attachments, events };

  if (!args.deps.integrations?.image) {
    events.push({ type: "illustration_error", data: { error: "Image generation is not available." } });
    return { attachments, events };
  }

  const size = illustrationSize(meta.illustrationResolution ?? meta.selfieResolution);
  for (let index = 0; index < prompts.length; index += 1) {
    throwIfAborted(args.signal);
    const item = prompts[index]!;
    try {
      const settings = await illustrationImageSettings({ storage: args.deps.storage, chat: args.chat, item });
      if (!settings.connectionId) {
        events.push({
          type: "illustration_error",
          data: { error: "No image generation connection configured for the Illustrator agent." },
        });
        continue;
      }
      const referenceData = await illustrationReferenceData({
        storage: args.deps.storage,
        visuals: args.deps.visuals,
        chat: args.chat,
        item,
        useAvatarReferences: settings.useAvatarReferences,
      });
      const prompt = appendReferenceGuidance(
        appendMissingPositiveTags(item.prompt, settings.positivePrompt),
        referenceData.referenceSubjectNames,
      );
      const imageRequest = {
        connectionId: settings.connectionId,
        kind: "illustration",
        reviewId: `illustration:${readString(args.chat.id)}:${index}`,
        reviewTitle: "Scene illustration",
        prompt,
        negativePrompt: settings.negativePrompt || undefined,
        width: size.width,
        height: size.height,
        ...(referenceData.referenceImages.length > 0 ? { referenceImages: referenceData.referenceImages } : {}),
      };
      if (illustrationImageRequestWireBytes(imageRequest) > 16 * 1024 * 1024) {
        throw new Error("Illustration reference payload is too large for the remote runtime request.");
      }
      const image = await args.deps.integrations.image.generate<{
        base64?: string;
        mimeType?: string;
        image?: string;
        ext?: string;
        provider?: string;
        model?: string;
      }>(imageRequest);
      throwIfAborted(args.signal);
      const mimeType = image.mimeType || "image/png";
      const base64 = readString(image.base64).trim();
      const imageUrl = readString(image.image).trim() || (base64 ? `data:${mimeType};base64,${base64}` : "");
      if (!imageUrl) throw new Error("Image provider returned no image data.");

      const filename = `illustration_${Date.now()}_${index + 1}.${generatedImageExtension(image.ext, mimeType)}`;
      const gallery = await args.deps.storage.create<JsonRecord>("gallery", {
        chatId: readString(args.chat.id),
        filePath: filename,
        filename,
        url: imageUrl,
        prompt,
        provider: image.provider ?? "image_generation",
        model: image.model ?? null,
        width: size.width,
        height: size.height,
        kind: "illustration",
        characters:
          referenceData.referenceSubjectNames.length > 0 ? referenceData.referenceSubjectNames : item.characterNames,
        referenceImageCount: referenceData.referenceImages.length,
      });
      const storedImageUrl = readString(gallery.url).trim() || imageUrl;
      const attachment = {
        type: "image",
        url: storedImageUrl,
        filename,
        prompt,
        galleryId: readString(gallery.id) || null,
      };
      attachments.push(attachment);
      events.push({
        type: "illustration",
        data: {
          imageUrl: storedImageUrl,
          prompt,
          reason: item.reason,
          galleryId: readString(gallery.id) || null,
        },
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      events.push({
        type: "illustration_error",
        data: { error: error instanceof Error ? error.message : "Illustration generation failed." },
      });
    }
  }

  return { attachments, events };
}

interface TrackerAvatarImageSettings {
  connectionId: string;
  positivePrompt: string;
  negativePrompt: string;
}

function isCharacterTrackerResult(result: AgentResult): boolean {
  return result.agentType === "character-tracker" || result.type === "character_tracker_update";
}

async function agentSettingsByType(storage: StorageGateway, agentId: string, agentType: string): Promise<JsonRecord> {
  const direct = agentId ? await storage.get<JsonRecord>("agents", agentId).catch(() => null) : null;
  if (isRecord(direct)) return parseRecord(direct.settings);
  const fallback = await storage.get<JsonRecord>("agents", agentType).catch(() => null);
  if (isRecord(fallback)) return parseRecord(fallback.settings);
  const agents = await storage.list<JsonRecord>("agents").catch(() => []);
  const agent = agents.find(
    (item) => readString(item.id).trim() === agentType || readString(item.type).trim() === agentType,
  );
  return isRecord(agent) ? parseRecord(agent.settings) : {};
}

async function trackerAvatarImageSettings(args: {
  storage: StorageGateway;
  chat: JsonRecord;
  result: AgentResult;
}): Promise<TrackerAvatarImageSettings | null> {
  const settings = await agentSettingsByType(args.storage, args.result.agentId, "character-tracker");
  if (!boolish(settings.autoGenerateAvatars, false)) return null;
  const meta = parseRecord(args.chat.metadata);
  const connectionId =
    readString(settings.imageConnectionId).trim() ||
    readString(meta.characterTrackerImageConnectionId).trim() ||
    readString(meta.imageGenConnectionId).trim() ||
    (await defaultAgentImageConnectionId(args.storage));
  return {
    connectionId,
    positivePrompt: readString(settings.imagePositivePrompt).trim(),
    negativePrompt: combinedPromptParts([
      readString(settings.imageNegativePrompt).trim(),
      readString(meta.selfieNegativePrompt).trim(),
    ]),
  };
}

function trackerAvatarLookupKey(kind: "id" | "name", value: unknown): string {
  const text = readString(value).trim().toLowerCase();
  return text ? `${kind}:${text}` : "";
}

function addTrackerAvatarLookupEntry(lookup: Map<string, string>, character: JsonRecord, avatarPath: string): void {
  const avatar = avatarPath.trim();
  if (!avatar) return;
  const idKey = trackerAvatarLookupKey("id", character.characterId ?? character.id);
  const nameKey = trackerAvatarLookupKey("name", character.name);
  if (idKey) lookup.set(idKey, avatar);
  if (nameKey) lookup.set(nameKey, avatar);
}

function trackerAvatarLookup(snapshot?: GameState | null): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const character of snapshot?.presentCharacters ?? []) {
    const record = character as unknown as JsonRecord;
    const avatarPath = readString(record.avatarPath).trim();
    addTrackerAvatarLookupEntry(lookup, record, avatarPath);
  }
  return lookup;
}

function existingTrackerAvatarPath(lookup: Map<string, string>, character: JsonRecord): string {
  const idKey = trackerAvatarLookupKey("id", character.characterId ?? character.id);
  if (idKey && lookup.has(idKey)) return lookup.get(idKey) ?? "";
  const nameKey = trackerAvatarLookupKey("name", character.name);
  return nameKey ? (lookup.get(nameKey) ?? "") : "";
}

function trackerAvatarPrompt(character: JsonRecord, positivePrompt: string): string {
  const name = readString(character.name).trim();
  const appearance = readString(character.appearance).trim();
  const outfit = readString(character.outfit).trim();
  const mood = readString(character.mood ?? character.expression).trim();
  return [
    `Portrait avatar of ${name}.`,
    `Appearance: ${appearance}.`,
    outfit ? `Outfit: ${outfit}.` : "",
    mood ? `Expression or mood: ${mood}.` : "",
    "Centered bust portrait, expressive face, clean background, high detail, polished character art.",
    positivePrompt,
  ]
    .filter((part) => part.trim().length > 0)
    .join(" ");
}

function imageDataUrlFromGeneratedImage(image: { base64?: unknown; mimeType?: unknown; image?: unknown }): string {
  const direct = readString(image.image).trim();
  if (direct) return direct;
  const base64 = readString(image.base64).trim();
  if (!base64) return "";
  const mimeType = readString(image.mimeType).trim() || "image/png";
  return `data:${mimeType};base64,${base64}`;
}

function shouldGenerateTrackerAvatar(character: JsonRecord): boolean {
  if (readString(character.avatarPath).trim()) return false;
  if (!readString(character.name).trim()) return false;
  if (!readString(character.appearance).trim()) return false;
  const characterId = readString(character.characterId ?? character.id).trim();
  return !characterId.startsWith("manual-");
}

async function generatedTrackerAvatarPath(args: {
  deps: GenerationEngineDeps;
  chatId: string;
  character: JsonRecord;
  settings: TrackerAvatarImageSettings;
  index: number;
  signal?: AbortSignal;
}): Promise<string> {
  if (!args.deps.visuals?.uploadNpcAvatar) return "";
  const name = readString(args.character.name).trim();
  const prompt = trackerAvatarPrompt(args.character, args.settings.positivePrompt);
  const image = await args.deps.integrations.image.generate<{
    base64?: string;
    mimeType?: string;
    image?: string;
  }>({
    connectionId: args.settings.connectionId,
    kind: "avatar",
    reviewId: `tracker-avatar:${args.chatId}:${args.index}:${name}`,
    reviewTitle: `NPC avatar: ${name}`,
    prompt,
    negativePrompt: args.settings.negativePrompt || undefined,
    width: 768,
    height: 1024,
  });
  throwIfAborted(args.signal);
  const imageUrl = imageDataUrlFromGeneratedImage(image);
  if (!imageUrl) throw new Error("Image provider returned no avatar image data.");
  const upload = await args.deps.visuals.uploadNpcAvatar(args.chatId, name, imageUrl);
  return readString(upload.avatarPath).trim();
}

async function generateTrackerAvatarsForResults(args: {
  deps: GenerationEngineDeps;
  chat: JsonRecord;
  results: AgentResult[];
  baseline?: GameState | null;
  signal?: AbortSignal;
}): Promise<AgentResult[]> {
  if (!args.deps.integrations?.image || !args.deps.visuals?.uploadNpcAvatar) return args.results;
  if (!args.results.some(isCharacterTrackerResult)) return args.results;
  const chatId = readString(args.chat.id).trim();
  if (!chatId) return args.results;
  const lookup = trackerAvatarLookup(args.baseline);
  const settingsCache = new Map<string, TrackerAvatarImageSettings | null>();
  let changedAny = false;

  const nextResults: AgentResult[] = [];
  for (const result of args.results) {
    if (!result.success || !isCharacterTrackerResult(result)) {
      nextResults.push(result);
      continue;
    }
    const data = parseRecord(result.data);
    if (!Array.isArray(data.presentCharacters)) {
      nextResults.push(result);
      continue;
    }

    const settingsKey = readString(result.agentId).trim() || result.agentType;
    if (!settingsCache.has(settingsKey)) {
      settingsCache.set(
        settingsKey,
        await trackerAvatarImageSettings({ storage: args.deps.storage, chat: args.chat, result }),
      );
    }
    const settings = settingsCache.get(settingsKey) ?? null;
    if (!settings?.connectionId) {
      nextResults.push(result);
      continue;
    }

    let changedResult = false;
    const presentCharacters = data.presentCharacters.map((value) => {
      const character = parseRecord(value);
      const preservedAvatar = existingTrackerAvatarPath(lookup, character);
      if (preservedAvatar && !readString(character.avatarPath).trim()) {
        changedResult = true;
        return { ...character, avatarPath: preservedAvatar };
      }
      if (readString(character.avatarPath).trim()) {
        addTrackerAvatarLookupEntry(lookup, character, readString(character.avatarPath).trim());
      }
      return value;
    });

    for (let index = 0; index < presentCharacters.length; index += 1) {
      throwIfAborted(args.signal);
      const character = parseRecord(presentCharacters[index]);
      if (!shouldGenerateTrackerAvatar(character)) continue;
      const existingAvatar = existingTrackerAvatarPath(lookup, character);
      if (existingAvatar) {
        presentCharacters[index] = { ...character, avatarPath: existingAvatar };
        changedResult = true;
        continue;
      }
      try {
        const avatarPath = await generatedTrackerAvatarPath({
          deps: args.deps,
          chatId,
          character,
          settings,
          index,
          signal: args.signal,
        });
        if (!avatarPath) continue;
        const nextCharacter = { ...character, avatarPath };
        presentCharacters[index] = nextCharacter;
        addTrackerAvatarLookupEntry(lookup, nextCharacter, avatarPath);
        changedResult = true;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        console.warn("[generation] tracker avatar generation failed", error);
      }
    }

    if (changedResult) {
      changedAny = true;
      nextResults.push({ ...result, data: { ...data, presentCharacters } });
    } else {
      nextResults.push(result);
    }
  }

  return changedAny ? nextResults : args.results;
}

async function mirrorSavedAssistantMessageToDiscord(args: {
  deps: GenerationEngineDeps;
  chat: JsonRecord;
  characters: GenerationCharacterContext[];
  input: StartGenerationInput;
  saved: unknown;
  content: string;
}): Promise<void> {
  if (args.input.impersonate === true || readString(args.input.regenerateMessageId).trim()) return;
  const username = await assistantDiscordName({
    storage: args.deps.storage,
    chat: args.chat,
    saved: args.saved,
    characters: args.characters,
  });
  mirrorDiscordMessage({
    integrations: args.deps.integrations,
    chat: args.chat,
    content: args.content,
    username,
  });
}

async function inputWithStoredGenerationReplay(
  storage: StorageGateway,
  chat: JsonRecord,
  chatId: string,
  input: StartGenerationInput,
): Promise<StartGenerationInput> {
  const regenerateMessageId = readString(input.regenerateMessageId).trim();
  if (!regenerateMessageId) return input;

  const target = await storage.get("messages", regenerateMessageId).catch(() => null);
  if (!isRecord(target) || readString(target.chatId).trim() !== chatId) return input;

  const targetExtra = parseRecord(target.extra);
  const nextInput = { ...input };
  let applied = applyCachedContextInjectionsToRegenerateInput(nextInput, targetExtra.contextInjections);

  const replay = normalizeGenerationReplay(targetExtra.generationReplay);
  if (replay) {
    const currentFingerprint = fingerprintChatSummary(chatSummaryForGeneration(chat));
    if (chatSummaryFingerprintMatches(targetExtra, currentFingerprint)) {
      applied = applyGenerationReplayToRegenerateInput(nextInput, replay) || applied;
    }
  }

  return applied ? nextInput : input;
}

function requestMessages(input: StartGenerationInput): LlmMessage[] | null {
  if (!Array.isArray(input.messages) || input.messages.length === 0) return null;
  return input.messages
    .map(
      (message): LlmMessage => ({
        role: message.role === "system" || message.role === "assistant" ? message.role : "user",
        content: readString(message.content).trim(),
      }),
    )
    .filter((message) => message.content.length > 0);
}

function resolveGenerationPromptTimeZone(chat: JsonRecord, input: StartGenerationInput): string | undefined {
  const persisted = normalizeUserTimeZone(parseRecord(chat.metadata).promptTimeZone);
  if (persisted) return persisted;
  const fromInput = normalizeUserTimeZone(input.userTimeZone);
  if (fromInput) return fromInput;
  try {
    return normalizeUserTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return undefined;
  }
}

function mergeSummaryEntries<T extends DaySummaryEntry | WeekSummaryEntry>(
  current: unknown,
  patch: Record<string, T>,
): Record<string, T> {
  const currentRecord = isRecord(current) ? (current as Record<string, T>) : {};
  return { ...currentRecord, ...patch };
}

function chatWithBackfilledSummaries(chat: JsonRecord, result: ConversationSummaryBackfillResult): JsonRecord {
  if (result.generatedDays.length === 0 && result.consolidatedWeeks.length === 0) return chat;
  const metadata = parseRecord(chat.metadata);
  return {
    ...chat,
    metadata: {
      ...metadata,
      daySummaries: mergeSummaryEntries(metadata.daySummaries, result.generatedDaySummaries),
      weekSummaries: mergeSummaryEntries(metadata.weekSummaries, result.consolidatedWeekSummaries),
    },
  };
}

async function prepareConversationSummariesForGeneration(
  deps: GenerationEngineDeps,
  chat: JsonRecord,
  input: StartGenerationInput,
  connection: JsonRecord,
  signal?: AbortSignal,
): Promise<JsonRecord> {
  if (readString(chat.mode || chat.chatMode, "conversation") !== "conversation") return chat;
  const chatId = readString(chat.id).trim() || readString(input.chatId).trim();
  const result = await backfillConversationSummaries(
    { storage: deps.storage, llm: deps.llm },
    {
      chatId,
      connectionId: readString(connection.id).trim() || readString(input.connectionId).trim() || null,
      timeZone: resolveGenerationPromptTimeZone(chat, input),
      signal,
    },
  );
  if (result.generatedDays.length === 0 && result.consolidatedWeeks.length === 0) return chat;
  const refreshed = await deps.storage.get<JsonRecord>("chats", chatId).catch(() => null);
  return chatWithBackfilledSummaries(isRecord(refreshed) ? refreshed : chat, result);
}

function generationMessageLoadOptions(chat: JsonRecord, input: StartGenerationInput): ChatMessageListOptions {
  const chatLimit = readNumber(parseRecord(chat.metadata).contextMessageLimit, 0);
  const requestedLimit = readNumber(input.historyLimit, DEFAULT_GENERATION_HISTORY_LIMIT);
  const historyLimit = Math.max(
    1,
    Math.min(DEFAULT_GENERATION_HISTORY_LIMIT, chatLimit || requestedLimit || DEFAULT_GENERATION_HISTORY_LIMIT),
  );
  return {
    limit: Math.max(
      MIN_GENERATION_MESSAGE_LOAD_LIMIT,
      Math.min(MAX_GENERATION_MESSAGE_LOAD_LIMIT, historyLimit + GENERATION_MESSAGE_LOAD_MARGIN),
    ),
  };
}

function messageCursor(message: JsonRecord): string | null {
  const createdAt = readString(message.createdAt).trim();
  const id = readString(message.id).trim();
  return createdAt && id ? `${createdAt}|${id}` : null;
}

function targetBelongsToChat(target: JsonRecord | null, chatId: string): target is JsonRecord {
  return !!target && readString(target.chatId).trim() === chatId;
}

export async function loadMessagesForGenerationTarget(args: {
  storage: StorageGateway;
  chatId: string;
  chat: JsonRecord;
  characters?: GenerationCharacterContext[];
  input: StartGenerationInput;
  targetMessageId?: string | null;
}): Promise<JsonRecord[]> {
  const options = generationMessageLoadOptions(args.chat, args.input);
  const targetId = readString(args.targetMessageId ?? args.input.regenerateMessageId).trim();
  if (!targetId) return loadChatMessages(args.storage, args.chatId, options);

  const target = await loadChatMessage(args.storage, targetId).catch(() => null);
  if (!targetBelongsToChat(target, args.chatId)) return loadChatMessages(args.storage, args.chatId, options);

  const before = messageCursor(target);
  if (!before) return loadChatMessages(args.storage, args.chatId, options);

  const previousMessages = await loadChatMessages(args.storage, args.chatId, { ...options, before });
  return [...previousMessages, target];
}

function storedMessageImageDataUrls(message: JsonRecord): string[] {
  return Array.isArray(message.images)
    ? message.images.filter((image): image is string => typeof image === "string" && image.trim().length > 0)
    : [];
}

function hasStoredPromptImages(messages: JsonRecord[]): boolean {
  return messages.some((message) => storedMessageImageDataUrls(message).length > 0);
}

async function resolveStoredImageAttachmentsForPrompt(
  storage: StorageGateway,
  messages: JsonRecord[],
  skipMessageIds: Set<string> = new Set(),
): Promise<StoredImageAttachmentDelivery> {
  const warnings: ImageAttachmentDeliveryWarning[] = [];
  let changed = false;
  const resolvedMessages: JsonRecord[] = [];

  for (const message of messages) {
    const messageId = readString(message.id).trim();
    const role = readString(message.role).trim();
    const attachments = promptAttachmentsFromExtra(message.extra);
    if (role !== "user" || (messageId && skipMessageIds.has(messageId)) || !attachments?.some(isImageAttachment)) {
      resolvedMessages.push(message);
      continue;
    }

    const delivery = await resolveImageAttachmentDelivery(storage, attachments);
    warnings.push(...delivery.warnings);
    if (delivery.images.length === 0) {
      resolvedMessages.push(message);
      continue;
    }

    changed = true;
    resolvedMessages.push({
      ...message,
      images: [...storedMessageImageDataUrls(message), ...delivery.images],
    });
  }

  return { messages: changed ? resolvedMessages : messages, warnings };
}

function imageAttachmentConnectionWarnings(connection: JsonRecord): ImageAttachmentDeliveryWarning[] {
  const provider = readString(connection.provider).trim();
  if (provider === "claude_subscription") {
    return [
      imageAttachmentConnectionWarning(
        "Image attachments could not be delivered through the Claude subscription path. Use an image-capable API provider or remove the attachment.",
      ),
    ];
  }

  const capabilities = parseRecord(connection.capabilities);
  if (capabilities.vision === false) {
    const model = readString(connection.model).trim() || readString(connection.name).trim() || "The selected model";
    return [
      imageAttachmentConnectionWarning(
        `${model} is marked as not vision-capable, so image attachments were not delivered to the character.`,
      ),
    ];
  }

  return [];
}

function applyStoredImageAttachmentConnectionSupport(
  messages: JsonRecord[],
  connection: JsonRecord,
): StoredImageAttachmentDelivery {
  if (!hasStoredPromptImages(messages)) return { messages, warnings: [] };
  const warnings = imageAttachmentConnectionWarnings(connection);
  if (warnings.length === 0) return { messages, warnings };
  return {
    messages: messages.map((message) =>
      storedMessageImageDataUrls(message).length > 0 ? { ...message, images: [] } : message,
    ),
    warnings,
  };
}
function imageAttachmentConnectionWarning(message: string): ImageAttachmentDeliveryWarning {
  return {
    code: "image_attachment_delivery",
    severity: "warning",
    agentNames: [],
    message,
  };
}

function applyImageAttachmentConnectionSupport(
  prepared: PreparedUserInput,
  connection: JsonRecord,
): ImageAttachmentDeliveryWarning[] {
  if (prepared.images.length === 0) return [];
  const warnings = imageAttachmentConnectionWarnings(connection);
  if (warnings.length > 0) prepared.images = [];
  return warnings;
}

function withImageAttachments(messages: LlmMessage[], images: string[]): LlmMessage[] {
  if (images.length === 0 || messages.length === 0) return messages;
  const next = messages.map((message) => ({ ...message }));
  let targetIndex = -1;
  for (let index = next.length - 1; index >= 0; index -= 1) {
    if (next[index]?.role === "user") {
      targetIndex = index;
      break;
    }
  }
  if (targetIndex < 0) {
    next.push({ role: "user", content: "", images });
  } else {
    next[targetIndex] = {
      ...next[targetIndex]!,
      images: [...(next[targetIndex]!.images ?? []), ...images],
    };
  }
  return next;
}

function impersonatePromptTemplate(input: StartGenerationInput, chat: JsonRecord): string | null {
  const requestPrompt = readString(input.impersonatePromptTemplate).trim();
  if (requestPrompt) return requestPrompt;
  const chatPrompt = readString(parseRecord(chat.metadata).impersonatePrompt).trim();
  return chatPrompt || null;
}

function directiveMessages(
  input: StartGenerationInput,
  chat: JsonRecord,
  characters: GenerationCharacterContext[],
  persona: GenerationPersonaContext | null,
  prepared: PreparedUserInput,
  options: { continueAssistantResponse?: boolean } = {},
): LlmMessage[] {
  const messages: LlmMessage[] = [];
  if (input.impersonate === true) {
    const personaName = readString(persona?.name).trim() || "User";
    messages.push({
      role: "user",
      content: buildImpersonateInstruction({
        customPrompt: impersonatePromptTemplate(input, chat),
        direction: prepared.content,
        personaName,
        personaDescription: persona?.description,
      }),
    });
    return messages;
  }

  const forCharacterId = readString(input.forCharacterId).trim();
  const chatMode = readString(chat.mode || chat.chatMode);
  if (forCharacterId && chatMode === "conversation") {
    const character = characters.find((candidate) => candidate.id === forCharacterId);
    messages.push({
      role: "user",
      content: character?.name
        ? `[Generation instruction: respond as ${character.name}.]`
        : `[Generation instruction: respond as the requested character.]`,
    });
  }

  if (prepared.mentionedCharacterNames.length) {
    messages.push({
      role: "user",
      content: `[Generation instruction: the user's latest message explicitly mentioned ${prepared.mentionedCharacterNames.join(", ")}. Prioritize those character voices when selecting who responds.]`,
    });
  }
  if (options.continueAssistantResponse === true) {
    messages.push({
      role: "user",
      content: CONTINUE_ASSISTANT_RESPONSE_INSTRUCTION,
    });
  }
  return messages;
}

function visibleTranscript(messages: JsonRecord[]): string {
  return messages
    .filter((message) => !hiddenFromAi(message))
    .slice(-24)
    .map((message) => `${readString(message.role, "message")}: ${readString(message.content)}`)
    .join("\n");
}

function messagesBeforeRegenerationTarget(
  storedMessages: JsonRecord[],
  regenerateMessageId: string | null | undefined,
): JsonRecord[] {
  const targetId = readString(regenerateMessageId).trim();
  if (!targetId) return storedMessages;
  const targetIndex = storedMessages.findIndex((message) => readString(message.id) === targetId);
  return targetIndex >= 0 ? storedMessages.slice(0, targetIndex) : storedMessages;
}

function regenerationTargetFromMessages(
  storedMessages: JsonRecord[],
  regenerateMessageId: string | null | undefined,
): JsonRecord | null {
  const targetId = readString(regenerateMessageId).trim();
  if (!targetId) return null;
  return storedMessages.find((message) => readString(message.id) === targetId) ?? null;
}

function isUserRegenerationTarget(target: JsonRecord | null): target is JsonRecord {
  return readString(target?.role).trim() === "user";
}

function connectedCommandPassthrough(content: string): ConnectedCommandResult {
  return {
    displayContent: content,
    createdNotes: [],
    executedCommands: [],
    events: [],
    assistantAttachments: [],
    suppressAssistantMessage: false,
  };
}

async function loadFullRegenerationTarget(
  storage: StorageGateway,
  chatId: string,
  target: JsonRecord | null,
): Promise<JsonRecord | null> {
  const targetId = readString(target?.id).trim();
  if (!targetId) return null;
  const loaded = await storage.get<unknown>("messages", targetId);
  if (!isRecord(loaded)) {
    throw new Error("Cannot regenerate user message because its full source record was not found");
  }
  if (!targetBelongsToChat(loaded, chatId)) {
    throw new Error("Cannot regenerate user message because its full source record belongs to another chat");
  }
  return loaded;
}

async function userMessageRegenerationSourceMessage(
  storage: StorageGateway,
  chatId: string,
  target: JsonRecord | null,
): Promise<SimplePromptMessage | null> {
  if (!isUserRegenerationTarget(target)) return null;
  if (hiddenFromAi(target)) throw new Error("Cannot regenerate a message hidden from AI");

  const fullTarget = await loadFullRegenerationTarget(storage, chatId, target);
  if (!fullTarget) return null;
  if (hiddenFromAi(fullTarget)) throw new Error("Cannot regenerate a message hidden from AI");

  const attachments = promptAttachmentsFromExtra(fullTarget.extra);
  const imageDelivery = await resolveImageAttachmentDelivery(storage, attachments);
  const source = buildUserMessageRegenerationSourceMessage(fullTarget, imageDelivery.images);
  return source.content.trim() || source.images?.length ? source : null;
}

function withUserMessageRegenerationRewritePrompt(
  messages: LlmMessage[],
  source: SimplePromptMessage | null,
): LlmMessage[] {
  if (!source) return messages;
  return [...messages, buildUserMessageRegenerationPromptFromSource(source)];
}

async function regenerationTargetExtra(
  storage: StorageGateway,
  chatId: string,
  storedMessages: JsonRecord[],
  regenerateMessageId: string | null | undefined,
): Promise<unknown> {
  const targetId = readString(regenerateMessageId).trim();
  if (!targetId) return undefined;
  const loadedTarget = storedMessages.find((message) => readString(message.id) === targetId);
  if (loadedTarget) return loadedTarget.extra;
  const target = await loadChatMessage(storage, targetId);
  return targetBelongsToChat(target, chatId) ? target.extra : undefined;
}

function roleplayIndividualGroupCharacterIds(chat: JsonRecord): string[] {
  if (readString(chat.mode || chat.chatMode) !== "roleplay") return [];
  const ids = activeCharacterIds(chat);
  if (ids.length <= 1) return [];
  return readString(parseRecord(chat.metadata).groupChatMode, "merged") === "individual" ? ids : [];
}

function conversationGroupCharacterIds(chat: JsonRecord): string[] {
  if (readString(chat.mode || chat.chatMode) !== "conversation") return [];
  const ids = activeCharacterIds(chat);
  return ids.length > 1 ? ids : [];
}

function targetedGroupCharacterIds(chat: JsonRecord): string[] {
  const roleplayIds = roleplayIndividualGroupCharacterIds(chat);
  return roleplayIds.length > 0 ? roleplayIds : conversationGroupCharacterIds(chat);
}

function lastVisibleAssistantCharacterId(messages: JsonRecord[], activeIds: string[]): string | null {
  const active = new Set(activeIds);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || hiddenFromAi(message)) continue;
    if (readString(message.role) !== "assistant") continue;
    const characterId = readString(message.characterId).trim();
    if (active.has(characterId)) return characterId;
  }
  return null;
}

function sequentialGroupTarget(messages: JsonRecord[], activeIds: string[]): string | null {
  if (activeIds.length === 0) return null;
  const lastCharacterId = lastVisibleAssistantCharacterId(messages, activeIds);
  if (!lastCharacterId) return activeIds[0] ?? null;
  const index = activeIds.indexOf(lastCharacterId);
  return activeIds[(index + 1) % activeIds.length] ?? activeIds[0] ?? null;
}

function sequentialGroupTurnOrder(messages: JsonRecord[], activeIds: string[]): string[] {
  if (activeIds.length === 0) return [];
  const lastCharacterId = lastVisibleAssistantCharacterId(messages, activeIds);
  const lastIndex = lastCharacterId ? activeIds.indexOf(lastCharacterId) : -1;
  const start = lastIndex >= 0 ? (lastIndex + 1) % activeIds.length : 0;
  return activeIds.map((_, offset) => activeIds[(start + offset) % activeIds.length]!);
}

function activeSwipeCharacterId(message: JsonRecord | undefined): string | null {
  if (!message) return null;
  const rawSwipes = Array.isArray(message.swipes)
    ? message.swipes
    : Array.isArray(message.swipePreviews)
      ? message.swipePreviews
      : [];
  if (rawSwipes.length === 0) return null;
  const requestedIndex = Math.max(0, Math.trunc(readNumber(message.activeSwipeIndex, 0)));
  const activeIndex = Math.min(requestedIndex, rawSwipes.length - 1);
  const characterId = readString(parseRecord(rawSwipes[activeIndex]).characterId).trim();
  return characterId || null;
}

function explicitGroupTarget(
  input: StartGenerationInput,
  storedMessages: JsonRecord[],
  activeIds: string[],
): string | null {
  const active = new Set(activeIds);
  const requestedCharacterId = readString(input.forCharacterId).trim();
  if (requestedCharacterId && active.has(requestedCharacterId)) return requestedCharacterId;

  const regenerateMessageId = readString(input.regenerateMessageId).trim();
  if (!regenerateMessageId) return null;
  const target = storedMessages.find((message) => readString(message.id) === regenerateMessageId);
  const targetCharacterId = readString(activeSwipeCharacterId(target) ?? target?.characterId).trim();
  return active.has(targetCharacterId) ? targetCharacterId : null;
}

function continuationGroupTarget(args: {
  input: StartGenerationInput;
  latestUserInput: string;
  storedMessages: JsonRecord[];
  activeIds: string[];
}): string | null {
  if (readString(args.input.regenerateMessageId).trim()) return null;
  if (args.latestUserInput.trim()) return null;
  return lastVisibleAssistantCharacterId(args.storedMessages, args.activeIds);
}

type SmartResponderCandidate = {
  id: string;
  name: string;
  description: string;
  personality: string;
  talkativeness: number | null;
};

function compactPromptLine(value: unknown, limit = 260): string {
  const text = collapseExcessBlankLines(readString(value)).replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 3).trimEnd()}...` : text;
}

function characterDataRecord(record: JsonRecord): JsonRecord {
  const data = parseRecord(record.data);
  return Object.keys(data).length > 0 ? data : record;
}

async function loadSmartResponderCandidates(
  storage: StorageGateway,
  activeIds: string[],
): Promise<SmartResponderCandidate[]> {
  const rows = await Promise.all(activeIds.map((id) => storage.get<JsonRecord>("characters", id).catch(() => null)));
  return rows
    .map((row, index): SmartResponderCandidate | null => {
      if (!isRecord(row)) return null;
      const data = characterDataRecord(row);
      const name = readString(data.name).trim() || readString(row.name).trim() || `Character ${index + 1}`;
      return {
        id: activeIds[index]!,
        name,
        description: compactPromptLine(data.description),
        personality: compactPromptLine(data.personality),
        talkativeness: data.talkativeness == null ? null : readNumber(data.talkativeness, 0),
      };
    })
    .filter((candidate): candidate is SmartResponderCandidate => candidate !== null);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentionedSmartResponderIds(args: {
  candidates: SmartResponderCandidate[];
  latestUserInput: string;
  mentionedNames: string[];
}): string[] {
  const mentioned = new Set(args.mentionedNames.map((name) => name.trim().toLowerCase()).filter(Boolean));
  const latest = args.latestUserInput;
  const ids: string[] = [];
  for (const candidate of args.candidates) {
    const lowerName = candidate.name.toLowerCase();
    const explicitlyMentioned = mentioned.has(lowerName);
    const atMentioned = new RegExp(`(^|\\s)@${escapeRegExp(candidate.name)}(?=\\s|$|[,.!?;:])`, "i").test(latest);
    if (explicitlyMentioned || atMentioned) ids.push(candidate.id);
  }
  return ids;
}

function smartSelectorTranscript(messages: JsonRecord[]): string {
  return messages
    .filter((message) => !hiddenFromAi(message))
    .slice(-12)
    .map((message) => {
      const role = readString(message.role, "message");
      const name = readString(message.displayName || message.name || message.characterName).trim();
      const prefix = name ? `${role} (${name})` : role;
      return `${prefix}: ${compactPromptLine(message.content, 500)}`;
    })
    .join("\n");
}

function parseSmartGroupSelectionIds(raw: string, validIds: string[]): string[] {
  const valid = new Set(validIds);
  const { cleanText: stripped } = extractLeadingThinkingBlocks(raw);
  let text = stripped.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) text = fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  try {
    const parsed = JSON.parse(text) as JsonRecord;
    const ids = stringArray(parsed.characterIds ?? parsed.character_ids ?? parsed.characters);
    return [...new Set(ids.filter((id) => valid.has(id)))];
  } catch {
    return validIds.filter((id) => stripped.includes(id)).slice(0, 3);
  }
}

async function smartRoleplayGroupTarget(args: {
  deps: GenerationEngineDeps;
  input: StartGenerationInput;
  chat: JsonRecord;
  connection: JsonRecord;
  storedMessages: JsonRecord[];
  latestUserInput: string;
  mentionedNames: string[];
  activeIds: string[];
  signal?: AbortSignal;
}): Promise<string | null> {
  return (
    (
      await smartRoleplayGroupTargets({
        ...args,
        selectionMode: "single",
      })
    )[0] ?? null
  );
}

async function smartRoleplayGroupTargets(args: {
  deps: GenerationEngineDeps;
  input: StartGenerationInput;
  chat: JsonRecord;
  connection: JsonRecord;
  storedMessages: JsonRecord[];
  latestUserInput: string;
  mentionedNames: string[];
  activeIds: string[];
  selectionMode: "single" | "multi";
  signal?: AbortSignal;
}): Promise<string[]> {
  const candidates = await loadSmartResponderCandidates(args.deps.storage, args.activeIds);
  const mentionedIds = mentionedSmartResponderIds({
    candidates,
    latestUserInput: args.latestUserInput,
    mentionedNames: args.mentionedNames,
  });
  if (mentionedIds.length > 0) return args.selectionMode === "single" ? mentionedIds.slice(0, 1) : mentionedIds;
  if (candidates.length === 0) return [];

  const personaId = readString(args.chat.personaId).trim();
  const persona = personaId ? await args.deps.storage.get<JsonRecord>("personas", personaId).catch(() => null) : null;
  const personaData = isRecord(persona) ? characterDataRecord(persona) : {};
  const chatMode = readString(args.chat.mode || args.chat.chatMode, "conversation");
  const chatKind = chatMode === "conversation" ? "conversation group chat" : "individual-mode roleplay group chat";
  const selectionInstruction =
    args.selectionMode === "multi"
      ? "Choose the character or characters who should respond in this send, in the order they should reply. Return an empty array when nobody should answer yet."
      : "Choose which character should respond next based on the latest message, direct address, conversation momentum, and talkativeness. Return an empty array when nobody should answer yet.";
  const candidateLines = candidates
    .map((candidate) =>
      JSON.stringify({
        id: candidate.id,
        name: candidate.name,
        talkativeness: candidate.talkativeness,
        personality: candidate.personality,
        description: candidate.description,
      }),
    )
    .join("\n");
  let raw = "";
  try {
    raw = await args.deps.llm.complete(
      {
        connectionId: readString(args.connection.id).trim() || args.input.connectionId || null,
        provider: readString(args.connection.provider).trim() || null,
        model: readString(args.connection.model).trim() || null,
        parameters: { maxTokens: 256 },
        messages: [
          {
            role: "system",
            content: `You are a hidden response orchestrator for a ${chatKind}. ${selectionInstruction} Return only JSON: {"characterIds":["character-id"],"reason":"short"}.`,
          },
          {
            role: "user",
            content: [
              `<persona>${compactPromptLine(readString(personaData.name || persona?.name), 120)}</persona>`,
              `<candidates>\n${candidateLines}\n</candidates>`,
              `<recent_transcript>\n${smartSelectorTranscript(args.storedMessages)}\n</recent_transcript>`,
              `<latest_user_message>\n${compactPromptLine(args.latestUserInput, 1200)}\n</latest_user_message>`,
            ].join("\n\n"),
          },
        ],
      },
      args.signal,
    );
  } catch (error) {
    if (isRecord(error) && readString(error.name) === "AbortError") throw error;
  }
  const selected = parseSmartGroupSelectionIds(raw, args.activeIds);
  if (selected.length > 0) return args.selectionMode === "single" ? selected.slice(0, 1) : selected;
  return [];
}

function parseSmartContinuationDecision(raw: string): boolean | null {
  const { cleanText: stripped } = extractLeadingThinkingBlocks(raw);
  let text = stripped.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) text = fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  try {
    const parsed = JSON.parse(text) as JsonRecord;
    return typeof parsed.shouldRespond === "boolean" ? parsed.shouldRespond : null;
  } catch {
    return null;
  }
}

async function shouldKeepSmartConversationResponder(args: {
  deps: GenerationEngineDeps;
  input: StartGenerationInput;
  connection: JsonRecord;
  storedMessages: JsonRecord[];
  characterId: string;
  characterName: string;
  signal?: AbortSignal;
}): Promise<boolean> {
  let raw = "";
  try {
    raw = await args.deps.llm.complete(
      {
        connectionId: readString(args.connection.id).trim() || args.input.connectionId || null,
        provider: readString(args.connection.provider).trim() || null,
        model: readString(args.connection.model).trim() || null,
        parameters: { maxTokens: 128 },
        messages: [
          {
            role: "system",
            content:
              'You are a hidden continuation orchestrator for a conversation group chat. Decide whether the specified candidate still has a distinct, useful contribution after the replies already given. Return only JSON: {"shouldRespond":true,"reason":"short"}.',
          },
          {
            role: "user",
            content: [
              `<candidate>${JSON.stringify({ id: args.characterId, name: args.characterName })}</candidate>`,
              `<updated_transcript>\n${smartSelectorTranscript(args.storedMessages)}\n</updated_transcript>`,
            ].join("\n\n"),
          },
        ],
      },
      args.signal,
    );
  } catch (error) {
    if (isRecord(error) && readString(error.name) === "AbortError") throw error;
    return true;
  }
  return parseSmartContinuationDecision(raw) ?? true;
}

async function resolveGroupTargetForGeneration(args: {
  deps: GenerationEngineDeps;
  input: StartGenerationInput;
  chat: JsonRecord;
  connection: JsonRecord;
  storedMessages: JsonRecord[];
  latestUserInput: string;
  mentionedNames: string[];
  signal?: AbortSignal;
}): Promise<string | null> {
  if (args.input.impersonate === true) return null;
  const activeIds = targetedGroupCharacterIds(args.chat);
  if (activeIds.length === 0) return null;
  const explicit = explicitGroupTarget(args.input, args.storedMessages, activeIds);
  if (explicit) return explicit;

  const candidates = await loadSmartResponderCandidates(args.deps.storage, activeIds);
  const mentionedIds = mentionedSmartResponderIds({
    candidates,
    latestUserInput: args.latestUserInput,
    mentionedNames: args.mentionedNames,
  });
  if (mentionedIds.length > 0) return mentionedIds[0] ?? null;

  const continuation = continuationGroupTarget({
    input: args.input,
    latestUserInput: args.latestUserInput,
    storedMessages: args.storedMessages,
    activeIds,
  });
  if (continuation) return continuation;

  const order = readString(parseRecord(args.chat.metadata).groupResponseOrder, "smart");
  if (order === "manual") return null;
  if (order === "smart") {
    return smartRoleplayGroupTarget({ ...args, activeIds });
  }
  return sequentialGroupTarget(args.storedMessages, activeIds);
}

async function resolveIndividualGroupTurnIds(args: {
  deps: GenerationEngineDeps;
  input: StartGenerationInput;
  chat: JsonRecord;
  connection: JsonRecord;
  storedMessages: JsonRecord[];
  latestUserInput: string;
  mentionedNames: string[];
  signal?: AbortSignal;
}): Promise<string[] | null> {
  if (args.input.impersonate === true || readString(args.input.regenerateMessageId).trim()) return null;
  if (Array.isArray(args.input.messages) && args.input.messages.length > 0) return null;
  const metadata = parseRecord(args.chat.metadata);
  const chatMode = readString(args.chat.mode || args.chat.chatMode).trim();
  const isRoleplayIndividualGroup =
    chatMode === "roleplay" && readString(metadata.groupChatMode, "merged") === "individual";
  const isConversationGroup = chatMode === "conversation";
  if (!isRoleplayIndividualGroup && !isConversationGroup) return null;

  const activeIds = isConversationGroup ? conversationGroupCharacterIds(args.chat) : activeCharacterIds(args.chat);
  if (activeIds.length <= 1) return null;
  const explicit = explicitGroupTarget(args.input, args.storedMessages, activeIds);
  if (explicit) return [explicit];

  if (isConversationGroup) {
    const candidates = await loadSmartResponderCandidates(args.deps.storage, activeIds);
    const mentionedIds = mentionedSmartResponderIds({
      candidates,
      latestUserInput: args.latestUserInput,
      mentionedNames: args.mentionedNames,
    });
    if (mentionedIds.length > 0) return mentionedIds;
  }

  const order = readString(metadata.groupResponseOrder, "smart");
  if (order === "manual") return [];
  if (order === "smart") {
    const smartTargets = await smartRoleplayGroupTargets({
      ...args,
      activeIds,
      selectionMode: "multi",
    });
    if (smartTargets.length > 0 || !isConversationGroup) return smartTargets;
  }
  return sequentialGroupTurnOrder(args.storedMessages, activeIds);
}

async function* runIndividualGroupTurnLoop(args: {
  deps: GenerationEngineDeps;
  input: StartGenerationInput;
  connection: JsonRecord;
  turnIds: string[];
  latestUserInput: string;
  revalidateLaterResponders: boolean;
  signal?: AbortSignal;
}): AsyncGenerator<GenerationEvent> {
  const priorResponderContributions: SameSendPeerContribution[] = [];
  const priorResponderContributionIndexByMessageId = new Map<string, number>();
  for (let index = 0; index < args.turnIds.length; index += 1) {
    throwIfAborted(args.signal);
    const characterId = args.turnIds[index]!;
    const characterName = (await characterNameById(args.deps.storage, [], characterId)) ?? "Character";
    if (index > 0 && args.revalidateLaterResponders) {
      const storedMessages = await args.deps.storage.listChatMessages<JsonRecord>(args.input.chatId);
      const shouldRespond = await shouldKeepSmartConversationResponder({
        deps: args.deps,
        input: args.input,
        connection: args.connection,
        storedMessages,
        characterId,
        characterName,
        signal: args.signal,
      });
      if (!shouldRespond) continue;
    }
    yield { type: "group_turn", data: { characterId, characterName, index, total: args.turnIds.length } };

    const childInput: StartGenerationInput = {
      ...args.input,
      userMessage: null,
      message: "",
      attachments: [],
      forCharacterId: characterId,
    };
    internalStartGenerationOptions.set(childInput, {
      groupTurnChild: true,
      latestUserInput: args.latestUserInput,
      sameSendPeerContext: boundedSameSendPeerContext(priorResponderContributions),
      skipUserMessageSave: true,
    });

    for await (const event of startGeneration(args.deps, childInput, args.signal)) {
      if (event.type === "user_message" || event.type === "done") continue;
      if (event.type === "agent_injection_review") {
        yield event;
        yield { type: "done" };
        return;
      }
      if (event.type === "assistant_message" && isRecord(event.data)) {
        const content = readString(event.data.content).trim();
        if (content) {
          const id = readString(event.data.id).trim();
          const existingIndex = id ? priorResponderContributionIndexByMessageId.get(id) : undefined;
          if (existingIndex === undefined) {
            if (id) priorResponderContributionIndexByMessageId.set(id, priorResponderContributions.length);
            priorResponderContributions.push({ characterName, content });
          } else {
            priorResponderContributions[existingIndex] = { characterName, content };
          }
        }
      }
      yield event;
    }
  }
  yield { type: "done" };
}

type ConversationAvailabilityStatus = "online" | "idle" | "dnd" | "offline";

type ConversationAvailabilityCharacter = {
  id: string;
  name: string;
  status: ConversationAvailabilityStatus;
  schedule?: WeekSchedule | null;
  availability: ConversationAvailabilityDecision;
};

function conversationStatus(value: unknown): ConversationAvailabilityStatus {
  return value === "idle" || value === "dnd" || value === "offline" ? value : "online";
}

function normalizedMentionedCharacterNames(names: string[]): Set<string> {
  return new Set(names.map((name) => name.trim().toLowerCase()).filter(Boolean));
}

async function resolveConversationAvailability(args: {
  storage: StorageGateway;
  chat: JsonRecord;
  targetCharacterId?: string | null;
  manualTargetCharacterId?: string | null;
  mentionedCharacterNames?: string[];
}): Promise<{
  characters: ConversationAvailabilityCharacter[];
  allOffline: boolean;
  delayMs: number;
  delayStatus: ConversationAvailabilityStatus;
} | null> {
  if (readString(args.chat.mode || args.chat.chatMode).trim() !== "conversation") return null;
  const activeIds = activeCharacterIds(args.chat);
  if (activeIds.length === 0) return null;
  const activeSet = new Set(activeIds);
  const requested = readString(args.targetCharacterId).trim();
  const manualTarget = readString(args.manualTargetCharacterId).trim();
  const mentionedNames = normalizedMentionedCharacterNames(args.mentionedCharacterNames ?? []);
  const respondingIds = requested && activeSet.has(requested) ? [requested] : activeIds;
  const statusResult = await getConversationStatus(args.storage, readString(args.chat.id).trim());
  const characters: ConversationAvailabilityCharacter[] = [];
  for (const id of respondingIds) {
    const row = statusResult.statuses[id];
    const schedule = isRecord(row?.schedule) ? (row.schedule as unknown as WeekSchedule) : null;
    const fallbackActivity = typeof row?.activity === "string" ? row.activity : "free time";
    const availability = getAvailabilityDecision(schedule, new Date(), fallbackActivity);
    characters.push({
      id,
      name: (await characterNameById(args.storage, [], id)) ?? "Character",
      status: conversationStatus(availability.status),
      schedule,
      availability,
    });
  }
  const mentionedCharacters =
    mentionedNames.size > 0 ? characters.filter((character) => mentionedNames.has(character.name.toLowerCase())) : [];
  const availableCharacters = mentionedCharacters.length > 0 ? mentionedCharacters : characters;
  const allOffline =
    availableCharacters.length > 0 && availableCharacters.every((character) => character.status === "offline");
  let delayMs = 0;
  let delayStatus: ConversationAvailabilityStatus = "online";
  for (const character of availableCharacters) {
    const isMentionedOrManualTarget =
      (manualTarget.length > 0 && character.id === manualTarget) || mentionedNames.has(character.name.toLowerCase());
    const characterDelay = getAvailabilityResponseDelay(
      character.availability,
      character.schedule ?? undefined,
      isMentionedOrManualTarget,
    );
    if (characterDelay > delayMs) {
      delayMs = characterDelay;
      delayStatus = character.status;
    }
  }
  return { characters: availableCharacters, allOffline, delayMs, delayStatus };
}

function abortableDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(abortGenerationError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortGenerationError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function sequentialGroupTargetCharacterId(
  chat: JsonRecord,
  input: StartGenerationInput,
  messages: JsonRecord[],
): string | null {
  if (input.impersonate === true) return null;
  if (readString(input.forCharacterId).trim()) return null;
  const metadata = parseRecord(chat.metadata);
  if (readString(chat.mode || chat.chatMode).trim() !== "roleplay") return null;
  if (readString(metadata.groupChatMode, "merged") !== "individual") return null;
  if (readString(metadata.groupResponseOrder, "smart") !== "sequential") return null;
  const activeIds = activeCharacterIds(chat);
  if (activeIds.length <= 1) return null;

  const regenerateMessageId = readString(input.regenerateMessageId).trim();
  if (regenerateMessageId) return explicitGroupTarget(input, messages, activeIds);

  return sequentialGroupTarget(messages, activeIds);
}

function isPassiveGenerationRequest(input: StartGenerationInput, prepared: PreparedUserInput): boolean {
  return (
    input.impersonate !== true &&
    !readString(input.regenerateMessageId).trim() &&
    !readString(input.generationGuide).trim() &&
    !inputUserMessage(input).trim() &&
    !prepared.content.trim() &&
    prepared.attachments.length === 0
  );
}

function latestVisibleMessage(messages: JsonRecord[]): JsonRecord | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (hiddenFromAi(message)) continue;
    if (!readString(message.content).trim()) continue;
    return message;
  }
  return null;
}

function shouldContinueAssistantResponse(
  input: StartGenerationInput,
  prepared: PreparedUserInput,
  storedMessages: JsonRecord[],
): boolean {
  if (readString(input.forCharacterId).trim()) return false;
  if (!isPassiveGenerationRequest(input, prepared)) return false;
  return readString(latestVisibleMessage(storedMessages)?.role) === "assistant";
}

function resultKey(result: AgentResult): string {
  return `${result.agentId}:${result.agentType}:${result.type}:${JSON.stringify(result.data)}`;
}

function uniqueAgentResults(results: AgentResult[]): AgentResult[] {
  const unique = new Map<string, AgentResult>();
  for (const result of results) {
    unique.set(resultKey(result), result);
  }
  return [...unique.values()];
}

async function agentNameLookup(storage: StorageGateway): Promise<Map<string, string>> {
  const lookup = new Map<string, string>();
  for (const agent of await storage.list<JsonRecord>("agents").catch(() => [])) {
    const name = readString(agent.name).trim();
    if (!name) continue;
    const id = readString(agent.id).trim();
    const type = readString(agent.type || agent.agentType).trim();
    if (id) lookup.set(id, name);
    if (type) lookup.set(type, name);
  }
  return lookup;
}

async function persistAgentResults(
  storage: StorageGateway,
  chatId: string,
  messageId: string | null,
  results: AgentResult[],
): Promise<void> {
  const seen = new Set<string>();
  const agentNames = await agentNameLookup(storage);
  for (const result of results) {
    const key = resultKey(result);
    if (seen.has(key)) continue;
    seen.add(key);
    await storage.create("agent-runs", {
      chatId,
      messageId,
      agentConfigId: result.agentId,
      agentId: result.agentId,
      agentType: result.agentType,
      agentName: agentNames.get(result.agentId) ?? agentNames.get(result.agentType) ?? result.agentType,
      resultType: result.type,
      resultData: result.data as never,
      success: result.success,
      error: result.error,
      tokensUsed: result.tokensUsed,
      durationMs: result.durationMs,
      createdAt: nowIso(),
    });
  }
}

async function persistSecretPlotAgentMemorySafely(
  storage: StorageGateway,
  chatId: string,
  results: AgentResult[],
  options: { rerollMode?: SecretPlotRerollMode | null } = {},
): Promise<void> {
  try {
    await persistSecretPlotAgentMemory(storage, chatId, results, options);
  } catch (error) {
    console.warn("[generation] secret plot memory persist failed", error);
  }
}

async function persistTrackerSnapshotSafely(
  storage: StorageGateway,
  chatId: string,
  targetMessage: unknown,
  results: AgentResult[],
  baseSnapshot?: GameState | null,
  sourceText?: string | null,
  onSavedSnapshot?: TrackerSnapshotSavedHook,
  autoRemoveFullyCompletedQuests = false,
): Promise<void> {
  const target = trackerSnapshotTargetFromMessage(targetMessage);
  if (!target) return;
  try {
    await persistTrackerSnapshotForTurn(storage, chatId, target, results, {
      baseSnapshot,
      sourceText,
      onSavedSnapshot,
      autoRemoveFullyCompletedQuests,
    });
  } catch (error) {
    console.warn("[generation] tracker snapshot persist failed", error);
  }
}

/**
 * Snapshots are retained for only the most recent assistant messages to bound
 * per-chat storage growth (parity with v1.6.1). Older assistant messages keep
 * their text but drop the saved prompt; the inspector then shows "No saved
 * prompt snapshot" for them, exactly as v1.6.1 did.
 */
const PROMPT_SNAPSHOT_KEEP_LAST = 2;

async function evictStalePromptSnapshotsSafely(storage: StorageGateway, chatId: string): Promise<void> {
  try {
    await storage.evictPromptSnapshots?.(chatId, PROMPT_SNAPSHOT_KEEP_LAST);
  } catch (error) {
    console.warn("[generation] prompt snapshot eviction failed", error);
  }
}

function shouldRefreshMemoryRecall(chat: JsonRecord): boolean {
  return getEffectiveMemoryRecallEnabled(readString(chat.mode || chat.chatMode), parseRecord(chat.metadata));
}

async function enqueueAutomaticMemoryCaptureSafely(
  storage: StorageGateway,
  chat: JsonRecord,
  savedUserMessage: unknown,
  savedAssistantMessage: unknown,
): Promise<void> {
  if (!storage.refreshChatMemories || !shouldRefreshMemoryRecall(chat)) return;
  try {
    await enqueueAndScheduleAutomaticMemoryCapture(storage, { chat, savedUserMessage, savedAssistantMessage });
  } catch (error) {
    console.warn("[generation] automatic memory capture enqueue failed", error);
  }
}
async function persistLorebookTimingStatesSafely(
  storage: StorageGateway,
  chatId: string,
  timingStates: Record<string, unknown> | null,
  entryStateOverrides?: Record<string, unknown> | null,
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (timingStates) patch.entryTimingStates = timingStates;
  if (entryStateOverrides) patch.entryStateOverrides = entryStateOverrides;
  if (Object.keys(patch).length === 0) return;
  try {
    await storage.patchChatMetadata(chatId, patch);
  } catch (error) {
    console.warn("[generation] lorebook runtime state persist failed", error);
  }
}

function cloneSerializableValue<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

function isEncryptedProviderMetadataKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return normalized.endsWith("encryptedcontent");
}

function redactProviderMetadataForSnapshot(value: unknown): unknown {
  const cloned = cloneSerializableValue(value);
  if (Array.isArray(cloned)) return cloned.map(redactProviderMetadataForSnapshot);
  if (!isRecord(cloned)) return cloned;
  return Object.fromEntries(
    Object.entries(cloned).map(([key, entry]) => [
      key,
      isEncryptedProviderMetadataKey(key) ? "[REDACTED]" : redactProviderMetadataForSnapshot(entry),
    ]),
  );
}

function clonePromptMessage(message: LlmMessage): GenerationPromptSnapshotMessage {
  const snapshot = cloneSerializableValue(message) as GenerationPromptSnapshotMessage;
  snapshot.role = message.role;
  snapshot.content = readString(message.content);
  if (message.name) snapshot.name = message.name;
  if (message.images?.length) snapshot.images = [...message.images];
  if (message.tool_call_id) snapshot.tool_call_id = message.tool_call_id;
  if (message.tool_calls != null) snapshot.tool_calls = cloneSerializableValue(message.tool_calls);
  if (message.providerMetadata != null) {
    snapshot.providerMetadata = redactProviderMetadataForSnapshot(message.providerMetadata);
  }
  return snapshot;
}

function providerMetadataRecord(value: unknown): Record<string, unknown> | null {
  const record = parseRecord(value);
  return Object.keys(record).length > 0 ? cloneSerializableValue(record) : null;
}

function mergeMetadataArray(existing: unknown, next: unknown): unknown[] {
  const merged: unknown[] = [];
  const seen = new Set<string>();
  for (const item of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(next) ? next : [])]) {
    const key = JSON.stringify(item) ?? String(item);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(cloneSerializableValue(item));
  }
  return merged;
}

function mergeProviderMetadata(existing: unknown, next: unknown): unknown {
  if (next == null) return existing ?? null;
  if (existing == null) return cloneSerializableValue(next);
  const existingRecord = parseRecord(existing);
  const nextRecord = parseRecord(next);
  if (Object.keys(existingRecord).length === 0 || Object.keys(nextRecord).length === 0) {
    return cloneSerializableValue(next);
  }
  const merged: Record<string, unknown> = {
    ...cloneSerializableValue(existingRecord),
    ...cloneSerializableValue(nextRecord),
  };
  for (const key of ["encryptedReasoningItems", "openaiResponsesEncryptedReasoningItems"]) {
    if (Array.isArray(existingRecord[key]) || Array.isArray(nextRecord[key])) {
      merged[key] = mergeMetadataArray(existingRecord[key], nextRecord[key]);
    }
  }
  return merged;
}

function nullableNumber(value: unknown): number | null {
  const parsed = readNumber(value, NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

function usageNumber(usage: unknown, keys: string[]): number | null {
  const record = parseRecord(usage);
  for (const key of keys) {
    const parsed = nullableNumber(record[key]);
    if (parsed != null) return parsed;
  }
  return null;
}

export function buildSavedGenerationPromptSnapshot(args: {
  connection: JsonRecord;
  promptSnapshot?: MainGenerationPromptSnapshot | null;
  usage?: unknown;
}): GenerationPromptSnapshot | null {
  if (!args.promptSnapshot?.messages?.length) return null;
  const parameters = cloneSerializableValue(args.promptSnapshot.parameters ?? {});
  const tools = Array.isArray(args.promptSnapshot.tools) ? cloneSerializableValue(args.promptSnapshot.tools) : null;
  const generationInfo = generationInfoFromVisibleParameters(args.connection, isRecord(parameters) ? parameters : {});
  return {
    messages: args.promptSnapshot.messages.map(clonePromptMessage),
    ...(args.promptSnapshot.previewMessages?.length
      ? { previewMessages: args.promptSnapshot.previewMessages.map(clonePromptMessage) }
      : {}),
    parameters: isRecord(parameters) ? parameters : {},
    ...(tools?.length ? { tools } : {}),
    promptPresetId: args.promptSnapshot.promptPresetId ?? null,
    ...(args.promptSnapshot.lorebookActivationTrace
      ? { lorebookActivationTrace: args.promptSnapshot.lorebookActivationTrace }
      : {}),
    ...(args.promptSnapshot.contextAttribution ? { contextAttribution: args.promptSnapshot.contextAttribution } : {}),
    generationInfo: {
      model: generationInfo.model,
      provider: generationInfo.provider,
      temperature: generationInfo.temperature ?? null,
      maxTokens: generationInfo.maxTokens ?? null,
      topP: generationInfo.topP ?? null,
      topK: generationInfo.topK ?? null,
      frequencyPenalty: generationInfo.frequencyPenalty ?? null,
      presencePenalty: generationInfo.presencePenalty ?? null,
      showThoughts: generationInfo.showThoughts ?? null,
      reasoningEffort: generationInfo.reasoningEffort ?? null,
      verbosity: generationInfo.verbosity ?? null,
      serviceTier: generationInfo.serviceTier ?? null,
      assistantPrefill: generationInfo.assistantPrefill ?? null,
      tokensPrompt: usageNumber(args.usage, ["promptTokens", "prompt_tokens", "inputTokens", "input_tokens"]),
      tokensCompletion: usageNumber(args.usage, [
        "completionTokens",
        "completion_tokens",
        "outputTokens",
        "output_tokens",
      ]),
      tokensCachedPrompt: usageNumber(args.usage, [
        "cachedPromptTokens",
        "cached_prompt_tokens",
        "cacheReadInputTokens",
        "cache_read_input_tokens",
      ]),
      tokensCacheWritePrompt: usageNumber(args.usage, [
        "cacheWritePromptTokens",
        "cache_write_prompt_tokens",
        "cacheCreationInputTokens",
        "cache_creation_input_tokens",
      ]),
      durationMs: usageNumber(args.usage, ["durationMs", "duration_ms"]),
      finishReason: readString(parseRecord(args.usage).finishReason ?? parseRecord(args.usage).finish_reason) || null,
    },
    createdAt: nowIso(),
  };
}

function spriteExpressionsFromAgentResults(
  results: AgentResult[],
  availableSprites: AvailableSpriteCharacter[] | undefined,
  requiredCharacterIds: readonly unknown[] = [],
  completionOptions: SpriteExpressionCompletionOptions = {},
): Record<string, string> | null {
  const entries: SpriteExpressionEntry[] = [];
  const hasAvailableSprites = Array.isArray(availableSprites) && availableSprites.length > 0;
  const expressions: Record<string, string> = {};
  for (const result of results) {
    if (!result.success || result.agentType !== "expression") continue;
    const data = parseRecord(result.data);
    const rawEntries = Array.isArray(data.expressions) ? data.expressions : [];
    for (const entry of rawEntries) {
      const record = parseRecord(entry);
      entries.push({
        characterId: record.characterId,
        characterName: record.characterName,
        expression: record.expression,
        transition: record.transition,
      });
    }
  }

  if (!hasAvailableSprites) return null;

  const validation = completeRequiredSpriteExpressionEntries(
    entries,
    availableSprites,
    requiredCharacterIds,
    completionOptions,
  );
  for (const entry of validation.expressions) {
    const expression = readString(entry.expression).trim();
    const characterId = readString(entry.characterId).trim();
    if (characterId && expression) expressions[characterId] = expression;
  }
  return Object.keys(expressions).length > 0 ? expressions : null;
}

function requiredSpriteExpressionTargetIds(chat: JsonRecord, input: StartGenerationInput): string[] {
  const targetId =
    input.impersonate === true ? readString(chat.personaId).trim() : (assistantMessageCharacterId(chat, input) ?? "");
  return targetId ? [targetId] : [];
}

function expressionAvatarsEnabled(chat: JsonRecord): boolean {
  return parseRecord(chat.metadata).expressionAvatarsEnabled === true;
}

function uniqueRequiredSpriteExpressionTargetIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const rawId of ids) {
    const id = rawId.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  return unique;
}

function requiredSpriteExpressionTargetIdsForMessage(message: unknown, chat?: JsonRecord): string[] {
  if (!isRecord(message)) return [];
  const role = readString(message.role).trim();
  const characterId = readString(message.characterId).trim();
  if (role !== "user" && characterId) return [characterId];
  if (role === "user") {
    const personaId =
      readString(parseRecord(parseRecord(message.extra).personaSnapshot).personaId).trim() ||
      readString(chat?.personaId).trim();
    if (personaId) return [personaId];
  }
  return [];
}

type SpriteExpressionMessagePatch = {
  messageId: string;
  spriteExpressions: Record<string, string>;
};

type MessageExtraPatchForGeneration = {
  messageId: string;
  patch: Record<string, unknown>;
};

function messageRole(message: unknown): string {
  return isRecord(message) ? readString(message.role).trim() : "";
}

function existingSpriteExpressionMap(message: unknown): Record<string, string> {
  const expressions = parseRecord(parseRecord(isRecord(message) ? message.extra : null).spriteExpressions);
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(expressions)) {
    const expression = readString(value).trim();
    if (key.trim() && expression) normalized[key.trim()] = expression;
  }
  return normalized;
}

function mergeSpriteExpressionMap(
  existing: Record<string, string>,
  next: Record<string, string>,
): Record<string, string> {
  return { ...existing, ...next };
}

function lastUserMessageBeforeTarget(messages: JsonRecord[], target: JsonRecord | null): JsonRecord | null {
  const index = messageIndex(messages, target);
  const start = index >= 0 ? index - 1 : messages.length - 1;
  for (let i = start; i >= 0; i -= 1) {
    const message = messages[i]!;
    if (messageRole(message) === "user" && readString(message.id).trim()) return message;
  }
  return null;
}

function messageContent(message: unknown): string {
  return isRecord(message) ? readString(message.content) : "";
}

function requiredSpriteExpressionTargetIdsForTarget(
  chat: JsonRecord,
  messages: JsonRecord[],
  target: JsonRecord | null,
): string[] {
  const ids = requiredSpriteExpressionTargetIdsForMessage(target, chat);
  const personaId = readString(chat.personaId).trim();
  if (personaId && expressionAvatarsEnabled(chat) && messageRole(target) !== "user") {
    const personaTarget = lastUserMessageBeforeTarget(messages, target);
    if (readString(personaTarget?.id).trim()) ids.push(personaId);
  }
  return uniqueRequiredSpriteExpressionTargetIds(ids);
}

function spriteExpressionCompletionOptionsForTarget(
  chat: JsonRecord,
  messages: JsonRecord[],
  target: JsonRecord | null,
): SpriteExpressionCompletionOptions {
  const personaId = readString(chat.personaId).trim();
  const targetRole = messageRole(target);
  const targetText = messageContent(target);
  const personaSource =
    targetRole === "user" ? targetText : messageContent(lastUserMessageBeforeTarget(messages, target));
  const sourceTextByCharacterId = new Map<string, string>();
  if (personaId && personaSource.trim()) {
    sourceTextByCharacterId.set(personaId, personaSource);
  }
  return {
    defaultSourceText: targetText,
    sourceTextByCharacterId,
    personaCharacterIds: personaId ? new Set([personaId]) : undefined,
  };
}

export function spriteExpressionPatchesForTarget(args: {
  chat: JsonRecord;
  messages: JsonRecord[];
  target: JsonRecord | null;
  results: AgentResult[];
  availableSprites: AvailableSpriteCharacter[];
}): SpriteExpressionMessagePatch[] {
  const targetId = readString(args.target?.id).trim();
  if (!targetId) return [];

  const spriteExpressions = spriteExpressionsFromAgentResults(
    args.results,
    args.availableSprites,
    requiredSpriteExpressionTargetIdsForTarget(args.chat, args.messages, args.target),
    spriteExpressionCompletionOptionsForTarget(args.chat, args.messages, args.target),
  );
  if (!spriteExpressions || Object.keys(spriteExpressions).length === 0) return [];

  const personaId = readString(args.chat.personaId).trim();
  const targetRole = messageRole(args.target);
  const targetExpressions: Record<string, string> = {};
  const personaExpressions: Record<string, string> = {};

  for (const [ownerId, expression] of Object.entries(spriteExpressions)) {
    if (personaId && ownerId === personaId && targetRole !== "user") {
      personaExpressions[ownerId] = expression;
    } else {
      targetExpressions[ownerId] = expression;
    }
  }

  const patches: SpriteExpressionMessagePatch[] = [];
  if (Object.keys(targetExpressions).length > 0) {
    patches.push({
      messageId: targetId,
      spriteExpressions: mergeSpriteExpressionMap(existingSpriteExpressionMap(args.target), targetExpressions),
    });
  }

  if (Object.keys(personaExpressions).length > 0) {
    const personaTarget = targetRole === "user" ? args.target : lastUserMessageBeforeTarget(args.messages, args.target);
    const personaMessageId = readString(personaTarget?.id).trim();
    if (personaMessageId) {
      patches.push({
        messageId: personaMessageId,
        spriteExpressions: mergeSpriteExpressionMap(existingSpriteExpressionMap(personaTarget), personaExpressions),
      });
    }
  }

  return patches;
}

function mergeMessageExtraPatches(patches: MessageExtraPatchForGeneration[]): MessageExtraPatchForGeneration[] {
  const merged = new Map<string, Record<string, unknown>>();
  for (const patch of patches) {
    const messageId = patch.messageId.trim();
    if (!messageId || Object.keys(patch.patch).length === 0) continue;
    merged.set(messageId, { ...(merged.get(messageId) ?? {}), ...patch.patch });
  }
  return Array.from(merged.entries()).map(([messageId, patch]) => ({ messageId, patch }));
}

export async function patchMessageExtrasForGeneration(
  storage: Pick<StorageGateway, "getChatMessage" | "patchChatMessageExtra">,
  patches: MessageExtraPatchForGeneration[],
): Promise<unknown[]> {
  const mergedPatches = mergeMessageExtraPatches(patches);
  if (mergedPatches.length === 0) return [];

  const applied: Array<{
    messageId: string;
    originalValues: Map<string, { hadKey: boolean; value: unknown }>;
  }> = [];
  const updatedRows: unknown[] = [];
  try {
    for (const patch of mergedPatches) {
      const current = await storage.getChatMessage<JsonRecord>(patch.messageId, { fields: ["extra"] });
      if (!current) throw new Error(`Message ${patch.messageId} was not found`);

      const currentExtra = parseRecord(current.extra);
      const originalValues = new Map<string, { hadKey: boolean; value: unknown }>();
      for (const key of Object.keys(patch.patch)) {
        originalValues.set(key, {
          hadKey: Object.prototype.hasOwnProperty.call(currentExtra, key),
          value: currentExtra[key],
        });
      }

      updatedRows.push(await storage.patchChatMessageExtra(patch.messageId, patch.patch));
      applied.push({ messageId: patch.messageId, originalValues });
    }
    return updatedRows;
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (let index = applied.length - 1; index >= 0; index -= 1) {
      const { messageId, originalValues } = applied[index]!;
      try {
        const rollbackPatch: Record<string, unknown> = {};
        const missingKeys: string[] = [];
        for (const [key, original] of originalValues) {
          if (original.hadKey) {
            rollbackPatch[key] = original.value;
          } else {
            missingKeys.push(key);
          }
        }
        if (Object.keys(rollbackPatch).length > 0) {
          await storage.patchChatMessageExtra(messageId, rollbackPatch);
        }
        if (missingKeys.length > 0) {
          throw new Error(
            `Message ${messageId} rollback cannot delete newly added extra key(s): ${missingKeys.join(", ")}`,
          );
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      const rollbackFailure = new Error(
        "Message extra patch failed and rollback did not fully restore state",
      ) as Error & {
        cause?: unknown;
        rollbackErrors?: unknown[];
      };
      rollbackFailure.cause = error;
      rollbackFailure.rollbackErrors = rollbackErrors;
      throw rollbackFailure;
    }
    throw error;
  }
}

function assertVisibleGeneratedContent(content: string, attachments?: JsonRecord[]): void {
  if (content.trim() || (attachments?.length ?? 0) > 0) return;
  throw new Error(
    "Generation produced no visible assistant response. Your message was kept; retry or adjust the provider.",
  );
}

const COMPLETE_OUTPUT_END_RE = /[.!?…。！？]["'”’)\]}»›]*$/;
const COMPLETE_SENTENCE_RE = /[.!?…。！？](?:["'”’)\]}»›]+)?(?=\s|$)/g;

function trimIncompleteModelEnding(content: string): string {
  const trailingWhitespace = content.match(/\s*$/)?.[0] ?? "";
  const body = content.trimEnd();
  if (!body || COMPLETE_OUTPUT_END_RE.test(body)) return content;

  let lastCompleteEnd = -1;
  for (const match of body.matchAll(COMPLETE_SENTENCE_RE)) {
    lastCompleteEnd = (match.index ?? 0) + match[0].length;
  }
  if (lastCompleteEnd <= 0) return content;

  const tail = body.slice(lastCompleteEnd).trim();
  if (!tail) return content;

  const tailWithoutCommands = tail
    .replace(/\[[^\]]+\]/g, "")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .trim();
  if (!tailWithoutCommands) return content;

  return body.slice(0, lastCompleteEnd).trimEnd() + trailingWhitespace;
}

function finalAssistantContent(input: StartGenerationInput, content: string): string {
  if (input.trimIncompleteModelOutput !== true || input.impersonate === true) return content;
  return trimIncompleteModelEnding(content);
}

function normalizeCyoaChoices(value: unknown): CyoaChoice[] {
  const data = parseRecord(value);
  const rawChoices = Array.isArray(data.choices) ? data.choices : Array.isArray(value) ? value : [];
  return rawChoices
    .map((choice, index) => {
      const record = parseRecord(choice);
      const text = readString(record.text).trim();
      if (!text) return null;
      const label = readString(record.label).trim() || `Choice ${index + 1}`;
      return { label, text };
    })
    .filter((choice): choice is CyoaChoice => choice !== null);
}

function cyoaChoicesFromAgentResults(results: AgentResult[]): CyoaChoice[] | null {
  let choices: CyoaChoice[] | null = null;
  for (const result of results) {
    if (!result.success) continue;
    if (result.agentType !== "cyoa" && result.type !== "cyoa_choices") continue;
    const nextChoices = normalizeCyoaChoices(result.data);
    if (nextChoices.length > 0) choices = nextChoices;
  }
  return choices;
}

function normalizeContextInjections(value: unknown): AgentInjectionOverride[] {
  if (!Array.isArray(value)) return [];
  const injections: AgentInjectionOverride[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      const text = entry.trim();
      if (text) injections.push({ agentType: "prose-guardian", text });
      continue;
    }
    if (!isRecord(entry)) continue;
    const agentType = readString(entry.agentType).trim();
    const text = readString(entry.text).trim();
    if (!agentType || !text) continue;
    const agentName = readString(entry.agentName).trim();
    injections.push({ agentType, ...(agentName ? { agentName } : {}), text });
  }
  return injections;
}

function mergeContextInjections(
  existing: unknown,
  updates: readonly AgentInjectionOverride[],
): AgentInjectionOverride[] {
  const merged = normalizeContextInjections(existing);
  const indexByAgentType = new Map(merged.map((injection, index) => [injection.agentType, index]));
  for (const update of updates) {
    const index = indexByAgentType.get(update.agentType);
    if (index == null) {
      indexByAgentType.set(update.agentType, merged.length);
      merged.push({ ...update });
    } else {
      merged[index] = { ...update };
    }
  }
  return merged;
}

function agentExtraFromResults(args: {
  results: AgentResult[];
  contextInjections?: AgentInjectionOverride[] | null;
  existingExtra?: unknown;
  mergeContextInjectionUpdates?: boolean;
}): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  const cyoaChoices = cyoaChoicesFromAgentResults(args.results);
  if (cyoaChoices?.length) extra.cyoaChoices = cyoaChoices;

  const contextInjections = normalizeContextInjections(args.contextInjections);
  if (contextInjections.length > 0) {
    extra.contextInjections = args.mergeContextInjectionUpdates
      ? mergeContextInjections(parseRecord(args.existingExtra).contextInjections, contextInjections)
      : contextInjections;
  }

  return extra;
}

function assistantMessageCharacterId(chat: JsonRecord, input: StartGenerationInput): string | null {
  const requestedCharacterId = readString(input.forCharacterId).trim();
  const chatCharacterIdList = activeCharacterIds(chat);
  const chatCharacterIds = new Set(chatCharacterIdList);
  return requestedCharacterId && (chatCharacterIds.size === 0 || chatCharacterIds.has(requestedCharacterId))
    ? requestedCharacterId
    : chatCharacterIdList.length === 1
      ? chatCharacterIdList[0]!
      : null;
}

function isRoleplayChat(chat: JsonRecord): boolean {
  const mode = readString(chat.mode || chat.chatMode).trim();
  return mode === "roleplay" || mode === "rp";
}

function roleplayDialogueAttributionSpeakers(characters: GenerationCharacterContext[]): DialogueAttributionSpeaker[] {
  return characters
    .map((character): DialogueAttributionSpeaker | null => {
      const name = readString(character.name).trim();
      if (!name) return null;
      return {
        id: readString(character.id).trim() || null,
        name,
        aliases: roleplayDialogueAttributionAliases(character, name),
      };
    })
    .filter((speaker): speaker is DialogueAttributionSpeaker => speaker !== null);
}

function roleplayDialogueAttributionAliases(character: GenerationCharacterContext, name: string): string[] {
  const profile = character.publicProfile;
  const handle = readString(profile?.handle).trim();
  const aliases = [
    readString(profile?.displayName).trim(),
    handle,
    handle.startsWith("@") ? handle.slice(1).trim() : "",
  ];
  const seen = new Set([name.toLowerCase()]);
  return aliases.filter((alias) => {
    const key = alias.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function roleplayAssistantSaveContent(args: {
  chat: JsonRecord;
  characters: GenerationCharacterContext[];
  content: string;
}): string {
  if (!isRoleplayChat(args.chat)) return args.content;
  const speakers = roleplayDialogueAttributionSpeakers(args.characters);
  if (speakers.length === 0) return args.content;
  return buildDialogueAttributions(args.content, speakers, {
    stripSpeakerTags: true,
    stripLeadingSpeakerPrefix: true,
    includeDerivedProse: false,
  }).text;
}

function roleplayDeterministicDialogueAttributions(args: {
  chat: JsonRecord;
  characters: GenerationCharacterContext[];
  sourceContent: string;
  canonicalContent: string;
}): DialogueAttributionsExtra | null {
  if (!isRoleplayChat(args.chat)) return null;
  const speakers = roleplayDialogueAttributionSpeakers(args.characters);
  if (speakers.length === 0) return null;

  const sourceResult = buildDialogueAttributions(args.sourceContent, speakers, {
    stripSpeakerTags: true,
    stripLeadingSpeakerPrefix: true,
    includeDerivedProse: false,
  });
  const canonicalFromSource = collapseExcessBlankLines(sourceResult.text);
  if (sourceResult.attributions && canonicalFromSource === args.canonicalContent) {
    return {
      version: 1,
      textHash: createDialogueAttributionTextHash(args.canonicalContent),
      segments: sourceResult.attributions.segments,
    };
  }

  return buildDialogueAttributions(args.canonicalContent, speakers, {
    stripSpeakerTags: false,
    stripLeadingSpeakerPrefix: false,
    includeDerivedProse: false,
  }).attributions;
}

function shouldUseSelectedSidecarForDialogueAttribution(connection: JsonRecord): boolean {
  return readString(connection.provider).trim() === "sidecar" || readString(connection.id).trim() === "sidecar:local";
}

function speakerForAttributionName(
  speakers: DialogueAttributionSpeaker[],
  name: string,
): DialogueAttributionSpeaker | null {
  const key = name.trim().toLowerCase();
  if (!key) return null;
  return (
    speakers.find(
      (speaker) =>
        speaker.name.trim().toLowerCase() === key ||
        (speaker.aliases ?? []).some((alias) => alias.trim().toLowerCase() === key),
    ) ?? null
  );
}

function parseSidecarDialogueAttributionResponse(raw: string): Array<{ quote: string; speaker: string | null }> {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const parsed = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item) => {
      if (!isRecord(item)) return null;
      const quote = readString(item.quote);
      if (!quote) return null;
      const speakerValue = item.speaker == null ? null : readString(item.speaker).trim() || null;
      return { quote, speaker: speakerValue };
    })
    .filter((item): item is { quote: string; speaker: string | null } => item !== null);
}

async function roleplaySidecarDialogueAttributions(args: {
  llm: LlmGateway;
  connection: JsonRecord;
  canonicalContent: string;
  speakers: DialogueAttributionSpeaker[];
}): Promise<DialogueAttributionsExtra | null> {
  if (args.speakers.length === 0) return null;
  const knownCharacters = args.speakers
    .map((speaker) => [speaker.name, ...(speaker.aliases ?? [])].filter(Boolean).join(" / "))
    .join(", ");
  let raw = "";
  try {
    raw = await args.llm.complete({
      connectionId: readString(args.connection.id) || null,
      provider: readString(args.connection.provider) || null,
      model: readString(args.connection.model) || null,
      messages: [
        {
          role: "system",
          content:
            "You are a dialogue attribution assistant. Given a roleplay message, identify which named character is speaking each quoted passage. Return only a JSON array. Each item must have quote and speaker. Do not include narration or unquoted text.",
        },
        {
          role: "user",
          content: `Message:\n${args.canonicalContent}\n\nKnown characters: ${knownCharacters}`,
        },
      ],
      parameters: { temperature: 0, maxTokens: 512 },
    });
  } catch {
    return null;
  }

  let parsed: Array<{ quote: string; speaker: string | null }>;
  try {
    parsed = parseSidecarDialogueAttributionResponse(raw);
  } catch {
    return null;
  }

  const segments: DialogueAttributionsExtra["segments"] = [];
  let searchStart = 0;
  for (const item of parsed) {
    if (!item.speaker) continue;
    const speaker = speakerForAttributionName(args.speakers, item.speaker);
    if (!speaker) continue;
    // Known limitation: repeated identical quote strings depend on the order
    // returned by the sidecar. TODO: prefer the occurrence nearest to the
    // attributed speaker's closest prose mention.
    const start = args.canonicalContent.indexOf(item.quote, searchStart);
    if (start < 0) continue;
    const end = start + item.quote.length;
    segments.push({
      start,
      end,
      speakerName: speaker.name,
      speakerId: speaker.id ?? null,
      source: "sidecar-model",
      confidence: "derived",
    });
    searchStart = end;
  }

  return segments.length > 0
    ? { version: 1, textHash: createDialogueAttributionTextHash(args.canonicalContent), segments }
    : null;
}

async function roleplayCanonicalDialogueAttributions(args: {
  chat: JsonRecord;
  characters: GenerationCharacterContext[];
  sourceContent: string;
  canonicalContent: string;
  connection: JsonRecord;
  llm: LlmGateway;
}): Promise<DialogueAttributionsExtra | null> {
  const deterministic = roleplayDeterministicDialogueAttributions(args);
  if (deterministic) return deterministic;
  const speakers = roleplayDialogueAttributionSpeakers(args.characters);
  if (shouldUseSelectedSidecarForDialogueAttribution(args.connection)) {
    const sidecar = await roleplaySidecarDialogueAttributions({
      llm: args.llm,
      connection: args.connection,
      canonicalContent: args.canonicalContent,
      speakers,
    });
    if (sidecar) return sidecar;
  }
  return buildDialogueAttributions(args.canonicalContent, speakers, {
    stripSpeakerTags: false,
    stripLeadingSpeakerPrefix: false,
    includeDerivedProse: true,
  }).attributions;
}

async function patchSavedRoleplayDialogueAttributions(args: {
  storage: Pick<StorageGateway, "getChatMessage" | "patchChatMessageExtra">;
  llm: LlmGateway;
  connection: JsonRecord;
  chat: JsonRecord;
  characters: GenerationCharacterContext[];
  messageId: string | null;
  sourceContent: string;
}): Promise<unknown | null> {
  if (!args.messageId || !isRoleplayChat(args.chat)) return null;
  const saved = await args.storage.getChatMessage<JsonRecord>(args.messageId, { fields: ["content"] });
  const canonicalContent = readString(saved?.content);
  if (!canonicalContent) return null;
  const dialogueAttributions = await roleplayCanonicalDialogueAttributions({
    llm: args.llm,
    connection: args.connection,
    chat: args.chat,
    characters: args.characters,
    sourceContent: args.sourceContent,
    canonicalContent,
  });
  if (!dialogueAttributions) return null;
  return args.storage.patchChatMessageExtra(args.messageId, { dialogueAttributions });
}

async function saveAssistantMessage(args: {
  storage: StorageGateway;
  chat: JsonRecord;
  characters: GenerationCharacterContext[];
  input: StartGenerationInput;
  connection: JsonRecord;
  llm: LlmGateway;
  content: string;
  thinking?: string | null;
  agentResults: AgentResult[];
  noteCount: number;
  chatSummaryFingerprint: string | null;
  attachments?: JsonRecord[];
  usage?: unknown;
  providerMetadata?: unknown;
  promptSnapshot?: MainGenerationPromptSnapshot | null;
  spriteExpressions?: Record<string, string> | null;
  contextInjections?: AgentInjectionOverride[] | null;
  existingExtra?: unknown;
  regenerationTarget?: JsonRecord | null;
}): Promise<unknown | null> {
  const regenerateMessageId = readString(args.input.regenerateMessageId).trim();
  const regenerationTargetRole = readString(args.regenerationTarget?.role).trim();
  const generationReplay = buildGenerationReplay(args.input);
  const content = args.content;
  assertVisibleGeneratedContent(content, args.attachments);
  const thinking = collapseExcessBlankLines(readString(args.thinking).trim());
  const providerMetadata = args.input.impersonate === true ? null : providerMetadataRecord(args.providerMetadata);
  const promptSnapshot = buildSavedGenerationPromptSnapshot({
    connection: args.connection,
    promptSnapshot: args.promptSnapshot,
    usage: args.usage,
  });
  const agentExtra = agentExtraFromResults({
    results: args.agentResults,
    contextInjections: args.contextInjections,
    existingExtra: regenerateMessageId ? args.existingExtra : undefined,
    mergeContextInjectionUpdates: !!regenerateMessageId,
  });

  if (args.input.impersonate === true) {
    if (regenerateMessageId) {
      return saveRegeneratedMessage({
        storage: args.storage,
        chatId: args.input.chatId,
        messageId: regenerateMessageId,
        content,
        characterId: null,
        thinking: thinking || undefined,
        generationReplay,
        chatSummaryFingerprint: args.chatSummaryFingerprint,
        promptSnapshot,
        providerMetadata,
        spriteExpressions: args.spriteExpressions,
        agentExtra,
      });
    }

    return args.storage.createChatMessage(args.input.chatId, {
      role: "user",
      characterId: null,
      content,
      extra: {
        isGenerated: true,
        ...(thinking ? { thinking } : {}),
        ...(generationReplay ? { generationReplay } : {}),
        ...(args.spriteExpressions ? { spriteExpressions: args.spriteExpressions } : {}),
        ...agentExtra,
        ...(promptSnapshot
          ? {
              generationPromptSnapshot: promptSnapshot,
            }
          : {}),
        chatSummaryFingerprint: args.chatSummaryFingerprint,
      },
    });
  }

  if (regenerateMessageId && regenerationTargetRole === "user") {
    return saveRegeneratedMessage({
      storage: args.storage,
      chatId: args.input.chatId,
      messageId: regenerateMessageId,
      content,
      characterId: null,
      thinking: thinking || undefined,
      generationReplay,
      chatSummaryFingerprint: args.chatSummaryFingerprint,
      promptSnapshot,
      providerMetadata,
      spriteExpressions: args.spriteExpressions,
      agentExtra,
    });
  }

  if (regenerateMessageId) {
    const characterId = assistantMessageCharacterId(args.chat, args.input);
    const assistantContent = roleplayAssistantSaveContent({ chat: args.chat, characters: args.characters, content });
    return saveRegeneratedMessage({
      storage: args.storage,
      llm: args.llm,
      connection: args.connection,
      chat: args.chat,
      characters: args.characters,
      chatId: args.input.chatId,
      messageId: regenerateMessageId,
      content: assistantContent,
      sourceContent: content,
      ...(characterId ? { characterId } : {}),
      thinking: thinking || undefined,
      generationReplay,
      chatSummaryFingerprint: args.chatSummaryFingerprint,
      promptSnapshot,
      providerMetadata,
      spriteExpressions: args.spriteExpressions,
      agentExtra,
    });
  }

  const characterId = assistantMessageCharacterId(args.chat, args.input);
  const assistantContent = roleplayAssistantSaveContent({ chat: args.chat, characters: args.characters, content });

  const saved = await args.storage.createChatMessage(args.input.chatId, {
    role: "assistant",
    characterId,
    content: assistantContent,
    extra: {
      ...(args.attachments?.length ? { attachments: args.attachments } : {}),
      ...(thinking ? { thinking } : {}),
      ...(providerMetadata ? { providerMetadata } : {}),
      ...(generationReplay ? { generationReplay } : {}),
      ...(args.spriteExpressions ? { spriteExpressions: args.spriteExpressions } : {}),
      ...agentExtra,
      ...(promptSnapshot
        ? {
            generationPromptSnapshot: promptSnapshot,
          }
        : {}),
      chatSummaryFingerprint: args.chatSummaryFingerprint,
    },
    generationInfo: {
      connectionId: readString(args.connection.id) || null,
      model: readString(args.connection.model) || null,
      agentResults: args.agentResults.length,
      notes: args.noteCount,
      usage: args.usage ?? null,
    },
  });
  return (
    (await patchSavedRoleplayDialogueAttributions({
      storage: args.storage,
      llm: args.llm,
      connection: args.connection,
      chat: args.chat,
      characters: args.characters,
      messageId: messageId(saved),
      sourceContent: content,
    })) ?? saved
  );
}

async function saveRegeneratedMessage(args: {
  storage: StorageGateway;
  llm?: LlmGateway;
  connection?: JsonRecord;
  chat?: JsonRecord;
  characters?: GenerationCharacterContext[];
  sourceContent?: string;
  chatId: string;
  messageId: string;
  content: string;
  characterId?: string | null;
  thinking?: string | null;
  generationReplay: GenerationReplay | null;
  chatSummaryFingerprint: string | null;
  promptSnapshot: GenerationPromptSnapshot | null;
  providerMetadata?: Record<string, unknown> | null;
  spriteExpressions?: Record<string, string> | null;
  agentExtra?: Record<string, unknown> | null;
}): Promise<unknown | null> {
  const swipeExtra = swipeScopedGenerationExtra({
    generationReplay: args.generationReplay,
    chatSummaryFingerprint: args.chatSummaryFingerprint,
    thinking: args.thinking,
    promptSnapshot: args.promptSnapshot,
    providerMetadata: args.providerMetadata,
    spriteExpressions: args.spriteExpressions,
    agentExtra: args.agentExtra,
  });
  if (args.chat && args.characters && args.sourceContent) {
    const canonicalContent = args.content;
    const deterministicAttributions = roleplayDeterministicDialogueAttributions({
      chat: args.chat,
      characters: args.characters,
      sourceContent: args.sourceContent,
      canonicalContent,
    });
    if (deterministicAttributions) swipeExtra.dialogueAttributions = deterministicAttributions;
  }
  await args.storage.addChatMessageSwipe(
    args.chatId,
    args.messageId,
    args.content,
    swipeOptionsWithCharacterId(swipeExtra, args),
  );
  let dialogueAttributions: DialogueAttributionsExtra | null = null;
  if (args.chat && args.characters && args.sourceContent && args.llm && args.connection) {
    const saved = await args.storage.getChatMessage<JsonRecord>(args.messageId, { fields: ["content"] });
    const canonicalContent = readString(saved?.content);
    if (canonicalContent) {
      dialogueAttributions = await roleplayCanonicalDialogueAttributions({
        llm: args.llm,
        connection: args.connection,
        chat: args.chat,
        characters: args.characters,
        sourceContent: args.sourceContent,
        canonicalContent,
      });
    }
  }
  const extraPatch = generationReplayExtraPatch({
    generationReplay: args.generationReplay,
    chatSummaryFingerprint: args.chatSummaryFingerprint,
    thinking: args.thinking,
    promptSnapshot: args.promptSnapshot,
    providerMetadata: args.providerMetadata,
    spriteExpressions: args.spriteExpressions,
    agentExtra: args.agentExtra,
  });
  if (dialogueAttributions) extraPatch.dialogueAttributions = dialogueAttributions;
  return args.storage.patchChatMessageExtra(args.messageId, extraPatch);
}

function swipeOptionsWithCharacterId(
  extra: Record<string, unknown>,
  args: { characterId?: string | null },
): AddChatMessageSwipeOptions {
  const options: AddChatMessageSwipeOptions = { extra };
  if (Object.prototype.hasOwnProperty.call(args, "characterId")) {
    options.characterId = args.characterId ?? null;
  }
  return options;
}

function swipeScopedGenerationExtra(args: {
  generationReplay: GenerationReplay | null;
  chatSummaryFingerprint: string | null;
  thinking?: string | null;
  promptSnapshot?: GenerationPromptSnapshot | null;
  providerMetadata?: Record<string, unknown> | null;
  spriteExpressions?: Record<string, string> | null;
  agentExtra?: Record<string, unknown> | null;
}): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  if (args.generationReplay) extra.generationReplay = args.generationReplay;
  extra.chatSummaryFingerprint = args.chatSummaryFingerprint;
  const trimmedThinking = collapseExcessBlankLines(readString(args.thinking).trim());
  if (trimmedThinking) extra.thinking = trimmedThinking;
  if (args.providerMetadata && Object.keys(args.providerMetadata).length > 0) {
    extra.providerMetadata = args.providerMetadata;
  }
  if (args.spriteExpressions && Object.keys(args.spriteExpressions).length > 0) {
    extra.spriteExpressions = args.spriteExpressions;
  }
  if (args.agentExtra) Object.assign(extra, args.agentExtra);
  if (args.promptSnapshot) extra.generationPromptSnapshot = args.promptSnapshot;
  return extra;
}

function generationReplayExtraPatch(args: {
  generationReplay: GenerationReplay | null;
  chatSummaryFingerprint: string | null;
  thinking?: string | null;
  promptSnapshot?: GenerationPromptSnapshot | null;
  providerMetadata?: Record<string, unknown> | null;
  spriteExpressions?: Record<string, string> | null;
  agentExtra?: Record<string, unknown> | null;
}): Record<string, unknown> {
  const extraPatch: Record<string, unknown> = {};
  if (args.generationReplay) extraPatch.generationReplay = args.generationReplay;
  extraPatch.chatSummaryFingerprint = args.chatSummaryFingerprint;
  const trimmedThinking = collapseExcessBlankLines(readString(args.thinking).trim());
  if (trimmedThinking) extraPatch.thinking = trimmedThinking;
  if (args.providerMetadata && Object.keys(args.providerMetadata).length > 0) {
    extraPatch.providerMetadata = args.providerMetadata;
  }
  if (args.spriteExpressions && Object.keys(args.spriteExpressions).length > 0) {
    extraPatch.spriteExpressions = args.spriteExpressions;
  }
  if (args.agentExtra) Object.assign(extraPatch, args.agentExtra);
  if (args.promptSnapshot) {
    extraPatch.generationPromptSnapshot = args.promptSnapshot;
  }
  return extraPatch;
}

function savedGenerationEventType(
  input: StartGenerationInput,
  regenerationTarget?: JsonRecord | null,
): "assistant_message" | "user_message" {
  if (input.impersonate === true || isUserRegenerationTarget(regenerationTarget ?? null)) return "user_message";
  return "assistant_message";
}

function savedGenerationEventData(saved: unknown): unknown {
  if (!isRecord(saved)) return saved;
  const { swipes: _swipes, ...withoutSwipes } = saved;
  const extra = parseRecord(withoutSwipes.extra);
  const { generationPromptSnapshotsBySwipe: _generationPromptSnapshotsBySwipe, ...timelineExtra } = extra;
  return { ...withoutSwipes, extra: timelineExtra };
}

/**
 * Mutable sink the streaming loop fills with the accumulated turn so the caller
 * can recover the partial assistant text after an abort. The loop writes these
 * fields in a `finally`, so they are populated even when the stream throws an
 * `AbortError` before returning.
 */
interface StreamPartialSink {
  content: string;
  thinking: string;
  usage: unknown;
  providerMetadata: unknown;
  promptSnapshot: MainGenerationPromptSnapshot | null;
}

/**
 * On a Stop mid-stream, persist whatever the model has already produced so the
 * partial assistant message is not lost. Returns the saved row (so the caller
 * can emit an `assistant_message` event for it) or null when there is nothing
 * worth saving. Reuses `saveAssistantMessage`, preserving impersonate and
 * regenerate routing. Post-save agent / illustration / tracker work is skipped:
 * the caller rethrows the abort right after this, before any of that runs.
 */
async function persistPartialOnAbort(args: {
  deps: GenerationEngineDeps;
  chat: JsonRecord;
  characters: GenerationCharacterContext[];
  input: StartGenerationInput;
  connection: JsonRecord;
  llm: LlmGateway;
  partial: StreamPartialSink;
  chatSummaryFingerprint: string | null;
  signal: AbortSignal | undefined;
  existingExtra?: unknown;
  regenerationTarget?: JsonRecord | null;
}): Promise<unknown | null> {
  if (!args.signal?.aborted) return null;
  if (!args.partial.content.trim()) return null;
  try {
    return await saveAssistantMessage({
      storage: args.deps.storage,
      chat: args.chat,
      characters: args.characters,
      input: args.input,
      connection: args.connection,
      llm: args.deps.llm,
      content: args.partial.content,
      thinking: args.partial.thinking,
      agentResults: [],
      noteCount: 0,
      chatSummaryFingerprint: args.chatSummaryFingerprint,
      usage: args.partial.usage,
      providerMetadata: args.partial.providerMetadata,
      promptSnapshot: args.partial.promptSnapshot,
      existingExtra: args.existingExtra,
      regenerationTarget: args.regenerationTarget,
    });
  } catch {
    return null;
  }
}

function messageId(saved: unknown): string | null {
  return isRecord(saved) ? readString(saved.id) || null : null;
}

function savedMessageExtra(saved: unknown): JsonRecord {
  return isRecord(saved) ? parseRecord(saved.extra) : {};
}

function savedMessageAttachments(saved: unknown): JsonRecord[] {
  const attachments = savedMessageExtra(saved).attachments;
  if (!Array.isArray(attachments)) return [];
  return attachments.filter((attachment): attachment is JsonRecord => isRecord(attachment));
}

async function patchSavedMessageAgentExtra(args: {
  storage: StorageGateway;
  chat: JsonRecord;
  storedMessages: JsonRecord[];
  saved: unknown;
  results: AgentResult[];
  contextInjections?: AgentInjectionOverride[] | null;
  availableSprites: AvailableSpriteCharacter[];
}): Promise<unknown[]> {
  const id = messageId(args.saved);
  if (!id) return [];
  const target = isRecord(args.saved) ? args.saved : null;
  const existingExtra = savedMessageExtra(args.saved);
  const extraPatch = agentExtraFromResults({
    results: args.results,
    contextInjections: args.contextInjections,
    existingExtra,
    mergeContextInjectionUpdates: true,
  });
  const spriteExpressionPatches = spriteExpressionPatchesForTarget({
    chat: args.chat,
    messages: args.storedMessages,
    target,
    results: args.results,
    availableSprites: args.availableSprites,
  });
  const targetSpritePatch = spriteExpressionPatches.find((patch) => patch.messageId === id);
  if (targetSpritePatch) {
    extraPatch.spriteExpressions = targetSpritePatch.spriteExpressions;
  }
  const messageExtraPatches: MessageExtraPatchForGeneration[] = [];
  if (Object.keys(extraPatch).length > 0) {
    messageExtraPatches.push({ messageId: id, patch: extraPatch });
  }
  for (const patch of spriteExpressionPatches) {
    if (patch.messageId === id) continue;
    messageExtraPatches.push({ messageId: patch.messageId, patch: { spriteExpressions: patch.spriteExpressions } });
  }
  return patchMessageExtrasForGeneration(args.storage, messageExtraPatches);
}

async function appendSavedMessageAttachments(args: {
  storage: StorageGateway;
  saved: unknown;
  attachments: JsonRecord[];
}): Promise<unknown | null> {
  const id = messageId(args.saved);
  if (!id || args.attachments.length === 0) return null;
  return args.storage.patchChatMessageExtra(id, {
    attachments: [...savedMessageAttachments(args.saved), ...args.attachments],
  });
}

async function persistAgentMessageExtraForTarget(
  storage: StorageGateway,
  chat: JsonRecord,
  storedMessages: JsonRecord[],
  target: JsonRecord | null,
  results: AgentResult[],
  contextInjections: AgentInjectionOverride[] | null,
  availableSprites: AvailableSpriteCharacter[],
): Promise<unknown[]> {
  const messageId = readString(target?.id).trim();
  if (!messageId) return [];
  const extraPatch = agentExtraFromResults({
    results,
    contextInjections,
    existingExtra: target?.extra,
    mergeContextInjectionUpdates: true,
  });

  const spriteExpressionPatches = spriteExpressionPatchesForTarget({
    chat,
    messages: storedMessages,
    target,
    results,
    availableSprites,
  });
  const targetSpritePatch = spriteExpressionPatches.find((patch) => patch.messageId === messageId);
  if (targetSpritePatch) {
    extraPatch.spriteExpressions = targetSpritePatch.spriteExpressions;
  }
  const messageExtraPatches: MessageExtraPatchForGeneration[] = [];
  if (Object.keys(extraPatch).length > 0) {
    messageExtraPatches.push({ messageId, patch: extraPatch });
  }
  for (const patch of spriteExpressionPatches) {
    if (patch.messageId === messageId) continue;
    messageExtraPatches.push({ messageId: patch.messageId, patch: { spriteExpressions: patch.spriteExpressions } });
  }
  return patchMessageExtrasForGeneration(storage, messageExtraPatches);
}

function targetAssistantMessage(messages: JsonRecord[], options: Record<string, unknown> = {}): JsonRecord | null {
  const requestedId = readString(options.forMessageId).trim();
  if (requestedId) {
    return messages.find((message) => readString(message.id) === requestedId) ?? null;
  }
  return [...messages].reverse().find((message) => readString(message.role) === "assistant") ?? null;
}

function messageIndex(messages: JsonRecord[], target: JsonRecord | null): number {
  const id = readString(target?.id).trim();
  if (!id) return -1;
  return messages.findIndex((message) => readString(message.id).trim() === id);
}

function messagesBeforeTarget(messages: JsonRecord[], target: JsonRecord | null): JsonRecord[] {
  const index = messageIndex(messages, target);
  return index >= 0 ? messages.slice(0, index) : messages;
}

function positiveInteger(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.trunc(value));
}

function nonNegativeInteger(value: unknown, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.trunc(value));
}

function lorebookKeeperReadBehind(chat: JsonRecord): number {
  return nonNegativeInteger(parseRecord(chat.metadata).lorebookKeeperReadBehindMessages, 0);
}

function agentType(agent: JsonRecord): string {
  return readString(agent.type || agent.agentType).trim();
}

function agentSettings(agent: JsonRecord): JsonRecord {
  return parseRecord(agent.settings);
}

function lorebookKeeperRunInterval(agent: JsonRecord | null): number {
  return positiveInteger(agent ? agentSettings(agent).runInterval : null, DEFAULT_LOREBOOK_KEEPER_RUN_INTERVAL);
}

function chatActiveAgentIds(chat: JsonRecord): Set<string> {
  return enabledChatAgentIdSet(parseRecord(chat.metadata), readString(chat.mode || chat.chatMode).trim());
}

function chatHasLorebookKeeperEnabled(chat: JsonRecord, agent: JsonRecord): boolean {
  if (agentType(agent) !== LOREBOOK_KEEPER_AGENT_TYPE) return false;
  const activeAgentIds = chatActiveAgentIds(chat);
  if (activeAgentIds.size > 0) {
    const id = readString(agent.id).trim();
    return activeAgentIds.has(LOREBOOK_KEEPER_AGENT_TYPE) || (id ? activeAgentIds.has(id) : false);
  }
  return false;
}

async function lorebookKeeperAgent(storage: StorageGateway, chat: JsonRecord): Promise<JsonRecord | null> {
  const agents = await storage.list<JsonRecord>("agents").catch(() => []);
  const persisted = agents.find((agent) => chatHasLorebookKeeperEnabled(chat, agent)) ?? null;
  if (persisted) return persisted;
  const activeAgentIds = chatActiveAgentIds(chat);
  if (activeAgentIds.has(LOREBOOK_KEEPER_AGENT_TYPE)) {
    return buildBuiltInAgentFallback(LOREBOOK_KEEPER_AGENT_TYPE, { allowDisabled: true });
  }
  return null;
}

async function successfulLorebookKeeperMessageIds(
  storage: StorageGateway,
  chatId: string,
  candidateMessageIds: string[],
): Promise<Set<string>> {
  const messageIds = Array.from(new Set(candidateMessageIds.map((id) => id.trim()).filter(Boolean)));
  if (messageIds.length === 0) return new Set();
  const runs = await storage
    .list<JsonRecord>("agent-runs", {
      whereIn: { field: "messageId", values: messageIds },
      fields: LOREBOOK_KEEPER_RUN_SCAN_FIELDS,
    })
    .catch(() => []);
  return new Set(
    runs
      .filter((run) => readString(run.chatId || run.chat_id).trim() === chatId)
      .filter((run) => {
        const type = readString(run.agentType || run.agent_type || run.type).trim();
        const configId = readString(run.agentConfigId || run.agent_config_id).trim();
        return type === LOREBOOK_KEEPER_AGENT_TYPE || configId === `builtin:${LOREBOOK_KEEPER_AGENT_TYPE}`;
      })
      .filter((run) => boolish(run.success, false))
      .map((run) => readString(run.messageId || run.message_id).trim())
      .filter(Boolean),
  );
}

function lorebookKeeperBackfillMessageScanLimit(options: { readBehind: number; runInterval: number }): number {
  return options.readBehind + options.runInterval * MAX_LOREBOOK_KEEPER_BACKFILL_CANDIDATES;
}

interface LorebookKeeperTarget {
  message: JsonRecord;
}

function lorebookKeeperBackfillTargets(
  storedMessages: JsonRecord[],
  processedMessageIds: Set<string>,
  options: { readBehind: number; runInterval: number },
): LorebookKeeperTarget[] {
  const assistantMessages = storedMessages
    .filter((message) => !hiddenFromAi(message))
    .filter((message) => readString(message.role).trim() === "assistant")
    .filter((message) => {
      if (!readString(message.id).trim()) return false;
      if (!Object.prototype.hasOwnProperty.call(message, "content")) return true;
      return !!readString(message.content).trim();
    });
  const eligibleCount = Math.max(0, assistantMessages.length - options.readBehind);
  const targets: LorebookKeeperTarget[] = [];

  for (let ordinal = options.runInterval; ordinal <= eligibleCount; ordinal += options.runInterval) {
    const message = assistantMessages[ordinal - 1]!;
    const id = readString(message.id).trim();
    if (processedMessageIds.has(id)) continue;
    targets.push({ message });
  }

  return targets;
}

function isLorebookKeeperBackfill(input: RetryAgentsInput): boolean {
  return (
    input.options?.lorebookKeeperBackfill === true &&
    Array.isArray(input.agentTypes) &&
    input.agentTypes.some((type) => readString(type).trim() === LOREBOOK_KEEPER_AGENT_TYPE)
  );
}

function retryBypassesCustomAgentActivation(input: RetryAgentsInput): boolean {
  return boolish(parseRecord(input.options).bypassActivation, false);
}

function secretPlotRerollMode(input: RetryAgentsInput): SecretPlotRerollMode | null {
  const mode = readString(input.options?.secretPlotRerollMode).trim();
  return mode === "full" || mode === "turn_only" ? mode : null;
}

async function commitVisibleTrackerSnapshotSafely(
  storage: StorageGateway,
  chatId: string,
  messages: JsonRecord[],
): Promise<void> {
  try {
    await commitTrackerSnapshotForTarget(storage, chatId, resolveVisibleGameStateAnchor(messages));
  } catch (error) {
    console.warn("[generation] tracker snapshot commit failed", error);
  }
}

async function selectGenerationTrackerBaseline(
  storage: StorageGateway,
  chatId: string,
  input: StartGenerationInput,
  prepared: PreparedUserInput,
  storedMessages: JsonRecord[],
): Promise<GameState | null> {
  const regenerateMessageId = readString(input.regenerateMessageId).trim();
  const visibleAnchor = regenerateMessageId
    ? resolveRegenerationGameStateAnchor(storedMessages, regenerateMessageId)
    : resolveVisibleGameStateAnchor(storedMessages);
  return selectTrackerSnapshotForGeneration(storage, chatId, {
    preferLatestVisible: shouldPreferLatestVisibleGameState({
      attachments: prepared.attachments,
      impersonate: input.impersonate,
      regenerateMessageId,
      userMessage: inputUserMessage(input),
    }),
    visibleAnchor,
    excludeMessageId: regenerateMessageId || null,
    fallbackTargets:
      resolveRegenerationGameStateFallbackMessageIds(storedMessages, regenerateMessageId) ??
      resolveVisibleGameStateFallbackMessageIds(storedMessages),
  });
}

async function runGenerationAgentsForTarget(args: {
  deps: GenerationEngineDeps;
  input: RetryAgentsInput;
  chat: JsonRecord;
  connection: JsonRecord;
  storedMessages: JsonRecord[];
  target: JsonRecord | null;
  agentTypes: Set<string>;
  signal?: AbortSignal;
}): Promise<{ results: AgentResult[]; events: GenerationEvent[] }> {
  const { deps, input, chat, connection, storedMessages, target, agentTypes, signal } = args;
  const chatId = readString(input.chatId).trim();
  const targetTrackerTarget = trackerSnapshotTargetFromMessage(target);
  const trackerReadContext = await createTrackerSnapshotReadContext(deps.storage, chatId);
  const retryBaseline = await selectTrackerSnapshotForGeneration(
    deps.storage,
    chatId,
    {
      preferLatestVisible: true,
      visibleAnchor: targetTrackerTarget,
      excludeMessageId: targetTrackerTarget?.messageId ?? null,
      fallbackTargets: resolveRegenerationGameStateFallbackMessageIds(storedMessages, targetTrackerTarget?.messageId),
    },
    trackerReadContext,
  );
  const targetSnapshot = await getTrackerSnapshotForTarget(
    deps.storage,
    chatId,
    targetTrackerTarget,
    trackerReadContext,
  );
  const chatForAgents =
    (targetSnapshot ?? retryBaseline) ? { ...chat, gameState: targetSnapshot ?? retryBaseline } : chat;
  const contextMessages = messagesBeforeTarget(storedMessages, target);
  const assembly = await assembleGenerationPrompt(deps.storage, {
    chat: chatForAgents,
    storedMessages: contextMessages,
    connection,
    request: input,
    latestUserInput: "",
    embeddingSource: generationEmbeddingSource(deps.llm, connection),
    visuals: deps.visuals,
    persistPromptVariables: true,
  });
  const results: AgentResult[] = [];
  const runtime = await createGenerationAgentRuntime(
    { storage: deps.storage, llm: deps.llm, integrations: deps.integrations, visuals: deps.visuals },
    {
      chat: chatForAgents,
      connection,
      storedMessages: contextMessages,
      cadenceMessages: storedMessages,
      characters: assembly.characters,
      persona: assembly.persona,
      activatedLorebookEntries: assembly.activatedLorebookEntries,
      chatSummary: assembly.chatSummary,
      embeddingSource: generationEmbeddingSource(deps.llm, connection),
      agentTypes,
      bypassCustomAgentActivation: retryBypassesCustomAgentActivation(input),
      hideAutomatedSummarySourceMessages: input.hideAutomatedSummarySourceMessages === true,
      signal,
      regenerateMessageId: readString(input.regenerateMessageId).trim() || null,
      spotifyDjManualRetry: agentTypes.has("spotify") || agentTypes.has("music-dj"),
      spotifyDjForceFreshPick: agentTypes.has("spotify") || agentTypes.has("music-dj"),
    },
    (result) => results.push(result),
  );
  const mainResponse = target ? readString(target.content) : "";
  results.push(...(await runtime.runParallel()));
  results.push(...(await runtime.runPost(mainResponse)));

  const unique = new Map<string, AgentResult>();
  for (const result of [...runtime.preResults, ...results]) {
    unique.set(resultKey(result), result);
  }
  let speculativeResults = [...unique.values()];
  const manualIllustratorFallback = manualIllustratorFallbackResult({
    target,
    illustratorManualRequest: input.options?.illustratorManualRequest === true,
    agentTypes,
    results: speculativeResults,
  });
  if (manualIllustratorFallback) {
    speculativeResults = [
      ...speculativeResults.filter((result) => !isIllustratorResult(result)),
      manualIllustratorFallback,
    ];
  }
  const isManualIllustratorRetryWithoutPrompt =
    target !== null &&
    input.options?.illustratorManualRequest === true &&
    agentTypes.has("illustrator") &&
    !speculativeResults.some((result) => illustratorPromptData(result) !== null);
  if (
    shouldReturnManualIllustratorRetryWithoutCommit({
      hasTarget: target !== null,
      illustratorManualRequest: input.options?.illustratorManualRequest === true,
      agentTypes,
      results: speculativeResults,
    })
  ) {
    return {
      results: speculativeResults,
      events: [
        ...runtime.agentWarnings.map((warning): GenerationEvent => ({ type: "agent_warning", data: warning })),
        {
          type: "illustration_error",
          data: { error: "Illustrator did not return an image prompt for this message." },
        },
      ],
    };
  }

  let finalResults = speculativeResults;
  finalResults = await generateTrackerAvatarsForResults({
    deps,
    chat: chatForAgents,
    results: finalResults,
    baseline: targetSnapshot ?? retryBaseline,
    signal,
  });
  const patchedMessages = await persistAgentMessageExtraForTarget(
    deps.storage,
    chatForAgents,
    storedMessages,
    target,
    finalResults,
    runtime.preInjections,
    runtime.availableSprites,
  );
  if (target) {
    await persistTrackerSnapshotSafely(
      deps.storage,
      chatId,
      target,
      finalResults,
      retryBaseline,
      mainResponse,
      deps.onTrackerSnapshotSaved,
    );
  }
  await persistSecretPlotAgentMemorySafely(deps.storage, chatId, finalResults, {
    rerollMode: secretPlotRerollMode(input),
  });
  await persistAgentResults(deps.storage, chatId, target ? readString(target.id) || null : null, finalResults);

  const events: GenerationEvent[] = runtime.agentWarnings.map((warning) => ({ type: "agent_warning", data: warning }));
  for (const patched of patchedMessages) {
    events.push({ type: "message", data: savedGenerationEventData(patched) });
  }
  const hasIllustrationRequest = finalResults.some((result) => illustratorPromptData(result) !== null);
  if (isManualIllustratorRetryWithoutPrompt && !hasIllustrationRequest) {
    events.push({
      type: "illustration_error",
      data: { error: "Illustrator did not return an image prompt for this message." },
    });
  }
  if (target && hasIllustrationRequest) {
    const illustration = await generateIllustrationAttachments({
      deps,
      chat: chatForAgents,
      results: finalResults,
      signal,
    });
    events.push(...illustration.events);
    await appendSavedMessageAttachments({
      storage: deps.storage,
      saved: target,
      attachments: illustration.attachments,
    });
  }

  return { results: finalResults, events };
}

async function runLorebookKeeperBackfill(
  deps: GenerationEngineDeps,
  input: RetryAgentsInput,
  args: {
    chat: JsonRecord;
    connection: JsonRecord;
    storedMessages?: JsonRecord[];
    signal?: AbortSignal;
  },
): Promise<{ results: AgentResult[]; events: GenerationEvent[] }> {
  const chatId = readString(input.chatId).trim();
  const agent = await lorebookKeeperAgent(deps.storage, args.chat);
  if (!agent) return { results: [], events: [] };

  const backfillOptions = {
    readBehind: lorebookKeeperReadBehind(args.chat),
    runInterval: lorebookKeeperRunInterval(agent),
  };
  const storedMessages =
    args.storedMessages ??
    (
      await deps.storage.listChatMessages<unknown>(chatId, {
        role: "assistant",
        limit: lorebookKeeperBackfillMessageScanLimit(backfillOptions),
        fields: LOREBOOK_KEEPER_BACKFILL_TARGET_SCAN_FIELDS,
        fieldSelections: { extra: ["hiddenFromAI", "hiddenFromAi"] },
      })
    ).filter(isRecord);
  const candidateTargets = lorebookKeeperBackfillTargets(storedMessages, new Set(), backfillOptions).slice(
    0,
    MAX_LOREBOOK_KEEPER_BACKFILL_CANDIDATES,
  );
  const processedMessageIds = await successfulLorebookKeeperMessageIds(
    deps.storage,
    chatId,
    candidateTargets.map((target) => readString(target.message.id).trim()),
  );
  const targets = candidateTargets
    .filter((target) => !processedMessageIds.has(readString(target.message.id).trim()))
    .slice(0, MAX_LOREBOOK_KEEPER_BACKFILL_RUNS);
  const agentTypes = new Set([LOREBOOK_KEEPER_AGENT_TYPE]);
  const allResults: AgentResult[] = [];
  const allEvents: GenerationEvent[] = [];

  for (const target of targets) {
    const targetMessages = await loadMessagesForGenerationTarget({
      storage: deps.storage,
      chatId,
      chat: args.chat,
      input,
      targetMessageId: readString(target.message.id).trim(),
    });
    const hydratedTarget =
      targetMessages.find((message) => readString(message.id).trim() === readString(target.message.id).trim()) ??
      target.message;
    if (!readString(hydratedTarget.content).trim()) continue;
    const run = await runGenerationAgentsForTarget({
      deps,
      input,
      chat: args.chat,
      connection: args.connection,
      storedMessages: targetMessages,
      target: hydratedTarget,
      agentTypes,
      signal: args.signal,
    });
    allResults.push(...run.results);
    allEvents.push(...run.events);
  }

  return { results: allResults, events: allEvents };
}

export async function retryGenerationAgents(
  deps: GenerationEngineDeps,
  input: RetryAgentsInput,
  signal?: AbortSignal,
): Promise<{ results: AgentResult[]; events: GenerationEvent[] }> {
  const chatId = readString(input.chatId).trim();
  if (!chatId) throw new Error("chatId is required");
  const agentTypes = Array.isArray(input.agentTypes)
    ? new Set(input.agentTypes.map((type) => readString(type).trim()).filter(Boolean))
    : new Set<string>();
  const chat = requireRecord(await deps.storage.get("chats", chatId), "Chat");
  assertChatCanGenerate(chat);
  const connection = await resolveGenerationConnection(deps.storage, chat, input);
  if (isLorebookKeeperBackfill(input)) {
    return runLorebookKeeperBackfill(deps, input, { chat, connection, signal });
  }
  const targetMessageId = readString(input.options?.forMessageId).trim();
  const storedMessages = await loadMessagesForGenerationTarget({
    storage: deps.storage,
    chatId,
    chat,
    input,
    targetMessageId,
  });
  const target = targetAssistantMessage(storedMessages, input.options);
  return runGenerationAgentsForTarget({ deps, input, chat, connection, storedMessages, target, agentTypes, signal });
}

function appendDryRunUserMessage(
  storedMessages: JsonRecord[],
  chatId: string,
  prepared: PreparedUserInput,
  input: StartGenerationInput,
): JsonRecord[] {
  if (!shouldSaveUserMessage(input, prepared)) return storedMessages;
  return [
    ...storedMessages,
    {
      id: `dry-run-user-${Date.now()}`,
      chatId,
      role: "user",
      content: prepared.content,
      extra: prepared.attachments.length ? { attachments: prepared.attachments } : {},
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
  ];
}

export async function* dryRunGeneration(
  deps: GenerationEngineDeps,
  input: GenerationDryRunInput,
  signal?: AbortSignal,
): AsyncGenerator<GenerationDryRunEvent> {
  input = normalizeStartGenerationInput(input) as GenerationDryRunInput;
  const runId = readString(input.runId).trim() || null;
  const chatId = readString(input.chatId).trim();
  if (!chatId) throw new Error("chatId is required");
  throwIfAborted(signal);
  const chat = requireRecord(await deps.storage.get("chats", chatId), "Chat");
  throwIfAborted(signal);
  input = (await inputWithStoredGenerationReplay(deps.storage, chat, chatId, input)) as GenerationDryRunInput;
  throwIfAborted(signal);
  assertChatCanGenerate(chat, input);

  yield { type: "dry_run_start", data: { runId } };
  yield { type: "phase", data: "Preparing dry run..." };
  const preparedUserInput = await prepareDryRunUserInput(deps.storage, input);
  throwIfAborted(signal);
  const connection = await resolveGenerationConnection(deps.storage, chat, input);
  throwIfAborted(signal);
  for (const warning of [
    ...preparedUserInput.imageWarnings,
    ...applyImageAttachmentConnectionSupport(preparedUserInput, connection),
  ]) {
    yield { type: "agent_warning", data: warning };
  }
  let storedMessages = await loadMessagesForGenerationTarget({ storage: deps.storage, chatId, chat, input });
  storedMessages = appendDryRunUserMessage(storedMessages, chatId, preparedUserInput, input);
  const regenerationTarget = regenerationTargetFromMessages(storedMessages, input.regenerateMessageId);
  const userRegenerationSourceMessage = await userMessageRegenerationSourceMessage(
    deps.storage,
    chatId,
    regenerationTarget,
  );
  let generationMessages = messagesBeforeRegenerationTarget(storedMessages, input.regenerateMessageId);
  const storedImageDelivery = await resolveStoredImageAttachmentsForPrompt(deps.storage, generationMessages);
  generationMessages = storedImageDelivery.messages;
  const storedImageConnectionSupport = applyStoredImageAttachmentConnectionSupport(generationMessages, connection);
  generationMessages = storedImageConnectionSupport.messages;
  for (const warning of [...storedImageDelivery.warnings, ...storedImageConnectionSupport.warnings]) {
    yield { type: "agent_warning", data: warning };
  }
  const latestUserInput =
    userRegenerationSourceMessage?.content || preparedUserInput.content || inputUserMessage(input);
  const generationTrackerBaseline = await selectGenerationTrackerBaseline(
    deps.storage,
    chatId,
    input,
    preparedUserInput,
    storedMessages,
  );
  let chatForGeneration = generationTrackerBaseline ? { ...chat, gameState: generationTrackerBaseline } : chat;
  const directMessages = requestMessages(input);
  if (!directMessages) {
    chatForGeneration = await withRuntimeConversationCommandCapabilities(chatForGeneration, deps.integrations);
    throwIfAborted(signal);
  }

  yield { type: "phase", data: "Assembling dry-run prompt..." };
  const assembly = await assembleGenerationPrompt(deps.storage, {
    chat: chatForGeneration,
    storedMessages: generationMessages,
    connection,
    request: input,
    latestUserInput,
    userRegenerationSourceMessage,
    embeddingSource: generationEmbeddingSource(deps.llm, connection),
    visuals: deps.visuals,
    persistPromptVariables: false,
  });
  throwIfAborted(signal);

  const continueAssistantResponse = shouldContinueAssistantResponse(input, preparedUserInput, generationMessages);
  const directivePromptMessages = directiveMessages(
    input,
    chat,
    assembly.characters,
    assembly.persona,
    preparedUserInput,
    { continueAssistantResponse },
  );
  const prompt = withImageAttachments(
    [...(directMessages ?? assembly.messages), ...directivePromptMessages],
    preparedUserInput.images,
  );
  const promptPreviewMessages = withImageAttachments(
    [...assembly.previewMessages, ...directivePromptMessages],
    preparedUserInput.images,
  );
  const baseMessages: LlmMessage[] = withUserMessageRegenerationRewritePrompt(
    [...prompt, ...generationGuideMessages(input)].filter((message): message is LlmMessage => !!message),
    assembly.userRegenerationSourceMessage,
  );
  const dryRunPartial: StreamPartialSink = {
    content: "",
    thinking: "",
    usage: null,
    providerMetadata: null,
    promptSnapshot: null,
  };
  let streamedContent = "";
  let streamedThinking = "";
  let usage: unknown = null;
  let providerMetadata: unknown = null;
  let promptSnapshot: MainGenerationPromptSnapshot | null = null;

  yield { type: "phase", data: "Calling model for dry run..." };
  ({
    content: streamedContent,
    thinking: streamedThinking,
    usage,
    providerMetadata,
    promptSnapshot,
  } = yield* streamMainGenerationLoop({
    deps,
    connection,
    input,
    chat: chatForGeneration,
    parameters: llmParameters(connection, input, chatForGeneration, assembly.parameters),
    baseMessages,
    previewMessages: withUserMessageRegenerationRewritePrompt(
      [...promptPreviewMessages, ...generationGuideMessages(input)].filter(
        (message): message is LlmMessage => !!message,
      ),
      assembly.userRegenerationSourceMessage,
    ),
    contextAttribution: generationContextAttribution(assembly.contextAttributionItems),
    promptPresetId: assembly.promptPresetId,
    mainTools: null,
    toolRuntimeInput: {
      chat: chatForGeneration,
      storedMessages: generationMessages,
      activatedLorebookEntries: assembly.activatedLorebookEntries,
      characters: assembly.characters,
      persona: assembly.persona,
      chatSummary: assembly.chatSummary,
      hideAutomatedSummarySourceMessages: input.hideAutomatedSummarySourceMessages === true,
    },
    signal,
    partial: dryRunPartial,
  }));
  throwIfAborted(signal);

  let content = await applyRuntimeRegexScripts(deps.storage, "ai_output", streamedContent);
  content = finalAssistantContent(input, content);
  if (content !== streamedContent) {
    yield { type: "content_replace", data: content };
  }
  const result: GenerationDryRunResult = {
    runId,
    content,
    thinking: streamedThinking,
    usage,
    providerMetadata,
    promptSnapshot,
    promptPresetId: assembly.promptPresetId,
    messageCount: promptSnapshot?.messages.length ?? baseMessages.length,
  };
  yield { type: "dry_run_result", data: result };
  yield { type: "done", data: { dryRun: result } };
}

export async function* startGeneration(
  deps: GenerationEngineDeps,
  input: StartGenerationInput,
  signal?: AbortSignal,
): AsyncGenerator<GenerationEvent> {
  const internalOptions = internalStartGenerationOptions.get(input) ?? {};
  input = normalizeStartGenerationInput(input);
  if (internalOptions.sameSendPeerContext) {
    input = { ...input, sameSendPeerContext: internalOptions.sameSendPeerContext };
  }
  const chatId = readString(input.chatId).trim();
  if (!chatId) throw new Error("chatId is required");
  throwIfAborted(signal);
  let chat = requireRecord(await deps.storage.get("chats", chatId), "Chat");
  throwIfAborted(signal);
  scheduleAutomaticMemoryCaptureQueueProcessing(deps.storage);
  input = await inputWithStoredGenerationReplay(deps.storage, chat, chatId, input);
  throwIfAborted(signal);
  assertChatCanGenerate(chat, input);

  const generationTimingStartedAt = () => Date.now();
  const generationTimingEvent = (
    name: string,
    startedAt: number,
    extra: Partial<Extract<GenerationEvent, { type: "diagnostic" }>["data"]> = {},
  ): GenerationEvent | null => {
    if (input.debugMode !== true) return null;
    const chatMode = readString(chat.mode || chat.chatMode, "conversation");
    const groupChatMode = readString(parseRecord(chat.metadata).groupChatMode).trim() || null;
    const targetCharacterId = readString(input.forCharacterId).trim() || null;
    return {
      type: "diagnostic",
      data: {
        kind: "timing",
        name,
        durationMs: Math.max(0, Date.now() - startedAt),
        chatId,
        chatMode,
        groupChatMode,
        characterCount: activeCharacterIds(chat).length,
        targetCharacterId,
        ...extra,
      },
    };
  };

  const saveUserMessageStartedAt = generationTimingStartedAt();
  yield { type: "phase", data: "Saving message..." };
  const preparedUserInput = await prepareUserInput(deps.storage, input, chat);
  let savesUserMessage = false;
  let savedUserMessage: unknown | null = null;
  let storedMessages: JsonRecord[] | null = null;
  const messageLoadOptions = generationMessageLoadOptions(chat, input);
  try {
    throwIfAborted(signal);
    savesUserMessage = shouldSaveUserMessage(input, preparedUserInput, internalOptions);
    if (!savesUserMessage) {
      await deletePreparedUserInputAttachmentsSafely(deps.storage, preparedUserInput, "non-persisted generation setup");
    }
    if (savesUserMessage) {
      storedMessages = await loadChatMessages(deps.storage, chatId, messageLoadOptions);
      throwIfAborted(signal);
      await commitVisibleTrackerSnapshotSafely(deps.storage, chatId, storedMessages);
      throwIfAborted(signal);
    }
    savedUserMessage = await saveUserMessage(deps.storage, chat, input, preparedUserInput, internalOptions);
  } catch (error) {
    await deletePreparedUserInputAttachmentsSafely(deps.storage, preparedUserInput, "failed user message save");
    throw error;
  }
  throwIfAborted(signal);
  if (savedUserMessage) yield { type: "user_message", data: savedGenerationEventData(savedUserMessage) };
  const saveUserMessageTiming = generationTimingEvent("save-user-message", saveUserMessageStartedAt, {
    savedUserMessage: !!savedUserMessage,
  });
  if (saveUserMessageTiming) yield saveUserMessageTiming;
  const prepareContextStartedAt = generationTimingStartedAt();
  const connection = await resolveGenerationConnection(deps.storage, chat, input);
  throwIfAborted(signal);
  for (const warning of [
    ...preparedUserInput.imageWarnings,
    ...applyImageAttachmentConnectionSupport(preparedUserInput, connection),
  ]) {
    yield { type: "agent_warning", data: warning };
  }
  let savedTimelineMessage: JsonRecord | null = null;
  if (savesUserMessage) {
    savedTimelineMessage = savedUserMessageForTimeline(savedUserMessage, chatId);
    storedMessages = savedTimelineMessage
      ? [...(storedMessages ?? []), savedTimelineMessage]
      : await loadChatMessages(deps.storage, chatId, messageLoadOptions);
  } else {
    storedMessages = await loadMessagesForGenerationTarget({ storage: deps.storage, chatId, chat, input });
  }
  chat = await prepareConversationSummariesForGeneration(deps, chat, input, connection, signal);
  throwIfAborted(signal);
  let regenerationTarget = regenerationTargetFromMessages(storedMessages, input.regenerateMessageId);
  const userRegenerationSourceMessage = await userMessageRegenerationSourceMessage(
    deps.storage,
    chatId,
    regenerationTarget,
  );
  let generationMessages = messagesBeforeRegenerationTarget(storedMessages, input.regenerateMessageId);
  const skippedStoredImageMessageIds = new Set(
    [readString(savedTimelineMessage?.id).trim()].filter((id): id is string => id.length > 0),
  );
  const storedImageDelivery = await resolveStoredImageAttachmentsForPrompt(
    deps.storage,
    generationMessages,
    skippedStoredImageMessageIds,
  );
  generationMessages = storedImageDelivery.messages;
  const storedImageConnectionSupport = applyStoredImageAttachmentConnectionSupport(generationMessages, connection);
  generationMessages = storedImageConnectionSupport.messages;
  for (const warning of [...storedImageDelivery.warnings, ...storedImageConnectionSupport.warnings]) {
    yield { type: "agent_warning", data: warning };
  }
  const latestUserInput =
    readString(internalOptions.latestUserInput).trim() ||
    userRegenerationSourceMessage?.content ||
    preparedUserInput.content ||
    inputUserMessage(input);
  if (internalOptions.groupTurnChild !== true) {
    const groupTurnIds = await resolveIndividualGroupTurnIds({
      deps,
      input,
      chat,
      connection,
      storedMessages: generationMessages,
      latestUserInput,
      mentionedNames: preparedUserInput.mentionedCharacterNames,
      signal,
    });
    throwIfAborted(signal);
    if (groupTurnIds) {
      if (groupTurnIds.length === 0) {
        yield { type: "done" };
        return;
      }
      const metadata = parseRecord(chat.metadata);
      const revalidateLaterResponders =
        readString(chat.mode || chat.chatMode).trim() === "conversation" &&
        readString(metadata.groupResponseOrder, "smart") === "smart";
      yield* runIndividualGroupTurnLoop({
        deps,
        input,
        connection,
        turnIds: groupTurnIds,
        latestUserInput,
        revalidateLaterResponders,
        signal,
      });
      return;
    }
  }
  const explicitManualTargetCharacterId = readString(input.forCharacterId).trim();
  const sequentialGroupTargetId = sequentialGroupTargetCharacterId(chat, input, storedMessages);
  if (sequentialGroupTargetId) {
    input = { ...input, forCharacterId: sequentialGroupTargetId };
  }
  const generationTrackerBaseline = await selectGenerationTrackerBaseline(
    deps.storage,
    chatId,
    input,
    preparedUserInput,
    storedMessages,
  );
  let chatForGeneration = generationTrackerBaseline ? { ...chat, gameState: generationTrackerBaseline } : chat;
  const resolvedGroupTarget = await resolveGroupTargetForGeneration({
    deps,
    input,
    chat: chatForGeneration,
    connection,
    storedMessages: generationMessages,
    latestUserInput,
    mentionedNames: preparedUserInput.mentionedCharacterNames,
    signal,
  });
  throwIfAborted(signal);
  if (resolvedGroupTarget && readString(input.forCharacterId).trim() !== resolvedGroupTarget) {
    input = { ...input, forCharacterId: resolvedGroupTarget };
  }
  const directMessages = requestMessages(input);
  if (!directMessages && input.impersonate !== true) {
    const targetCharacterId = readString(input.forCharacterId).trim() || resolvedGroupTarget;
    const availability = await resolveConversationAvailability({
      storage: deps.storage,
      chat,
      targetCharacterId,
      manualTargetCharacterId: explicitManualTargetCharacterId,
      mentionedCharacterNames: preparedUserInput.mentionedCharacterNames,
    });
    throwIfAborted(signal);
    const characterNames = availability?.characters.map((character) => character.name) ?? [];
    const regenerateMessageId = readString(input.regenerateMessageId).trim();
    if (availability?.allOffline && !regenerateMessageId) {
      mirrorSavedUserMessageToDiscord({
        deps,
        chat,
        input,
        prepared: preparedUserInput,
        persona: savedUserPersonaContext(savedUserMessage),
      });
      yield { type: "offline", data: { characters: characterNames } };
      yield { type: "done" };
      return;
    }
    if (availability && availability.delayMs > 0 && !regenerateMessageId) {
      yield {
        type: "delayed",
        data: {
          characters: characterNames,
          status: availability.delayStatus,
          delayMs: availability.delayMs,
        },
      };
      await abortableDelay(availability.delayMs, signal);
      throwIfAborted(signal);
      storedMessages = await loadMessagesForGenerationTarget({ storage: deps.storage, chatId, chat, input });
      regenerationTarget = regenerationTargetFromMessages(storedMessages, input.regenerateMessageId);
      generationMessages = messagesBeforeRegenerationTarget(storedMessages, input.regenerateMessageId);
      const delayedStoredImageDelivery = await resolveStoredImageAttachmentsForPrompt(
        deps.storage,
        generationMessages,
        skippedStoredImageMessageIds,
      );
      generationMessages = delayedStoredImageDelivery.messages;
      const delayedStoredImageConnectionSupport = applyStoredImageAttachmentConnectionSupport(
        generationMessages,
        connection,
      );
      generationMessages = delayedStoredImageConnectionSupport.messages;
      for (const warning of [...delayedStoredImageDelivery.warnings, ...delayedStoredImageConnectionSupport.warnings]) {
        yield { type: "agent_warning", data: warning };
      }
    }
    if (characterNames.length > 0) {
      yield { type: "typing", data: { characters: characterNames } };
    }
  }
  const prepareContextTiming = generationTimingEvent("prepare-context", prepareContextStartedAt, {
    messageCount: generationMessages.length,
  });
  if (prepareContextTiming) yield prepareContextTiming;
  const isUserMessageRegeneration = isUserRegenerationTarget(regenerationTarget);
  const agentEvents: AgentResult[] = [];
  const continueAssistantResponse = shouldContinueAssistantResponse(input, preparedUserInput, generationMessages);
  const agentInjectionOverrides = normalizedAgentInjectionOverrides(input);
  const turnEmbeddingSource = generationEmbeddingSource(deps.llm, connection);

  yield { type: "phase", data: "Assembling prompt..." };
  let prompt = directMessages;
  const assemblePromptStartedAt = generationTimingStartedAt();
  if (!directMessages) {
    chatForGeneration = await withRuntimeConversationCommandCapabilities(chatForGeneration, deps.integrations);
    throwIfAborted(signal);
  }
  let assembly = await assembleGenerationPrompt(deps.storage, {
    chat: chatForGeneration,
    storedMessages: generationMessages,
    connection,
    request: input,
    latestUserInput,
    userRegenerationSourceMessage,
    embeddingSource: turnEmbeddingSource,
    visuals: deps.visuals,
    persistPromptVariables: true,
  });
  throwIfAborted(signal);
  const assemblePromptTiming = generationTimingEvent("assemble-prompt", assemblePromptStartedAt, {
    messageCount: generationMessages.length,
    promptMessageCount: assembly.messages.length,
  });
  if (assemblePromptTiming) yield assemblePromptTiming;
  mirrorSavedUserMessageToDiscord({ deps, chat, input, prepared: preparedUserInput, persona: assembly.persona });

  if (!directMessages) {
    const agentsEnabled = input.impersonateBlockAgents !== true && !isUserMessageRegeneration;
    yield { type: "phase", data: agentsEnabled ? "Running pre-generation agents..." : "Calling model..." };
    const runtime = agentsEnabled
      ? await createGenerationAgentRuntime(
          { storage: deps.storage, llm: deps.llm, integrations: deps.integrations, visuals: deps.visuals },
          {
            chat: chatForGeneration,
            connection,
            storedMessages: generationMessages,
            cadenceMessages: storedMessages,
            characters: assembly.characters,
            persona: assembly.persona,
            activatedLorebookEntries: assembly.activatedLorebookEntries,
            chatSummary: assembly.chatSummary,
            embeddingSource: turnEmbeddingSource,
            debugMode: input.debugMode === true,
            debugSink: input.debugSink,
            hideAutomatedSummarySourceMessages: input.hideAutomatedSummarySourceMessages === true,
            signal,
            forCharacterId: readString(input.forCharacterId).trim() || null,
            regenerateMessageId: readString(input.regenerateMessageId).trim() || null,
            agentInjectionOverrides,
          },
          (result) => agentEvents.push(result),
        )
      : null;
    throwIfAborted(signal);
    for (const warning of runtime?.agentWarnings ?? []) {
      yield { type: "agent_warning", data: warning };
    }
    for (const result of agentEvents) {
      yield { type: "agent_result", data: result };
    }
    agentEvents.length = 0;

    const reviewableInjections = runtime ? reviewableAgentInjections(runtime.preInjections) : [];
    if (runtime && shouldPauseForAgentInjectionReview(chatForGeneration, input, reviewableInjections)) {
      yield {
        type: "agent_injection_review",
        data: {
          chatId,
          injections: reviewableInjections.map((injection) => ({
            agentType: injection.agentType,
            agentName: injection.agentName || injection.agentType,
            text: injection.text,
          })),
        },
      };
      yield { type: "done" };
      return;
    }

    if (hasPromptAgentData(runtime?.agentData)) {
      assembly = await assembleGenerationPrompt(deps.storage, {
        chat: chatForGeneration,
        storedMessages: generationMessages,
        connection,
        request: input,
        latestUserInput,
        userRegenerationSourceMessage,
        agentData: runtime.agentData,
        embeddingSource: turnEmbeddingSource,
        visuals: deps.visuals,
        persistPromptVariables: true,
        reusableContext: assembly.reusableContext,
      });
      throwIfAborted(signal);
    }
    if (!isUserMessageRegeneration) {
      await consumePendingConnectedInfluences(deps.storage, chatForGeneration);
      throwIfAborted(signal);
    }
    const generationDirectiveMessages = directiveMessages(
      input,
      chat,
      assembly.characters,
      assembly.persona,
      preparedUserInput,
      {
        continueAssistantResponse,
      },
    );
    prompt = withImageAttachments([...assembly.messages, ...generationDirectiveMessages], preparedUserInput.images);
    const promptPreviewMessages = withImageAttachments(
      [...assembly.previewMessages, ...generationDirectiveMessages],
      preparedUserInput.images,
    );

    const parallelAgents = runtime?.runParallel() ?? Promise.resolve<AgentResult[]>([]);
    yield { type: "phase", data: "Calling model..." };
    const mainTools = await buildMainToolDefinitions({
      chat: chatForGeneration,
      storage: deps.storage,
      integrations: deps.integrations,
    });
    const toolRuntimeInput: ToolRuntimeInput = {
      chat: chatForGeneration,
      storedMessages: generationMessages,
      activatedLorebookEntries: assembly.activatedLorebookEntries,
      characters: assembly.characters,
      persona: assembly.persona,
      chatSummary: assembly.chatSummary,
      hideAutomatedSummarySourceMessages: input.hideAutomatedSummarySourceMessages === true,
    };
    const baseMessages: LlmMessage[] = withUserMessageRegenerationRewritePrompt(
      [...prompt, ...generationGuideMessages(input, runtime?.preInjections)].filter(
        (message): message is LlmMessage => !!message,
      ),
      assembly.userRegenerationSourceMessage,
    );
    const mainPartial: StreamPartialSink = {
      content: "",
      thinking: "",
      usage: null,
      providerMetadata: null,
      promptSnapshot: null,
    };
    let streamedContent = "";
    let streamedThinking = "";
    let usage: unknown = null;
    let providerMetadata: unknown = null;
    let promptSnapshot: MainGenerationPromptSnapshot | null = null;
    const modelCallStartedAt = generationTimingStartedAt();
    try {
      ({
        content: streamedContent,
        thinking: streamedThinking,
        usage,
        providerMetadata,
        promptSnapshot,
      } = yield* streamMainGenerationLoop({
        deps,
        connection,
        input,
        chat: chatForGeneration,
        parameters: llmParameters(connection, input, chatForGeneration, assembly.parameters),
        baseMessages,
        previewMessages: withUserMessageRegenerationRewritePrompt(
          [...promptPreviewMessages, ...generationGuideMessages(input, runtime?.preInjections)].filter(
            (message): message is LlmMessage => !!message,
          ),
          assembly.userRegenerationSourceMessage,
        ),
        contextAttribution: generationContextAttribution(assembly.contextAttributionItems),
        promptPresetId: assembly.promptPresetId,
        mainTools,
        toolRuntimeInput,
        signal,
        partial: mainPartial,
      }));
    } catch (err) {
      // On a Stop mid-stream, persist the partial text before the abort
      // propagates so it is not discarded, and emit its message event so the
      // client upserts the saved row before clearing the streaming buffer.
      const savedPartial = await persistPartialOnAbort({
        deps,
        chat,
        characters: assembly.characters,
        input,
        connection,
        llm: deps.llm,
        partial: mainPartial,
        chatSummaryFingerprint: assembly.chatSummaryFingerprint,
        signal,
        existingExtra: await regenerationTargetExtra(deps.storage, chatId, storedMessages, input.regenerateMessageId),
        regenerationTarget,
      });
      if (savedPartial) {
        yield {
          type: savedGenerationEventType(input, regenerationTarget),
          data: savedGenerationEventData(savedPartial),
        };
      }
      throw err;
    }
    const modelCallTiming = generationTimingEvent("model-call", modelCallStartedAt, {
      promptMessageCount: baseMessages.length,
    });
    if (modelCallTiming) yield modelCallTiming;
    throwIfAborted(signal);
    let content = streamedContent;

    const preSaveAgentResults = isUserMessageRegeneration ? [] : uniqueAgentResults(runtime?.preResults ?? []);
    const preSavePersonaId = readString(chat.personaId).trim();
    const preSaveSpriteExpressions = isUserMessageRegeneration
      ? null
      : spriteExpressionsFromAgentResults(
          preSaveAgentResults,
          runtime?.availableSprites ?? [],
          requiredSpriteExpressionTargetIds(chat, input),
          {
            defaultSourceText: content,
            personaCharacterIds: preSavePersonaId ? new Set([preSavePersonaId]) : undefined,
          },
        );
    content = await applyRuntimeRegexScripts(deps.storage, "ai_output", content, {
      chatCharacterIds: activeCharacterIds(chat),
      targetCharacterId: assistantMessageCharacterId(chat, input),
    });
    throwIfAborted(signal);
    const connected = isUserMessageRegeneration
      ? connectedCommandPassthrough(content)
      : await persistConnectedCommandTags(
          deps.storage,
          chat,
          content,
          deps.integrations,
          deps.llm,
          readString(connection.id) || input.connectionId || null,
          input.imagePromptSettings,
          deps.visuals,
          {
            pendingSelfieIntent: detectConversationSelfieRequestIntent({
              latestUserInput,
              recentMessages: generationMessages,
            }),
          },
        );
    throwIfAborted(signal);
    for (const event of connected.events) yield event;
    const displayContent = finalAssistantContent(input, connected.displayContent);
    if (displayContent !== connected.displayContent) {
      yield { type: "content_replace", data: displayContent };
    }
    const saved = connected.suppressAssistantMessage
      ? null
      : await saveAssistantMessage({
          storage: deps.storage,
          chat,
          characters: assembly.characters,
          input,
          connection,
          llm: deps.llm,
          content: displayContent,
          thinking: streamedThinking,
          agentResults: preSaveAgentResults,
          noteCount: connected.createdNotes.length + connected.executedCommands.length,
          chatSummaryFingerprint: assembly.chatSummaryFingerprint,
          attachments: connected.assistantAttachments,
          usage,
          providerMetadata,
          promptSnapshot,
          spriteExpressions: preSaveSpriteExpressions,
          contextInjections: isUserMessageRegeneration ? null : (runtime?.preInjections ?? null),
          existingExtra: await regenerationTargetExtra(deps.storage, chatId, storedMessages, input.regenerateMessageId),
          regenerationTarget,
        });
    const savedAssistantGeneration = !!saved && input.impersonate !== true && !isUserMessageRegeneration;
    let latestSaved = saved;
    if (saved) {
      await persistLorebookTimingStatesSafely(
        deps.storage,
        chatId,
        assembly.lorebookTimingStates,
        assembly.lorebookEntryStateOverrides,
      );
    }
    throwIfAborted(signal);
    if (savedAssistantGeneration) {
      await mirrorSavedAssistantMessageToDiscord({
        deps,
        chat,
        characters: assembly.characters,
        input,
        saved,
        content: displayContent,
      });
    }
    if (saved)
      yield { type: savedGenerationEventType(input, regenerationTarget), data: savedGenerationEventData(saved) };
    if (savedAssistantGeneration) {
      await evictStalePromptSnapshotsSafely(deps.storage, chatId);
    }
    throwIfAborted(signal);

    if (!isUserMessageRegeneration) {
      const parallelResults = await parallelAgents;
      throwIfAborted(signal);
      const postResults = runtime && savedAssistantGeneration ? await runtime.runPost(content) : [];
      throwIfAborted(signal);
      let emittedAgentResults = uniqueAgentResults([...parallelResults, ...postResults, ...agentEvents]);
      emittedAgentResults = await generateTrackerAvatarsForResults({
        deps,
        chat: chatForGeneration,
        results: emittedAgentResults,
        baseline: generationTrackerBaseline,
        signal,
      });
      for (const result of emittedAgentResults) {
        yield { type: "agent_result", data: result };
      }
      agentEvents.length = 0;
      const allAgentResults = uniqueAgentResults([...preSaveAgentResults, ...emittedAgentResults]);
      if (saved) {
        const patchedMessages = await patchSavedMessageAgentExtra({
          storage: deps.storage,
          chat: chatForGeneration,
          storedMessages,
          saved: latestSaved,
          results: allAgentResults,
          contextInjections: runtime?.preInjections ?? null,
          availableSprites: runtime?.availableSprites ?? [],
        });
        for (const patched of patchedMessages) {
          const patchedMessageId = messageId(patched);
          if (patchedMessageId && patchedMessageId === messageId(latestSaved)) {
            latestSaved = patched;
            yield {
              type: savedGenerationEventType(input, regenerationTarget),
              data: savedGenerationEventData(patched),
            };
          } else {
            yield { type: "message", data: savedGenerationEventData(patched) };
          }
        }
      }

      const hasIllustrationRequest = emittedAgentResults.some((result) => illustratorPromptData(result) !== null);
      if (savedAssistantGeneration && hasIllustrationRequest) {
        yield { type: "phase", data: "Generating illustration..." };
        const illustration = await generateIllustrationAttachments({
          deps,
          chat,
          results: emittedAgentResults,
          signal,
        });
        throwIfAborted(signal);
        for (const event of illustration.events) yield event;
        const patched = await appendSavedMessageAttachments({
          storage: deps.storage,
          saved: latestSaved,
          attachments: illustration.attachments,
        });
        if (patched) {
          latestSaved = patched;
          yield { type: savedGenerationEventType(input, regenerationTarget), data: savedGenerationEventData(patched) };
        }
      }
      throwIfAborted(signal);
      if (savedAssistantGeneration) {
        await persistTrackerSnapshotSafely(
          deps.storage,
          chatId,
          latestSaved,
          allAgentResults,
          generationTrackerBaseline,
          readString(parseRecord(latestSaved).content),
          deps.onTrackerSnapshotSaved,
          true,
        );
      }
      throwIfAborted(signal);
      await persistSecretPlotAgentMemorySafely(deps.storage, chatId, allAgentResults);
      throwIfAborted(signal);
      await persistAgentResults(deps.storage, chatId, messageId(latestSaved), allAgentResults);
      throwIfAborted(signal);
    }
    if (savedAssistantGeneration) {
      const autoLorebookBackfill = await runLorebookKeeperBackfill(
        deps,
        {
          chatId,
          connectionId: readString(connection.id) || input.connectionId || null,
          agentTypes: [LOREBOOK_KEEPER_AGENT_TYPE],
          options: { lorebookKeeperBackfill: true },
        },
        { chat, connection, signal },
      );
      for (const event of autoLorebookBackfill.events) {
        yield event;
      }
      for (const result of autoLorebookBackfill.results) {
        yield { type: "agent_result", data: result };
      }
    }
    if (savedAssistantGeneration) {
      await enqueueAutomaticMemoryCaptureSafely(deps.storage, chat, savedUserMessage, latestSaved);
    }
    yield { type: "done", data: { transcript: visibleTranscript(generationMessages) } };
    return;
  }

  const directDirectiveMessages = directiveMessages(
    input,
    chat,
    assembly.characters,
    assembly.persona,
    preparedUserInput,
    {
      continueAssistantResponse,
    },
  );
  prompt = withImageAttachments([...(prompt ?? []), ...directDirectiveMessages], preparedUserInput.images);
  const promptPreviewMessagesDirect = withImageAttachments(
    [...assembly.previewMessages, ...directDirectiveMessages],
    preparedUserInput.images,
  );
  yield { type: "phase", data: "Calling model..." };
  const mainToolsDirect = await buildMainToolDefinitions({
    chat: chatForGeneration,
    storage: deps.storage,
    integrations: deps.integrations,
  });
  const toolRuntimeInputDirect: ToolRuntimeInput = {
    chat: chatForGeneration,
    storedMessages: generationMessages,
    activatedLorebookEntries: assembly.activatedLorebookEntries,
    characters: assembly.characters,
    persona: assembly.persona,
    chatSummary: assembly.chatSummary,
    hideAutomatedSummarySourceMessages: input.hideAutomatedSummarySourceMessages === true,
  };
  const baseMessagesDirect: LlmMessage[] = withUserMessageRegenerationRewritePrompt(
    [...(prompt ?? []), ...generationGuideMessages(input)].filter((message): message is LlmMessage => !!message),
    assembly.userRegenerationSourceMessage,
  );
  const directPartial: StreamPartialSink = {
    content: "",
    thinking: "",
    usage: null,
    providerMetadata: null,
    promptSnapshot: null,
  };
  let streamedContentDirect = "";
  let streamedThinkingDirect = "";
  let usage: unknown = null;
  let providerMetadata: unknown = null;
  let promptSnapshotDirect: MainGenerationPromptSnapshot | null = null;
  try {
    ({
      content: streamedContentDirect,
      thinking: streamedThinkingDirect,
      usage,
      providerMetadata,
      promptSnapshot: promptSnapshotDirect,
    } = yield* streamMainGenerationLoop({
      deps,
      connection,
      input,
      chat: chatForGeneration,
      parameters: llmParameters(connection, input, chatForGeneration, assembly.parameters),
      baseMessages: baseMessagesDirect,
      previewMessages: withUserMessageRegenerationRewritePrompt(
        [...(promptPreviewMessagesDirect ?? []), ...generationGuideMessages(input)].filter(
          (message): message is LlmMessage => !!message,
        ),
        assembly.userRegenerationSourceMessage,
      ),
      contextAttribution: generationContextAttribution(assembly.contextAttributionItems),
      promptPresetId: assembly.promptPresetId,
      mainTools: mainToolsDirect,
      toolRuntimeInput: toolRuntimeInputDirect,
      signal,
      partial: directPartial,
    }));
  } catch (err) {
    // On a Stop mid-stream, persist the partial text before the abort
    // propagates so it is not discarded, and emit its message event so the
    // client upserts the saved row before clearing the streaming buffer.
    const savedPartial = await persistPartialOnAbort({
      deps,
      chat,
      characters: assembly.characters,
      input,
      connection,
      llm: deps.llm,
      partial: directPartial,
      chatSummaryFingerprint: assembly.chatSummaryFingerprint,
      signal,
      existingExtra: await regenerationTargetExtra(deps.storage, chatId, storedMessages, input.regenerateMessageId),
      regenerationTarget,
    });
    if (savedPartial) {
      yield { type: savedGenerationEventType(input, regenerationTarget), data: savedGenerationEventData(savedPartial) };
    }
    throw err;
  }
  throwIfAborted(signal);
  let content = streamedContentDirect;
  content = await applyRuntimeRegexScripts(deps.storage, "ai_output", content, {
    chatCharacterIds: activeCharacterIds(chat),
    targetCharacterId: assistantMessageCharacterId(chat, input),
  });
  throwIfAborted(signal);
  const connected = isUserMessageRegeneration
    ? connectedCommandPassthrough(content)
    : await persistConnectedCommandTags(
        deps.storage,
        chat,
        content,
        deps.integrations,
        deps.llm,
        readString(connection.id) || input.connectionId || null,
        input.imagePromptSettings,
        deps.visuals,
        {
          pendingSelfieIntent: detectConversationSelfieRequestIntent({
            latestUserInput,
            recentMessages: generationMessages,
          }),
        },
      );
  throwIfAborted(signal);
  for (const event of connected.events) yield event;
  const displayContentDirect = finalAssistantContent(input, connected.displayContent);
  if (displayContentDirect !== connected.displayContent) {
    yield { type: "content_replace", data: displayContentDirect };
  }
  const saved = connected.suppressAssistantMessage
    ? null
    : await saveAssistantMessage({
        storage: deps.storage,
        chat,
        characters: assembly.characters,
        input,
        connection,
        llm: deps.llm,
        content: displayContentDirect,
        thinking: streamedThinkingDirect,
        agentResults: [],
        noteCount: connected.createdNotes.length + connected.executedCommands.length,
        chatSummaryFingerprint: assembly.chatSummaryFingerprint,
        attachments: connected.assistantAttachments,
        usage,
        providerMetadata,
        promptSnapshot: promptSnapshotDirect,
        existingExtra: await regenerationTargetExtra(deps.storage, chatId, storedMessages, input.regenerateMessageId),
        regenerationTarget,
      });
  const savedAssistantGeneration = !!saved && input.impersonate !== true && !isUserMessageRegeneration;
  if (saved) {
    await persistLorebookTimingStatesSafely(
      deps.storage,
      chatId,
      assembly.lorebookTimingStates,
      assembly.lorebookEntryStateOverrides,
    );
  }
  throwIfAborted(signal);
  if (savedAssistantGeneration) {
    await mirrorSavedAssistantMessageToDiscord({
      deps,
      chat,
      characters: assembly.characters,
      input,
      saved,
      content: displayContentDirect,
    });
  }
  if (saved) yield { type: savedGenerationEventType(input, regenerationTarget), data: savedGenerationEventData(saved) };
  if (savedAssistantGeneration) {
    await evictStalePromptSnapshotsSafely(deps.storage, chatId);
  }
  throwIfAborted(signal);
  if (savedAssistantGeneration) {
    const autoLorebookBackfill = await runLorebookKeeperBackfill(
      deps,
      {
        chatId,
        connectionId: readString(connection.id) || input.connectionId || null,
        agentTypes: [LOREBOOK_KEEPER_AGENT_TYPE],
        options: { lorebookKeeperBackfill: true },
      },
      { chat, connection, signal },
    );
    for (const event of autoLorebookBackfill.events) {
      yield event;
    }
    for (const result of autoLorebookBackfill.results) {
      yield { type: "agent_result", data: result };
    }
  }
  if (savedAssistantGeneration) {
    await enqueueAutomaticMemoryCaptureSafely(deps.storage, chat, savedUserMessage, saved);
  }
  yield { type: "done" };
}

function generationGuideMessages(
  input: StartGenerationInput,
  contextInjections: readonly AgentInjectionOverride[] | null | undefined = null,
): LlmMessage[] {
  return buildGenerationGuideMessages({
    generationGuide: input.generationGuide,
    generationGuideSource: input.generationGuideSource,
    contextInjections,
  });
}

function runtimeLlmParameters(
  connection: JsonRecord,
  input: StartGenerationInput,
  chat: JsonRecord,
  parameters: Record<string, unknown>,
): Record<string, unknown> {
  const generationParameters = rerollSeedParameters(input, parameters);
  if (readString(connection.provider).trim() !== "claude_subscription") return generationParameters;
  return {
    ...generationParameters,
    _marinara: {
      chatId: readString(chat.id).trim() || readString(input.chatId).trim(),
      mode: readString(chat.mode || chat.chatMode).trim(),
      regenerateMessageId: readString(input.regenerateMessageId).trim() || null,
      impersonate: input.impersonate === true,
    },
  };
}

function isIntegerSeed(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && Number.isFinite(value);
}

function nextRandomLlmSeed(): number {
  return Math.floor(Math.random() * MAX_RANDOM_LLM_SEED_EXCLUSIVE);
}

function rerollSeedParameters(
  input: StartGenerationInput,
  parameters: Record<string, unknown>,
): Record<string, unknown> {
  if (!readString(input.regenerateMessageId).trim()) return parameters;

  let nextParameters = parameters;
  let nextSeed: number | null = null;
  const freshSeed = () => {
    nextSeed ??= nextRandomLlmSeed();
    return nextSeed;
  };

  if (isIntegerSeed(parameters.seed)) {
    nextParameters = {
      ...nextParameters,
      seed: freshSeed(),
    };
  }

  const custom = parseRecord(parameters.customParameters);
  if (isIntegerSeed(custom.seed)) {
    nextParameters = {
      ...nextParameters,
      customParameters: {
        ...custom,
        seed: freshSeed(),
      },
    };
  }

  const customParams = parseRecord(parameters.custom_params);
  if (isIntegerSeed(customParams.seed)) {
    nextParameters = {
      ...nextParameters,
      custom_params: {
        ...customParams,
        seed: freshSeed(),
      },
    };
  }

  return nextParameters;
}

/**
 * Cap on the number of stream → tool-execute → re-stream iterations the main
 * generation loop will perform before forcing a final turn. Picked defensively
 * to cover realistic multi-step flows (e.g. Spotify-style 4-hop sequences,
 * combat-style dice + state-update interleaves) while preventing runaway loops
 * from broken models that always emit a tool call.
 */
const MAX_MAIN_TOOL_ITERATIONS = 8;

function llmChunkText(chunk: { text?: unknown; data?: unknown; error?: unknown; message?: unknown }): string {
  if (typeof chunk.text === "string") return chunk.text;
  if (typeof chunk.data === "string") return chunk.data;
  const data = isRecord(chunk.data) ? chunk.data : {};
  return readString(chunk.message) || readString(chunk.error) || readString(data.message) || readString(data.error);
}

function llmStreamErrorMessage(chunk: { text?: unknown; data?: unknown }): string {
  return llmChunkText(chunk).trim() || "LLM stream failed";
}

/**
 * Multi-turn main-character streaming loop.
 *
 * Streams from the LLM, collects any `tool_call` chunks, executes them via
 * `executeMainToolCall`, appends the assistant turn + tool results to the
 * conversation, and re-streams until the model produces a turn with no tool
 * calls (or the iteration cap is hit).
 *
 * Mode-blind by construction: this helper reads no chat-mode flag. The only
 * gate on the tool loop is `mainTools !== null`, which the caller derives from
 * `chat.metadata.enableTools` via `buildMainToolDefinitions`.
 *
 * Tool-result messages are conversation-internal — they are NOT persisted as
 * chat messages. Only the final accumulated text reaches `saveAssistantMessage`.
 */
async function* streamMainGenerationLoop(args: {
  deps: GenerationEngineDeps;
  connection: JsonRecord;
  input: StartGenerationInput;
  chat: JsonRecord;
  parameters: Record<string, unknown>;
  baseMessages: LlmMessage[];
  previewMessages?: LlmMessage[] | null;
  promptPresetId?: string | null;
  lorebookActivationTrace?: MainGenerationPromptSnapshot["lorebookActivationTrace"];
  contextAttribution?: GenerationContextAttribution | null;
  mainTools: MainToolDefinitions | null;
  toolRuntimeInput: ToolRuntimeInput;
  signal: AbortSignal | undefined;
  partial?: StreamPartialSink | null;
}): AsyncGenerator<
  GenerationEvent,
  {
    content: string;
    thinking: string;
    usage: unknown;
    providerMetadata: unknown;
    promptSnapshot: MainGenerationPromptSnapshot | null;
  }
> {
  const {
    deps,
    connection,
    input,
    chat,
    parameters,
    baseMessages,
    previewMessages,
    promptPresetId,
    lorebookActivationTrace,
    contextAttribution,
    mainTools,
    toolRuntimeInput,
    signal,
    partial,
  } = args;
  let content = "";
  let thinking = "";
  let providerMetadata: unknown = null;
  const turnUsages: unknown[] = [];
  const conversation: LlmMessage[] = [...baseMessages];
  let promptSnapshot: MainGenerationPromptSnapshot | null = null;
  let iteration = 0;
  // Text streamed in the current turn but not yet committed to `content`.
  // Lets the abort `finally` recover an in-flight turn (the `content +=
  // turnContent` commit only runs once the turn's stream completes).
  let inFlightTurn = "";

  try {
    while (true) {
      throwIfAborted(signal);
      iteration++;
      const pendingToolCalls: LLMToolCall[] = [];
      const streamUsages: unknown[] = [];
      let turnProviderMetadata: unknown = null;
      let turnContent = "";
      inFlightTurn = "";
      const thinkingParser = createInlineThinkingStreamParser({ customThinkingTags: parameters.customThinkingTags });
      const emitInlineParts = function* (text: string): Generator<GenerationEvent> {
        for (const part of thinkingParser.push(text)) {
          if (!part.text) continue;
          if (part.type === "thinking") {
            thinking += part.text;
            yield { type: "thinking", data: part.text };
          } else {
            turnContent += part.text;
            inFlightTurn = turnContent;
            yield { type: "token", data: part.text };
          }
        }
      };

      const requestTools = mainTools?.toolDefs;
      const requestFit = fitLlmRequestToContextWindow(
        conversation,
        runtimeLlmParameters(connection, input, chat, parameters),
        connection,
        { tools: requestTools },
      );
      const requestMessages = requestFit.messages;
      const requestParameters = requestFit.parameters;
      const requestPreviewMessages = previewMessages?.length
        ? fitLlmRequestToContextWindow(previewMessages, requestParameters, connection, { tools: requestTools }).messages
        : null;
      const visibleRequestParameters = providerVisibleLlmParameters(connection, requestParameters, {
        stream: true,
        hasTools: Boolean(requestTools?.length),
      });
      promptSnapshot = {
        messages: requestMessages.map(clonePromptMessage),
        ...(requestPreviewMessages?.length ? { previewMessages: requestPreviewMessages.map(clonePromptMessage) } : {}),
        parameters: cloneSerializableValue(visibleRequestParameters),
        promptPresetId: promptPresetId ?? null,
        ...(lorebookActivationTrace ? { lorebookActivationTrace } : {}),
        ...(contextAttribution ? { contextAttribution } : {}),
        ...(requestTools?.length ? { tools: cloneSerializableValue(requestTools) } : {}),
      };

      for await (const chunk of deps.llm.stream(
        {
          connectionId: readString(connection.id) || input.connectionId,
          model: readString(connection.model) || undefined,
          messages: requestMessages,
          parameters: requestParameters,
          tools: requestTools,
        },
        signal,
      )) {
        throwIfAborted(signal);
        const chunkProviderMetadata =
          chunk.type === "provider_metadata" ? (chunk.data ?? chunk.providerMetadata) : chunk.providerMetadata;
        if (chunkProviderMetadata != null) {
          turnProviderMetadata = mergeProviderMetadata(turnProviderMetadata, chunkProviderMetadata);
          providerMetadata = mergeProviderMetadata(providerMetadata, chunkProviderMetadata);
        }
        if (chunk.type === "token") {
          const text = llmChunkText(chunk);
          if (text) yield* emitInlineParts(text);
        } else if (chunk.type === "thinking") {
          const text = llmChunkText(chunk);
          if (text) {
            thinking += text;
            yield { type: "thinking", data: text };
          }
        } else if (chunk.type === "tool_call") {
          const normalized = normalizeToolCall(chunk.data);
          if (normalized) pendingToolCalls.push(normalized);
        } else if (chunk.type === "usage" && chunk.data != null) {
          streamUsages.push(chunk.data);
        } else if (chunk.type === "provider_metadata") {
          continue;
        } else if (chunk.type === "error") {
          throw new Error(llmStreamErrorMessage(chunk));
        }
      }
      const streamUsage = mergeStreamUsageChunks(streamUsages);
      if (streamUsage != null) turnUsages.push(streamUsage);
      for (const part of thinkingParser.flush()) {
        if (!part.text) continue;
        if (part.type === "thinking") {
          thinking += part.text;
          yield { type: "thinking", data: part.text };
        } else {
          turnContent += part.text;
          inFlightTurn = turnContent;
          yield { type: "token", data: part.text };
        }
      }

      throwIfAborted(signal);
      content += turnContent;
      inFlightTurn = "";

      if (!mainTools || pendingToolCalls.length === 0) break;
      if (iteration >= MAX_MAIN_TOOL_ITERATIONS) {
        yield {
          type: "phase",
          data: `Tool-call iteration limit (${MAX_MAIN_TOOL_ITERATIONS}) reached; finishing without further tool calls.`,
        };
        break;
      }

      const turnMetadataRecord = providerMetadataRecord(turnProviderMetadata);
      conversation.push({
        role: "assistant",
        content: turnContent,
        tool_calls: pendingToolCalls,
        ...(turnMetadataRecord ? { providerMetadata: turnMetadataRecord } : {}),
      });

      for (const call of pendingToolCalls) {
        throwIfAborted(signal);
        const toolName = call.function?.name || call.name;
        const toolArgs = call.function?.arguments || call.arguments || "{}";
        yield { type: "tool_call", data: { id: call.id, name: toolName, arguments: toolArgs } };
        let resultText: string;
        let success = true;
        try {
          resultText = await executeMainToolCall({
            deps: { storage: deps.storage, integrations: deps.integrations },
            input: toolRuntimeInput,
            customTools: mainTools.customTools,
            allowedToolNames: mainTools.allowedToolNames,
            call,
          });
        } catch (err) {
          success = false;
          resultText = err instanceof Error ? err.message : String(err);
        }
        throwIfAborted(signal);
        yield {
          type: "tool_result",
          data: { toolCallId: call.id, name: toolName, result: resultText, success },
        };
        conversation.push({
          role: "tool",
          content: resultText,
          tool_call_id: call.id,
          name: toolName,
        });
      }
    }
  } finally {
    // Expose the accumulated turn to the caller even when the stream is
    // aborted mid-flight, so a Stop can persist the partial assistant text
    // instead of discarding it. Runs on the normal return path too, but the
    // caller only reads `partial` when `signal.aborted` is true.
    if (partial) {
      partial.content = content + inFlightTurn;
      partial.thinking = thinking;
      partial.usage = mergeTurnUsages(turnUsages);
      partial.providerMetadata = providerMetadata;
      partial.promptSnapshot = promptSnapshot;
    }
  }

  return { content, thinking, usage: mergeTurnUsages(turnUsages), providerMetadata, promptSnapshot };
}

/**
 * Merge usage chunks from a single provider stream.
 *
 * Some providers emit cumulative or repeated usage events during one request.
 * Those chunks must not be summed or prompt tokens can be counted multiple
 * times. Latest numeric value wins per key, while sparse chunks still combine
 * distinct fields such as input and output token counts.
 */
function mergeStreamUsageChunks(usages: unknown[]): unknown {
  if (usages.length === 0) return null;
  if (usages.length === 1) return usages[0];
  const records = usages.filter(isRecord);
  if (records.length === 0) return usages[usages.length - 1] ?? null;
  const merged: Record<string, unknown> = {};
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        merged[key] = value;
      } else if (!(key in merged) || value != null) {
        merged[key] = value;
      }
    }
  }
  return merged;
}

/**
 * Aggregate per-request usage records across a multi-turn tool-call loop.
 *
 * Each LLM turn (every iteration of `streamMainGenerationLoop`) emits its own
 * merged usage record. When the loop runs once with no tool calls, behavior is
 * byte-identical to the provider's final usage object.
 * When the loop iterates 2+ times, numeric leaf fields (prompt/completion/total
 * tokens, cached/reasoning/cost breakdowns) are summed so downstream
 * `generationInfo.usage` reflects total cost, not just the final turn's slice.
 *
 * Falls back to the latest non-null entry when usages have heterogeneous shapes
 * (different providers, different keys) so we never silently report wrong-typed
 * data.
 */
function mergeTurnUsages(usages: unknown[]): unknown {
  if (usages.length === 0) return null;
  if (usages.length === 1) return usages[0];
  const records = usages.filter(isRecord);
  if (records.length === 0) return usages[usages.length - 1] ?? null;
  const merged: Record<string, unknown> = {};
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        const prev = merged[key];
        merged[key] = typeof prev === "number" && Number.isFinite(prev) ? prev + value : value;
      } else if (!(key in merged)) {
        merged[key] = value;
      }
    }
  }
  return merged;
}
