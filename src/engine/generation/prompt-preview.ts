import type { LorebookActivationTrace } from "../contracts/types/lorebook";
import type { ChatMLMessage, GenerationParameters } from "../contracts/types/prompt";
import type { ChatMessageListOptions, StorageGateway } from "../capabilities/storage";
import type { VisualAssetGateway } from "../capabilities/visual-assets";
import { llmParameters, loadChatMessages, requireRecord, resolveGenerationConnection } from "./context";
import { assembleGenerationPrompt } from "./prompt-assembly";
import { buildPromptBudgetEstimate, type PromptBudgetEstimate } from "./prompt-budget";
import { buildGenerationPromptPresetCandidates } from "./prompt-preset-selection";
import { generationInfoFromVisibleParameters, providerVisibleLlmParameters } from "./provider-visible-parameters";
import { boolish, isRecord, parseRecord, readNumber, readString, type JsonRecord } from "./runtime-records";
import {
  getAttachmentFilename,
  isImageAttachment,
  type PromptAttachment,
} from "../shared/attachments/image-attachments";

type PromptPreviewChoices = Record<string, string | string[]>;
type PromptPreviewSource = "cached" | "live_preview" | "raw_messages";

export interface PromptPreviewInput {
  chatId: string;
  connectionId?: string | null;
  presetId?: string | null;
  choices?: PromptPreviewChoices | null;
  forCharacterId?: string | null;
  parameters?: Record<string, unknown> | null;
  beforeMessageId?: string | null;
  message?: string | null;
  userMessage?: string | null;
  attachments?: PromptAttachment[] | null;
}

export interface PromptPreviewResult {
  messages: ChatMLMessage[];
  previewMessages: ChatMLMessage[];
  parameters: Partial<GenerationParameters> | Record<string, unknown>;
  promptPresetId: string | null;
  lorebookActivationTrace: LorebookActivationTrace;
  messageCount: number;
  source: PromptPreviewSource;
  exact: boolean;
  generationInfo: {
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
  budget?: PromptBudgetEstimate;
}

function promptPreviewMessageLoadOptions(chat: Record<string, unknown>): ChatMessageListOptions {
  const chatLimit = readNumber(parseRecord(chat.metadata).contextMessageLimit, 0);
  const historyLimit = Math.max(1, Math.min(9999, chatLimit || 300));
  return { limit: Math.max(40, Math.min(340, historyLimit + 20)) };
}

async function previewDefaultPromptId(storage: StorageGateway): Promise<string | null> {
  const prompts = await storage.list<JsonRecord>("prompts").catch(() => []);
  return (
    prompts
      .find((prompt) => boolish(prompt.isDefault ?? prompt.default, false))
      ?.id?.toString()
      .trim() || null
  );
}

async function promptPresetExists(storage: StorageGateway, presetId: string): Promise<boolean> {
  const full = await storage.promptFull?.<unknown>(presetId).catch(() => null);
  if (isRecord(full) && isRecord(full.preset)) return true;
  const direct = await storage.get("prompts", presetId).catch(() => null);
  if (isRecord(direct)) return true;
  const prompts = await storage.list<JsonRecord>("prompts").catch(() => []);
  return prompts.some((prompt) => readString(prompt.id).trim() === presetId);
}

function previewDraftText(input: PromptPreviewInput): string {
  return readString(input.userMessage ?? input.message).trim();
}

function previewDraftMessages(input: PromptPreviewInput): ChatMLMessage[] {
  const draft = previewDraftText(input);
  return draft
    ? [
        {
          role: "user",
          content: draft,
          contextKind: "history",
          displayName: "Current Draft",
        },
      ]
    : [];
}

function previewAttachmentMessages(input: PromptPreviewInput): ChatMLMessage[] {
  const attachments = input.attachments?.filter(isRecord) as PromptAttachment[] | undefined;
  if (!attachments?.length) return [];
  const names = attachments.map(getAttachmentFilename).filter(Boolean);
  const imageCount = attachments.filter(isImageAttachment).length;
  const content = names.length
    ? ["Attachments likely to be sent:", ...names.map((name) => "- " + name)].join("\n")
    : String(attachments.length) + " attachment" + (attachments.length === 1 ? "" : "s");
  return [
    {
      role: "user",
      content,
      contextKind: "injection",
      displayName: "Attachments",
      ...(imageCount > 0
        ? { images: Array.from({ length: imageCount }, (_, index) => "attachment-" + (index + 1)) }
        : {}),
    },
  ];
}

function previewBudgetMessages(assemblyMessages: ChatMLMessage[], input: PromptPreviewInput): ChatMLMessage[] {
  return [...assemblyMessages, ...previewDraftMessages(input), ...previewAttachmentMessages(input)];
}

async function previewChoicesPromptPresetId(
  storage: StorageGateway,
  chat: JsonRecord,
  connection: JsonRecord,
  request: { promptPresetId?: string | null },
): Promise<string | null> {
  const mode = readString(chat.mode || chat.chatMode, "conversation");
  const defaultPromptId = await previewDefaultPromptId(storage);
  const candidates = buildGenerationPromptPresetCandidates({
    chatMode: mode,
    chatPromptPresetId: chat.promptPresetId,
    connectionPromptPresetId: connection.promptPresetId,
    requestPromptPresetId: request.promptPresetId,
  }).map((candidate) => ({ id: candidate.id }));
  if (mode !== "conversation" && defaultPromptId && !candidates.some((candidate) => candidate.id === defaultPromptId)) {
    candidates.push({ id: defaultPromptId });
  }

  for (const candidate of candidates) {
    if (await promptPresetExists(storage, candidate.id)) return candidate.id;
  }
  return null;
}

export async function previewGenerationPrompt(
  storage: StorageGateway,
  input: PromptPreviewInput,
  visuals?: VisualAssetGateway,
): Promise<PromptPreviewResult> {
  const chat = requireRecord(await storage.get("chats", input.chatId), "Chat");
  const connection = await resolveGenerationConnection(storage, chat, input);
  const storedMessages = await loadChatMessages(storage, input.chatId, promptPreviewMessageLoadOptions(chat));
  const beforeMessageId = readString(input.beforeMessageId).trim();
  const messageIndex = beforeMessageId
    ? storedMessages.findIndex((message) => readString(message.id).trim() === beforeMessageId)
    : -1;
  const previewMessages = messageIndex >= 0 ? storedMessages.slice(0, messageIndex) : storedMessages;
  const request = {
    promptPresetId: input.presetId ?? (readString(chat.promptPresetId) || null),
    forCharacterId: input.forCharacterId ?? null,
    parameters: input.parameters ?? null,
  };
  const chatMetadata = parseRecord(chat.metadata);
  const choicesPromptPresetId = input.choices
    ? await previewChoicesPromptPresetId(storage, chat, connection, request)
    : null;
  const previewChat = {
    ...chat,
    ...(input.choices
      ? {
          promptPresetId: choicesPromptPresetId,
          metadata: {
            ...chatMetadata,
            presetChoices: input.choices,
          },
        }
      : {}),
  };
  const assembly = await assembleGenerationPrompt(storage, {
    chat: previewChat,
    storedMessages: previewMessages,
    connection,
    request,
    latestUserInput: previewDraftText(input),
    visuals,
  });
  const parameters = llmParameters(connection, request, previewChat, assembly.parameters);
  const visibleParameters = providerVisibleLlmParameters(connection, parameters, { stream: true });
  const generationInfo = generationInfoFromVisibleParameters(connection, visibleParameters);
  const budgetMessages = previewBudgetMessages(assembly.messages, input);
  const previewBudgetDisplayMessages = previewBudgetMessages(assembly.previewMessages, input);
  const budget = buildPromptBudgetEstimate({
    messages: budgetMessages,
    connection,
    parameters,
    budgetSkippedLorebookEntries: assembly.budgetSkippedLorebookEntries,
  });
  return {
    messages: budgetMessages,
    previewMessages: previewBudgetDisplayMessages,
    parameters: visibleParameters,
    promptPresetId: assembly.promptPresetId,
    lorebookActivationTrace: assembly.lorebookActivationTrace,
    messageCount: assembly.messages.length,
    source: "live_preview",
    exact: false,
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
      tokensPrompt: null,
      tokensCompletion: null,
      tokensCachedPrompt: null,
      tokensCacheWritePrompt: null,
      durationMs: null,
      finishReason: null,
    },
    agentNote: "No saved model request was available, so this is a live best-effort preview assembled without sending.",
    budget,
  };
}
