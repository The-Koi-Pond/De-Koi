import type { LlmGateway, LlmRequest } from "../../../capabilities/llm";
import type { ChatMessageListOptions, StorageGateway } from "../../../capabilities/storage";
import type { VisualAssetGateway } from "../../../capabilities/visual-assets";
import { parseJsonArray, parseJsonObject } from "../../../core/json";
import { boolish } from "../../../generation/runtime-records";
import { parseGameJsonish } from "../../../shared/parsing-jsonish";
import { readString as stringValue } from "../../../shared/value-readers";
import type {
  SceneCreateRequest,
  SceneCreateResponse,
  SceneForkRequest,
  SceneForkResponse,
  SceneFullPlan,
  ScenePlanRequest,
  ScenePlanResponse,
} from "../../../contracts/types/scene";
import {
  copyTrackerSnapshotsForRebasedMessages,
  type TrackerSnapshotMessageRebase,
} from "../../../generation/tracker-snapshots";
import { resolveSceneUniversalPreset } from "./universal-preset";

type JsonRecord = Record<string, unknown>;

type RoleplaySceneCapabilities = {
  storage: StorageGateway;
  llm: LlmGateway;
  visuals?: VisualAssetGateway;
};

type StoredMessage = JsonRecord & {
  id?: string;
  role?: string;
  content?: string;
  characterId?: string | null;
};

type SceneParticipantContext = {
  id: string;
  name: string;
  description: string;
  personality: string;
  scenario: string;
  appearance: string;
  backstory: string;
  firstMessage: string;
  exampleDialogue: string;
  systemPrompt: string;
  postHistoryInstructions: string;
  tags: string[];
};

type ScenePlannerContext = {
  characters: SceneParticipantContext[];
  persona: SceneParticipantContext | null;
};

const SCENE_GUIDELINES = [
  "Scene guidelines:",
  "- Treat this as a focused roleplay scene branched from the originating conversation.",
  "- Preserve character knowledge boundaries and relationship continuity from the origin chat.",
  "- The user controls their persona. Never decide their strategic choices or exact dialogue.",
  "- Keep narration in third person unless the origin chat or requested scene explicitly uses another POV.",
  "- Spoken dialogue must be wrapped in quotation marks. Do not leave spoken lines as bare prose.",
  "- First messages should establish the scene and then hand the next meaningful choice back to the user.",
  "- Continue naturally until the scene concludes or returns to the origin conversation.",
].join("\n");

const SCENE_PLAN_HISTORY_LIMIT = 20;
const SCENE_FALLBACK_HISTORY_LIMIT = 8;
const SCENE_CONVERSATION_CONTEXT_LIMIT = 24;

const SCENE_SUMMARY_CHUNK_MAX_CHARS = 12000;
const SCENE_SUMMARY_CHUNK_MAX_TOKENS = 700;
const SCENE_SUMMARY_CHUNK_RETRY_MAX_TOKENS = 2048;
const SCENE_SUMMARY_FINAL_MAX_TOKENS = 1400;
const SCENE_SUMMARY_FINAL_RETRY_MAX_TOKENS = 2800;
const SCENE_SUMMARY_CHUNK_MAX_SUMMARY_CHARS = 2400;
const SCENE_SUMMARY_FINAL_MAX_SUMMARY_CHARS = 8000;
const SCENE_SUMMARY_FINAL_MIN_SENTENCES = 3;
const SCENE_SUMMARY_SUBSTANTIAL_TRANSCRIPT_MIN_LINES = 8;
const SCENE_SUMMARY_SUBSTANTIAL_TRANSCRIPT_MIN_CHARS = 1800;

export async function planRoleplayScene(
  capabilities: RoleplaySceneCapabilities,
  input: ScenePlanRequest,
): Promise<ScenePlanResponse> {
  const chat = await requireChat(capabilities.storage, input.chatId);
  const prompt = input.prompt.trim();
  const fallback = await fallbackScenePlan(capabilities.storage, input.chatId, prompt);
  const allowedCharacterIds = stringArray(chat.characterIds);
  const plannerContext = await buildScenePlannerContext(capabilities.storage, chat);

  let connectionId: string;
  try {
    connectionId = await resolveConnectionId(capabilities.storage, chat, input.connectionId ?? null);
  } catch (error) {
    return {
      plan: fallback,
      error: `Used local scene planning because no LLM connection was available: ${errorMessage(error)}`,
    };
  }

  const history = (
    await messagesForChat(capabilities.storage, input.chatId, {
      limit: SCENE_PLAN_HISTORY_LIMIT,
      fields: ["role", "content"],
    })
  )
    .slice(-20)
    .map((message) => {
      const role = stringValue(message.role) || "user";
      const content = stringValue(message.content).trim();
      return content ? `${role}: ${content}` : "";
    })
    .filter(Boolean)
    .join("\n\n");

  const requestText = prompt
    ? `Plan a complete roleplay scene based on this request: ${prompt}`
    : "Plan a complete roleplay scene that naturally follows the recent conversation.";

  try {
    const raw = await capabilities.llm.complete({
      connectionId,
      messages: [
        {
          role: "system",
          content: [
            "You are a scene planner for De-Koi roleplay.",
            "Return only one JSON object with fields name, description, scenario, firstMessage, background, characterIds, systemPrompt, rating, relationshipHistory, participationGuide, and presetChoices.",
            "The name must start with Scene:. The rating must be sfw or nsfw. Use only character IDs from the provided list.",
            "The background must always be null. Backgrounds are selected manually or generated by the opt-in Background agent after scene creation.",
            "presetChoices may include Universal preset option IDs for contentBoundary, eroticTone, narration, pov, tense, pacing, styleFlavor, agencyStrictness, length, language, and mode.",
            "Use option IDs such as boundary_sfw, boundary_mature_dark, boundary_explicit_adult_safe, erotic_tone_none, erotic_tone_restrained, erotic_tone_sensual, erotic_tone_direct, erotic_tone_filthy, narration_second, narration_third, narration_first, pov_user_limited, pov_character_limited, pov_omniscient, tense_present, tense_past, pacing_balanced, pacing_snappy, pacing_cinematic, pacing_slow_burn, style_grounded, style_lyrical, style_dry_wit, style_genre_faithful, agency_strict, agency_organic, agency_transitional, length_flexible, length_short, length_moderate, length_long, language_english, mode_gm, mode_roleplayer, or mode_writer.",
            "Write firstMessage in the origin chat's narration style. If characters speak, use quotation marks.",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            `Available character IDs: ${allowedCharacterIds.join(", ")}`,
            "",
            "Selected character cards:",
            formatParticipantList(plannerContext.characters),
            "",
            "Active persona:",
            plannerContext.persona ? formatParticipant(plannerContext.persona) : "(none)",
            "",
            "Recent conversation:",
            history || "(none)",
            "",
            requestText,
          ].join("\n"),
        },
      ],
      parameters: { temperature: 0.9, maxTokens: 4096 },
    });
    const parsed = parseObject(raw);
    if (Object.keys(parsed).length === 0) {
      return {
        plan: fallback,
        error: "The model did not return valid scene-plan JSON, so De-Koi used a local fallback plan.",
      };
    }
    return { plan: sanitizeScenePlan(parsed, fallback, allowedCharacterIds) };
  } catch (error) {
    return {
      plan: fallback,
      error: `Scene planning used a local fallback after the LLM request failed: ${errorMessage(error)}`,
    };
  }
}

export async function createRoleplayScene(
  storage: StorageGateway,
  input: SceneCreateRequest,
  _visuals?: VisualAssetGateway,
): Promise<SceneCreateResponse> {
  const originChat = await requireChat(storage, input.originChatId);
  const originMeta = parseJsonObject(originChat.metadata);
  const plan = input.plan;
  const background = null;
  const originCharacterIds = stringArray(originChat.characterIds);
  const characterIds = plan.characterIds.length ? plan.characterIds : originCharacterIds;
  const sceneName = safeTitle(plan.name, "New Scene");
  const description = plan.description || "A new scene begins.";
  const firstMessage = plan.firstMessage || "The scene begins.";
  const connectionId = input.connectionId || stringValue(originChat.connectionId) || null;
  const sceneConversationContext = await buildSceneConversationContext(storage, input.originChatId);
  const inheritedActiveLorebookIds = [
    ...stringArray(originMeta.activeLorebookIds),
    ...stringArray(originChat.activeLorebookIds),
  ].filter((id, index, ids) => ids.indexOf(id) === index);
  const inheritedSceneOptions = sceneCarryoverOptions(originMeta);
  const sceneSystemPrompt = [plan.systemPrompt, SCENE_GUIDELINES].filter((part) => part.trim()).join("\n\n");
  const universalPreset = await resolveSceneUniversalPreset(storage, { plan, sceneConversationContext });
  const sceneFolderId = sceneFolderIdForOriginMode(originChat.mode, originChat.folderId);

  const metadata: JsonRecord = {
    sceneOriginChatId: input.originChatId,
    sceneInitiatorCharId: input.initiatorCharId ?? null,
    sceneDescription: description,
    sceneScenario: plan.scenario ?? null,
    sceneBackground: background,
    sceneSystemPrompt: sceneSystemPrompt || null,
    sceneRelationshipHistory: plan.relationshipHistory ?? null,
    sceneConversationContext,
    activeLorebookIds: inheritedActiveLorebookIds,
    ...inheritedSceneOptions,
    sceneRating: plan.rating === "nsfw" ? "nsfw" : "sfw",
    sceneStatus: "active",
    enableMemoryRecall: true,
    ...(universalPreset.presetId
      ? {
          sceneUniversalPresetId: universalPreset.presetId,
          sceneUniversalPresetChoiceHints: universalPreset.choiceHints,
          presetChoices: universalPreset.presetChoices,
        }
      : {}),
    ...(background ? { background } : {}),
  };

  const sceneChat = await storage.create<JsonRecord>("chats", {
    name: sceneName,
    mode: "roleplay",
    characterIds,
    groupId: originChat.groupId ?? null,
    folderId: sceneFolderId,
    personaId: originChat.personaId ?? null,
    promptPresetId: universalPreset.presetId ?? originChat.promptPresetId ?? null,
    connectionId,
    connectedChatId: input.originChatId,
    activeLorebookIds: inheritedActiveLorebookIds,
    metadata,
  });
  const sceneChatId = stringValue(sceneChat.id);
  if (!sceneChatId) throw new Error("Created scene chat has no id");

  await patchChatMetadata(storage, input.originChatId, {
    activeSceneChatId: sceneChatId,
    sceneBusyCharIds: characterIds,
  });
  await storage.update("chats", input.originChatId, { connectedChatId: sceneChatId });

  if (plan.participationGuide.trim()) {
    await createChatMessage(storage, sceneChatId, {
      role: "narrator",
      content: plan.participationGuide,
      characterId: null,
    });
  }
  const firstCharacterId = input.initiatorCharId || characterIds[0] || null;
  await createChatMessage(storage, sceneChatId, {
    role: "assistant",
    content: [description, "", firstMessage].join("\n"),
    characterId: firstCharacterId,
  });

  return {
    chatId: sceneChatId,
    chatName: stringValue(sceneChat.name) || sceneName,
    description,
    background,
  };
}

export async function concludeRoleplayScene(
  capabilities: RoleplaySceneCapabilities,
  input: { sceneChatId: string; connectionId?: string | null },
): Promise<{ summary: string; originChatId: string }> {
  const sceneChat = await requireChat(capabilities.storage, input.sceneChatId);
  const sceneMeta = parseJsonObject(sceneChat.metadata);
  const originChatId = stringValue(sceneMeta.sceneOriginChatId);
  if (!originChatId) throw new Error("Not a scene chat");
  const summary = await summarizeScene(capabilities, input.sceneChatId, input.connectionId ?? null);

  await createChatMessage(capabilities.storage, originChatId, {
    role: "assistant",
    characterId: null,
    content: formatSceneReturnMessage(sceneChat, summary),
  });
  await appendSceneMemory(capabilities.storage, originChatId, input.sceneChatId, summary);
  await writeCharacterSceneMemories(capabilities.storage, sceneChat, summary);
  await patchChatMetadata(capabilities.storage, input.sceneChatId, { sceneStatus: "concluded" });
  await cleanOriginScenePointers(capabilities.storage, originChatId);
  await capabilities.storage.update("chats", input.sceneChatId, { connectedChatId: null });
  return { summary, originChatId };
}

export async function reopenRoleplayScene(
  storage: StorageGateway,
  input: { sceneChatId: string },
): Promise<{ originChatId: string }> {
  const sceneChat = await requireChat(storage, input.sceneChatId);
  const sceneMeta = parseJsonObject(sceneChat.metadata);
  const originChatId = stringValue(sceneMeta.sceneOriginChatId);
  if (!originChatId) throw new Error("Not a scene chat");

  const originChat = await requireChat(storage, originChatId);
  const originMeta = parseJsonObject(originChat.metadata);
  const activeSceneChatId = stringValue(originMeta.activeSceneChatId);
  if (activeSceneChatId && activeSceneChatId !== input.sceneChatId) {
    throw new Error("The origin conversation already has another active scene");
  }

  await patchChatMetadata(storage, input.sceneChatId, { sceneStatus: "active" });
  await patchChatMetadata(storage, originChatId, {
    activeSceneChatId: input.sceneChatId,
    sceneBusyCharIds: stringArray(sceneChat.characterIds),
  });
  await storage.update("chats", input.sceneChatId, { connectedChatId: originChatId });
  await storage.update("chats", originChatId, { connectedChatId: input.sceneChatId });
  return { originChatId };
}

export async function abandonRoleplayScene(
  storage: StorageGateway,
  input: { sceneChatId: string },
): Promise<{ originChatId: string }> {
  const sceneChat = await requireChat(storage, input.sceneChatId);
  const sceneMeta = parseJsonObject(sceneChat.metadata);
  const originChatId = stringValue(sceneMeta.sceneOriginChatId);
  if (!originChatId) throw new Error("Not a scene chat");
  await rememberLastSceneOptions(storage, originChatId, sceneChat);
  await cleanOriginScenePointers(storage, originChatId);
  await deleteChatWithMessages(storage, input.sceneChatId);
  return { originChatId };
}

export async function forkRoleplayScene(storage: StorageGateway, input: SceneForkRequest): Promise<SceneForkResponse> {
  if (input.mode !== "clone" && input.mode !== "convert") {
    throw new Error("mode must be clone or convert");
  }
  if (input.mode === "convert" && input.upToMessageId) {
    throw new Error("Convert cannot be limited to a message");
  }
  const sceneChat = await requireChat(storage, input.sceneChatId);
  const sceneMeta = parseJsonObject(sceneChat.metadata);
  const originChatId = stringValue(sceneMeta.sceneOriginChatId) || null;
  const baseName = stringValue(sceneChat.name) || "Scene";
  const sourceMessages = chronologicalMessages(await messagesForChat(storage, input.sceneChatId));
  if (input.upToMessageId && !sourceMessages.some((message) => stringValue(message.id) === input.upToMessageId)) {
    throw new Error("Message is not part of this scene");
  }
  const forkChat = await storage.create<JsonRecord>("chats", {
    name: `${baseName} ${input.mode === "clone" ? "Clone" : "Converted"}`,
    mode: "roleplay",
    characterIds: stringArray(sceneChat.characterIds),
    groupId: sceneChat.groupId ?? null,
    folderId: sceneChat.folderId ?? null,
    personaId: sceneChat.personaId ?? null,
    promptPresetId: sceneChat.promptPresetId ?? null,
    connectionId: sceneChat.connectionId ?? null,
    metadata: forkMetadata(sceneMeta),
  });
  const forkChatId = stringValue(forkChat.id);
  if (!forkChatId) throw new Error("Created fork chat has no id");

  if (input.includePreSceneSummary !== false) {
    const continuity = buildForkContinuityMessage(sceneMeta);
    if (continuity) {
      await createChatMessage(storage, forkChatId, {
        role: "narrator",
        content: continuity,
        extra: { hiddenFromUser: true, isSceneContinuity: true },
      });
    }
  }

  let skippedGuide = false;
  const trackerMessageRebases: TrackerSnapshotMessageRebase[] = [];
  for (const message of sourceMessages) {
    const sourceMessageId = stringValue(message.id).trim();
    const stopAfterThis = input.upToMessageId && sourceMessageId === input.upToMessageId;
    if (input.includeParticipationGuide === false && !skippedGuide && message.role === "narrator") {
      skippedGuide = true;
      if (stopAfterThis) break;
      continue;
    }
    const copy = { ...message };
    delete copy.id;
    copy.chatId = forkChatId;
    const created = await storage.create<JsonRecord>("messages", copy);
    const targetMessageId = stringValue(created.id).trim();
    if (sourceMessageId && targetMessageId) {
      trackerMessageRebases.push({
        sourceMessageId,
        targetMessageId,
        role: created.role ?? copy.role,
        activeSwipeIndex: created.activeSwipeIndex ?? copy.activeSwipeIndex,
        swipeCount: created.swipeCount ?? copy.swipeCount,
      });
    }
    if (stopAfterThis) break;
  }
  const visibleTrackerSnapshot = await copyTrackerSnapshotsForRebasedMessages(
    storage,
    input.sceneChatId,
    forkChatId,
    trackerMessageRebases,
  );
  if (visibleTrackerSnapshot) {
    await storage.update("chats", forkChatId, { gameState: visibleTrackerSnapshot as unknown as JsonRecord });
  }

  if (input.mode === "convert") {
    if (originChatId) await cleanOriginScenePointers(storage, originChatId);
    await deleteChatWithMessages(storage, input.sceneChatId);
  }

  return { chatId: forkChatId, originChatId, mode: input.mode };
}

async function summarizeScene(
  capabilities: RoleplaySceneCapabilities,
  sceneChatId: string,
  connectionOverride?: string | null,
): Promise<string> {
  const sceneChat = await requireChat(capabilities.storage, sceneChatId);
  const sceneMeta = parseJsonObject(sceneChat.metadata);
  const plannerContext = await buildScenePlannerContext(capabilities.storage, sceneChat);
  const messages = await messagesForChat(capabilities.storage, sceneChatId);
  const transcriptLines = formatSceneTranscriptMessages(messages);
  const transcriptChunks = chunkSceneTranscript(transcriptLines, SCENE_SUMMARY_CHUNK_MAX_CHARS);

  try {
    const connectionId = await resolveConnectionId(capabilities.storage, sceneChat, connectionOverride ?? null);
    const chunkSummaries: string[] = [];
    for (let index = 0; index < transcriptChunks.length; index += 1) {
      chunkSummaries.push(
        await summarizeSceneChunk({
          capabilities,
          connectionId,
          sceneChat,
          sceneMeta,
          plannerContext,
          chunk: transcriptChunks[index]!,
          chunkIndex: index,
          chunkCount: transcriptChunks.length,
        }),
      );
    }
    return await synthesizeSceneSummary({
      capabilities,
      connectionId,
      sceneChat,
      sceneMeta,
      plannerContext,
      chunkSummaries,
      transcriptLineCount: transcriptLines.length,
      transcriptCharCount: transcriptLines.join("\n").length,
    });
  } catch (error) {
    throw new Error(`Scene summary generation failed: ${errorMessage(error)}`);
  }
}

type SceneSummaryContext = {
  capabilities: RoleplaySceneCapabilities;
  connectionId: string;
  sceneChat: JsonRecord;
  sceneMeta: JsonRecord;
  plannerContext: ScenePlannerContext;
};

async function summarizeSceneChunk(
  context: SceneSummaryContext & { chunk: string; chunkIndex: number; chunkCount: number },
): Promise<string> {
  const raw = await completeSceneSummaryText(
    context.capabilities.llm,
    {
      connectionId: context.connectionId,
      messages: [
        {
          role: "system",
          content: [
            "Summarize this section of a completed roleplay scene in concise third-person prose.",
            "This is an intermediate continuity summary, not the final user-facing summary.",
            "Capture concrete events, choices, emotional or relationship shifts, promises, conflicts, reveals, and unresolved hooks present in this section.",
            "Do not invent events. Do not omit major changes just because they are uncomfortable or intense.",
            "Return only the section summary.",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            `Scene section ${context.chunkIndex + 1} of ${context.chunkCount}`,
            "",
            "Scene metadata:",
            formatSceneSummaryMetadata(context.sceneChat, context.sceneMeta),
            "",
            "Selected character cards:",
            formatParticipantList(context.plannerContext.characters),
            "",
            "Active persona:",
            context.plannerContext.persona ? formatParticipant(context.plannerContext.persona) : "(none)",
            "",
            "Transcript section:",
            context.chunk,
          ].join("\n"),
        },
      ],
    },
    {
      temperature: 0.45,
      maxTokens: SCENE_SUMMARY_CHUNK_MAX_TOKENS,
      retryMaxTokens: SCENE_SUMMARY_CHUNK_RETRY_MAX_TOKENS,
    },
  );
  return sanitizeSceneSummary(raw, SCENE_SUMMARY_CHUNK_MAX_SUMMARY_CHARS);
}

type SceneFinalSummaryContext = SceneSummaryContext & {
  chunkSummaries: string[];
  transcriptLineCount: number;
  transcriptCharCount: number;
};

async function synthesizeSceneSummary(context: SceneFinalSummaryContext): Promise<string> {
  const raw = await completeSceneSummaryText(
    context.capabilities.llm,
    {
      connectionId: context.connectionId,
      messages: finalSceneSummaryMessages(context),
    },
    {
      temperature: 0.5,
      maxTokens: SCENE_SUMMARY_FINAL_MAX_TOKENS,
      retryMaxTokens: SCENE_SUMMARY_FINAL_RETRY_MAX_TOKENS,
    },
  );
  let summary = sanitizeSceneSummary(raw, SCENE_SUMMARY_FINAL_MAX_SUMMARY_CHARS);
  if (!requiresSubstantialFinalSummary(context) || !isFinalSceneSummaryTooBrief(summary)) return summary;

  const retryRaw = await completeSceneSummaryText(
    context.capabilities.llm,
    {
      connectionId: context.connectionId,
      messages: finalSceneSummaryMessages(context, summary),
    },
    {
      temperature: 0.35,
      maxTokens: SCENE_SUMMARY_FINAL_RETRY_MAX_TOKENS,
      retryMaxTokens: SCENE_SUMMARY_FINAL_RETRY_MAX_TOKENS,
    },
  );
  summary = sanitizeSceneSummary(retryRaw, SCENE_SUMMARY_FINAL_MAX_SUMMARY_CHARS);
  if (isFinalSceneSummaryTooBrief(summary)) throw new Error("The model returned an incomplete scene summary");
  return summary;
}

function finalSceneSummaryMessages(
  context: SceneFinalSummaryContext,
  previousTooBriefSummary?: string,
): SceneSummaryCompletionRequest["messages"] {
  return [
    {
      role: "system",
      content: [
        "Synthesize the final conclusion summary for a completed roleplay scene.",
        "Use every section summary below so the final summary represents the whole scene, not only the beginning or ending.",
        "Write concise but substantial third-person prose, roughly 2-5 paragraphs and at least 3 complete sentences when there is enough scene history.",
        "Include the scene premise, key events across the full scene, emotional and relationship shifts, concrete outcomes, promises, conflicts, reveals, and unresolved hooks.",
        previousTooBriefSummary
          ? "Your previous answer was too brief. Rewrite it as a fuller whole-scene conclusion, not a one-sentence takeaway."
          : "Do not collapse the scene into a one-sentence takeaway when the section summaries contain multiple beats.",
        "Do not invent events. Return only the final summary.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        "Scene metadata:",
        formatSceneSummaryMetadata(context.sceneChat, context.sceneMeta),
        "",
        "Selected character cards:",
        formatParticipantList(context.plannerContext.characters),
        "",
        "Active persona:",
        context.plannerContext.persona ? formatParticipant(context.plannerContext.persona) : "(none)",
        "",
        previousTooBriefSummary ? "Previous summary was too brief:" : "",
        previousTooBriefSummary ?? "",
        previousTooBriefSummary ? "" : "",
        "Section summaries:",
        formatSceneChunkSummaries(context.chunkSummaries),
      ]
        .filter((line, index, lines) => line || lines[index - 1] !== "")
        .join("\n"),
    },
  ];
}

function requiresSubstantialFinalSummary(context: SceneFinalSummaryContext): boolean {
  return (
    context.chunkSummaries.length > 1 ||
    context.transcriptLineCount >= SCENE_SUMMARY_SUBSTANTIAL_TRANSCRIPT_MIN_LINES ||
    context.transcriptCharCount >= SCENE_SUMMARY_SUBSTANTIAL_TRANSCRIPT_MIN_CHARS
  );
}

function isFinalSceneSummaryTooBrief(summary: string): boolean {
  return countCompleteSentences(summary) < SCENE_SUMMARY_FINAL_MIN_SENTENCES;
}

function countCompleteSentences(value: string): number {
  return value.match(/[.!?](?=\s|$)/g)?.length ?? 0;
}

type SceneSummaryCompletionRequest = Pick<LlmRequest, "connectionId" | "messages">;

type SceneSummaryCompletionOptions = {
  temperature: number;
  maxTokens: number;
  retryMaxTokens: number;
};

async function completeSceneSummaryText(
  llm: LlmGateway,
  request: SceneSummaryCompletionRequest,
  options: SceneSummaryCompletionOptions,
): Promise<string> {
  try {
    return await llm.complete({
      ...request,
      parameters: sceneSummaryParameters(options.temperature, options.maxTokens),
    });
  } catch (error) {
    if (!retryableEmptySceneSummaryResponse(error)) throw error;
    return llm.complete({
      ...request,
      parameters: sceneSummaryParameters(options.temperature, options.retryMaxTokens),
    });
  }
}

function sceneSummaryParameters(temperature: number, maxTokens: number): Record<string, unknown> {
  return {
    temperature,
    maxTokens,
    reasoningEffort: "none",
    reasoning_effort: "none",
    customParameters: {
      reasoning_effort: "none",
      reasoning: { exclude: true },
    },
  };
}

function retryableEmptySceneSummaryResponse(error: unknown): boolean {
  const text = collectErrorText(error).join(" ").toLowerCase();
  return (
    text.includes("provider response did not contain assistant text") ||
    text.includes("did not contain assistant text or tool calls") ||
    text.includes("empty assistant") ||
    text.includes("no final assistant text")
  );
}

function collectErrorText(value: unknown, seen = new Set<unknown>()): string[] {
  if (value == null) return [];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (typeof value !== "object") return [];
  if (seen.has(value)) return [];
  seen.add(value);

  const parts: string[] = [];
  if (value instanceof Error) {
    parts.push(value.name, value.message);
    parts.push(...collectErrorText(value.cause, seen));
  }

  const record = value as Record<string, unknown>;
  for (const key of [
    "code",
    "status",
    "statusCode",
    "error",
    "message",
    "details",
    "data",
    "payload",
    "providerMetadata",
    "provider_metadata",
    "finishReason",
    "finish_reason",
    "type",
  ]) {
    if (record[key] !== undefined) parts.push(key);
    parts.push(...collectErrorText(record[key], seen));
  }
  return parts.filter(Boolean);
}
function formatSceneTranscriptMessages(messages: StoredMessage[]): string[] {
  return messages
    .map((message, index) => {
      const role = stringValue(message.role) || "message";
      const characterId = stringValue(message.characterId).trim();
      const content = stripSummaryLabels(stringValue(message.content)).replace(/\s+/g, " ").trim();
      if (!content) return "";
      const speaker = characterId ? `${role} (${characterId})` : role;
      return `Message ${index + 1} - ${speaker}: ${content}`;
    })
    .filter(Boolean);
}

function chunkSceneTranscript(lines: string[], maxChars: number): string[] {
  if (lines.length === 0) return ["(No visible scene transcript.)"];
  const chunks: string[] = [];
  let current: string[] = [];
  let currentLength = 0;

  for (const line of lines) {
    const separatorLength = current.length > 0 ? 2 : 0;
    if (current.length > 0 && currentLength + separatorLength + line.length > maxChars) {
      chunks.push(current.join("\n\n"));
      current = [];
      currentLength = 0;
    }
    current.push(line);
    currentLength += (current.length > 1 ? 2 : 0) + line.length;
  }

  if (current.length > 0) chunks.push(current.join("\n\n"));
  return chunks;
}

function formatSceneChunkSummaries(summaries: string[]): string {
  return summaries.map((summary, index) => `Section ${index + 1}: ${summary}`).join("\n\n");
}

async function fallbackScenePlan(storage: StorageGateway, chatId: string, prompt: string): Promise<SceneFullPlan> {
  const chat = await requireChat(storage, chatId);
  const characterIds = stringArray(chat.characterIds);
  const history = (
    await messagesForChat(storage, chatId, { limit: SCENE_FALLBACK_HISTORY_LIMIT, fields: ["role", "content"] })
  )
    .slice(-8)
    .map((message) => {
      const role = stringValue(message.role) || "user";
      const content = stringValue(message.content).trim();
      return content ? `${role}: ${content}` : "";
    })
    .filter(Boolean)
    .join("\n");
  const premise =
    prompt ||
    history.split(/\r?\n/).filter(Boolean).at(-1) ||
    "A focused roleplay scene continues from the current conversation.";
  return {
    name: safeTitle(premise, "New Scene"),
    description: `The scene opens around this premise: ${premise}`,
    scenario: history
      ? `Use the recent conversation as continuity and develop this premise: ${premise}\n\nRecent context:\n${history}`
      : premise,
    firstMessage: `The moment settles into focus. ${premise}`,
    background: null,
    characterIds,
    systemPrompt:
      "Write immersive roleplay prose with consistent point of view, clear character agency, and continuity from the originating conversation.",
    rating: "sfw",
    relationshipHistory: history,
    participationGuide: "Play the scene naturally and respond as your character would.",
  };
}

async function buildScenePlannerContext(storage: StorageGateway, chat: JsonRecord): Promise<ScenePlannerContext> {
  const characterIds = stringArray(chat.characterIds);
  const [characters, persona] = await Promise.all([
    loadParticipantContexts(storage, "characters", characterIds),
    loadActivePersonaContext(storage, chat),
  ]);
  return { characters, persona };
}

async function loadParticipantContexts(
  storage: StorageGateway,
  entity: "characters" | "personas",
  ids: string[],
): Promise<SceneParticipantContext[]> {
  const rows = await Promise.all(ids.map((id) => storage.get<JsonRecord>(entity, id).catch(() => null)));
  return rows
    .map((row, index) => (isRecord(row) ? participantContext(row, ids[index] ?? "") : null))
    .filter((participant): participant is SceneParticipantContext => participant !== null);
}

async function loadActivePersonaContext(
  storage: StorageGateway,
  chat: JsonRecord,
): Promise<SceneParticipantContext | null> {
  const personaId = stringValue(chat.personaId).trim();
  if (personaId) {
    const persona = await storage.get<JsonRecord>("personas", personaId).catch(() => null);
    return isRecord(persona) ? participantContext(persona, personaId) : null;
  }
  const personas = await storage.list<JsonRecord>("personas").catch(() => []);
  const activePersona = personas.find(
    (persona) => persona.isActive === true || stringValue(persona.isActive) === "true",
  );
  return isRecord(activePersona) ? participantContext(activePersona, stringValue(activePersona.id).trim()) : null;
}

function participantContext(row: JsonRecord, fallbackId: string): SceneParticipantContext {
  const data = contextData(row);
  const id = stringValue(row.id).trim() || fallbackId;
  return {
    id,
    name: compactPromptText(data.name || row.name || id || "Unknown", 120),
    description: compactPromptText(data.description || row.description, 1200),
    personality: compactPromptText(data.personality || row.personality, 900),
    scenario: compactPromptText(data.scenario || row.scenario, 900),
    appearance: compactPromptText(data.appearance || row.appearance, 900),
    backstory: compactPromptText(data.backstory || data.comment || row.backstory || row.comment, 900),
    firstMessage: compactPromptText(data.first_mes || data.firstMessage || row.first_mes || row.firstMessage, 600),
    exampleDialogue: compactPromptText(
      data.mes_example || data.exampleDialogue || row.mes_example || row.exampleDialogue,
      900,
    ),
    systemPrompt: compactPromptText(
      data.system_prompt || data.systemPrompt || row.system_prompt || row.systemPrompt,
      900,
    ),
    postHistoryInstructions: compactPromptText(
      data.post_history_instructions ||
        data.postHistoryInstructions ||
        row.post_history_instructions ||
        row.postHistoryInstructions,
      900,
    ),
    tags: uniqueStrings([...stringArray(data.tags), ...stringArray(row.tags)]).slice(0, 12),
  };
}

function contextData(row: JsonRecord): JsonRecord {
  const data = characterData(row);
  return Object.keys(data).length > 0 ? data : row;
}

function formatParticipantList(participants: SceneParticipantContext[]): string {
  if (participants.length === 0) return "(none)";
  return participants
    .map((participant, index) => `Participant ${index + 1}:\n${formatParticipant(participant)}`)
    .join("\n\n");
}

function formatParticipant(participant: SceneParticipantContext): string {
  const lines = [`id: ${participant.id}`, `name: ${participant.name || "(unnamed)"}`];
  appendLabeledLine(lines, "description", participant.description);
  appendLabeledLine(lines, "personality", participant.personality);
  appendLabeledLine(lines, "appearance", participant.appearance);
  appendLabeledLine(lines, "backstory", participant.backstory);
  appendLabeledLine(lines, "scenario", participant.scenario);
  appendLabeledLine(lines, "first_message", participant.firstMessage);
  appendLabeledLine(lines, "example_dialogue", participant.exampleDialogue);
  appendLabeledLine(lines, "system_prompt", participant.systemPrompt);
  appendLabeledLine(lines, "post_history_instructions", participant.postHistoryInstructions);
  if (participant.tags.length > 0) appendLabeledLine(lines, "tags", participant.tags.join(", "));
  return lines.join("\n");
}

function formatSceneSummaryMetadata(sceneChat: JsonRecord, sceneMeta: JsonRecord): string {
  const lines: string[] = [];
  appendLabeledLine(lines, "name", stringValue(sceneChat.name));
  appendLabeledLine(lines, "date", new Date().toISOString().slice(0, 10));
  appendLabeledLine(lines, "description", stringValue(sceneMeta.sceneDescription));
  appendLabeledLine(lines, "scenario", stringValue(sceneMeta.sceneScenario));
  appendLabeledLine(lines, "background", stringValue(sceneMeta.sceneBackground || sceneMeta.background));
  appendLabeledLine(lines, "rating", stringValue(sceneMeta.sceneRating));
  appendLabeledLine(lines, "relationship_history", stringValue(sceneMeta.sceneRelationshipHistory));
  appendLabeledLine(lines, "origin_conversation_context", stringValue(sceneMeta.sceneConversationContext));
  return lines.length > 0 ? lines.join("\n") : "(none)";
}

function appendLabeledLine(lines: string[], label: string, value: string): void {
  const text = value.trim();
  if (text) lines.push(`${label}: ${text}`);
}

function compactPromptText(value: unknown, limit: number): string {
  const text = stringValue(value).replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 3).trimEnd()}...` : text;
}

function sanitizeSceneSummary(raw: string, maxChars = SCENE_SUMMARY_CHUNK_MAX_SUMMARY_CHARS): string {
  const summary = sentenceBoundaryTrim(stripSummaryLabels(raw), maxChars);
  if (!summary) throw new Error("The model returned an empty scene summary");
  return ensureTerminalPunctuation(summary);
}

function stripSummaryLabels(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/^\s*(?:scene\s+summary|summary)\s*:\s*/i, "")
    .replace(/(^|\n)\s*(?:assistant|narrator|user|system|tool)\s*:\s*/gi, "$1")
    .trim();
}

function sentenceBoundaryTrim(value: string, limit: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || text.length <= limit) return text;

  const candidate = text.slice(0, limit).trimEnd();
  const sentenceEndings = Array.from(candidate.matchAll(/[.!?](?=\s|$)/g));
  const lastSentence = sentenceEndings.at(-1);
  if (lastSentence?.index !== undefined && lastSentence.index > limit * 0.45) {
    return candidate.slice(0, lastSentence.index + 1).trim();
  }

  const lastSpace = candidate.lastIndexOf(" ");
  const wordBoundary = lastSpace > limit * 0.45 ? candidate.slice(0, lastSpace) : candidate;
  return `${wordBoundary.trimEnd()}...`;
}

function ensureTerminalPunctuation(value: string): string {
  const text = value.trim();
  if (!text) return text;
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = value.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function sanitizeScenePlan(parsed: JsonRecord, fallback: SceneFullPlan, allowedCharacterIds: string[]): SceneFullPlan {
  const requestedIds = stringArray(parsed.characterIds);
  const characterIds =
    requestedIds.length === 0
      ? fallback.characterIds
      : allowedCharacterIds.length === 0
        ? requestedIds
        : requestedIds.filter((id) => allowedCharacterIds.includes(id));
  return {
    name: safeTitle(stringValue(parsed.name) || fallback.name, "New Scene"),
    description: stringValue(parsed.description) || fallback.description,
    scenario: stringValue(parsed.scenario) || fallback.scenario,
    firstMessage: stringValue(parsed.firstMessage) || fallback.firstMessage,
    background: null,
    characterIds,
    systemPrompt: stringValue(parsed.systemPrompt) || fallback.systemPrompt,
    rating: parsed.rating === "nsfw" ? "nsfw" : "sfw",
    relationshipHistory: stringValue(parsed.relationshipHistory) || fallback.relationshipHistory,
    participationGuide: stringValue(parsed.participationGuide) || fallback.participationGuide,
    presetChoices: parsePresetChoiceHints(parsed.presetChoices),
  };
}

function parsePresetChoiceHints(value: unknown): Record<string, string> | undefined {
  const record = parseJsonObject(value);
  const choices = Object.fromEntries(
    Object.entries(record)
      .map(([key, entry]) => [key, stringValue(entry).trim()] as const)
      .filter(([, entry]) => entry.length > 0),
  );
  return Object.keys(choices).length > 0 ? choices : undefined;
}

function safeTitle(value: string, fallback: string): string {
  const title = (value.trim() || fallback)
    .replace(/[\r\n\t]/g, " ")
    .split(/\s+/)
    .join(" ")
    .slice(0, 60);
  return title.startsWith("Scene:") ? title : `Scene: ${title}`;
}

async function requireChat(storage: StorageGateway, chatId: string): Promise<JsonRecord> {
  const chat = await storage.get<JsonRecord>("chats", chatId);
  if (!chat) throw new Error("Chat not found");
  return chat;
}

async function messagesForChat(
  storage: StorageGateway,
  chatId: string,
  options?: ChatMessageListOptions,
): Promise<StoredMessage[]> {
  const rows = await storage.listChatMessages<unknown>(chatId, options);
  return Array.isArray(rows) ? rows.filter(isRecord) : [];
}

function chronologicalMessages(messages: StoredMessage[]): StoredMessage[] {
  return [...messages].sort((a, b) => {
    const aTime = Date.parse(stringValue(a.createdAt));
    const bTime = Date.parse(stringValue(b.createdAt));
    if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return aTime - bTime;
    return stringValue(a.id).localeCompare(stringValue(b.id));
  });
}

async function createChatMessage(storage: StorageGateway, chatId: string, message: JsonRecord): Promise<void> {
  await storage.createChatMessage(chatId, message);
}

async function patchChatMetadata(storage: StorageGateway, chatId: string, patch: JsonRecord): Promise<void> {
  await storage.patchChatMetadata(chatId, patch);
}

async function buildSceneConversationContext(storage: StorageGateway, originChatId: string): Promise<string> {
  return (
    await messagesForChat(storage, originChatId, {
      limit: SCENE_CONVERSATION_CONTEXT_LIMIT,
      fields: ["role", "content"],
    })
  )
    .slice(-24)
    .map((message) => {
      const role = stringValue(message.role) || "message";
      const content = stringValue(message.content).trim();
      return content ? `${role}: ${content}` : "";
    })
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 12000);
}

function formatSceneReturnMessage(sceneChat: JsonRecord, summary: string): string {
  const sceneName = stringValue(sceneChat.name).trim() || "the scene";
  return [`The scene "${sceneName.replace(/^Scene:\s*/i, "")}" concluded.`, "", summary.trim()].join("\n");
}

function characterData(row: JsonRecord): JsonRecord {
  const raw = row.data;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return isRecord(raw) ? raw : {};
}

async function writeCharacterSceneMemories(
  storage: StorageGateway,
  sceneChat: JsonRecord,
  summary: string,
): Promise<void> {
  const sceneName =
    stringValue(sceneChat.name)
      .replace(/^Scene:\s*/i, "")
      .trim() || "Scene";
  const createdAt = new Date().toISOString();
  const summaryLine = `[Scene on ${createdAt.slice(0, 10)}: ${sceneName}] ${summary.trim()}`;
  for (const characterId of stringArray(sceneChat.characterIds)) {
    const row = await storage.get<JsonRecord>("characters", characterId);
    if (!isRecord(row)) continue;
    const data = characterData(row);
    const extensions = isRecord(data.extensions) ? { ...data.extensions } : {};
    const previous = Array.isArray(extensions.characterMemories) ? extensions.characterMemories : [];
    extensions.characterMemories = [
      ...previous.filter((memory) => {
        const record = parseJsonObject(memory);
        return stringValue(record.sceneChatId) !== stringValue(sceneChat.id);
      }),
      {
        from: sceneName,
        fromCharId: null,
        sceneChatId: stringValue(sceneChat.id),
        summary: summaryLine,
        createdAt,
      },
    ].slice(-100);
    await storage.update("characters", characterId, { data: { ...data, extensions } });
  }
}

async function appendSceneMemory(
  storage: StorageGateway,
  originChatId: string,
  sceneChatId: string,
  summary: string,
): Promise<void> {
  const originChat = await requireChat(storage, originChatId);
  const originMeta = parseJsonObject(originChat.metadata);
  const sceneChat = await requireChat(storage, sceneChatId);
  const previous = Array.isArray(originMeta.roleplaySceneHistory) ? originMeta.roleplaySceneHistory : [];
  const next = [
    ...previous.filter((entry) => parseJsonObject(entry).sceneChatId !== sceneChatId),
    {
      sceneChatId,
      concludedAt: new Date().toISOString(),
      summary,
    },
  ].slice(-20);
  await patchChatMetadata(storage, originChatId, {
    roleplaySceneHistory: next,
    lastRoleplaySceneSummary: summary,
    lastRoleplaySceneOptions: sceneCarryoverOptions(parseJsonObject(sceneChat.metadata)),
  });
}

async function rememberLastSceneOptions(
  storage: StorageGateway,
  originChatId: string,
  sceneChat: JsonRecord,
): Promise<void> {
  await patchChatMetadata(storage, originChatId, {
    lastRoleplaySceneOptions: sceneCarryoverOptions(parseJsonObject(sceneChat.metadata)),
  });
}

async function cleanOriginScenePointers(storage: StorageGateway, originChatId: string): Promise<void> {
  await patchChatMetadata(storage, originChatId, {
    activeSceneChatId: null,
    sceneBusyCharIds: null,
  });
  await storage.update("chats", originChatId, { connectedChatId: null });
}

async function deleteChatWithMessages(storage: StorageGateway, chatId: string): Promise<void> {
  const messageIds = (await messagesForChat(storage, chatId))
    .map((message) => stringValue(message.id).trim())
    .filter((id) => id.length > 0);
  if (messageIds.length > 0) {
    if (!storage.bulkDeleteChatMessages) throw new Error("Bulk chat message delete is not available");
    await storage.bulkDeleteChatMessages(chatId, messageIds);
  }
  await storage.delete("chats", chatId);
}

function forkMetadata(sceneMeta: JsonRecord): JsonRecord {
  const excluded = new Set([
    "sceneOriginChatId",
    "sceneInitiatorCharId",
    "sceneDescription",
    "sceneScenario",
    "sceneSystemPrompt",
    "sceneRating",
    "sceneStatus",
    "sceneConversationContext",
    "sceneRelationshipHistory",
    "sceneBackground",
    "activeSceneChatId",
    "sceneBusyCharIds",
  ]);
  return Object.fromEntries(
    Object.entries(sceneMeta).filter(([key]) => !excluded.has(key) && !key.startsWith("scene")),
  );
}

function buildForkContinuityMessage(sceneMeta: JsonRecord): string | null {
  const lines: string[] = [];
  const context = stringValue(sceneMeta.sceneConversationContext).trim();
  const relationship = stringValue(sceneMeta.sceneRelationshipHistory).trim();
  const scenario = stringValue(sceneMeta.sceneScenario).trim();
  if (context) lines.push("Origin conversation context:", context);
  if (relationship) lines.push("Relationship history:", relationship);
  if (scenario) lines.push("Scene premise:", scenario);
  if (!lines.length) return null;
  return ["Hidden continuity carried from the original scene branch.", "", ...lines].join("\n");
}

async function resolveConnectionId(
  storage: StorageGateway,
  chat: JsonRecord,
  override?: string | null,
): Promise<string> {
  if (override?.trim()) return override.trim();
  const chatConnectionId = stringValue(chat.connectionId).trim();
  const connections = await storage.list<JsonRecord>("connections");
  if (chatConnectionId === "random") {
    const pool = connections.filter((connection) => boolish(connection.useForRandom, false));
    const selected = pool[Math.floor(Math.random() * pool.length)];
    if (!selected?.id) throw new Error("No connections marked for the random pool");
    return stringValue(selected.id);
  }
  if (chatConnectionId) return chatConnectionId;
  const selected =
    connections.find((connection) => boolish(connection.isDefault, false) || boolish(connection.default, false)) ??
    connections[0];
  const id = stringValue(selected?.id);
  if (!id) throw new Error("No connection configured");
  return id;
}

function copyOptional(source: JsonRecord, keys: string[]): JsonRecord {
  return Object.fromEntries(keys.filter((key) => key in source).map((key) => [key, source[key]]));
}

const SCENE_CARRYOVER_METADATA_KEYS = [
  "agentOverrides",
  "enableAgents",
  "enableTools",
  "toolSelectionMode",
  "expressionAvatarsEnabled",
  "spriteSide",
  "spotifySourceType",
  "spotifyPlaylistId",
  "spotifyPlaylistName",
  "spotifyArtist",
  "spotifyVolume",
  "spotifyMood",
] as const;

function sceneCarryoverSource(originMeta: JsonRecord): JsonRecord {
  const lastSceneOptions = parseJsonObject(originMeta.lastRoleplaySceneOptions);
  return Object.keys(lastSceneOptions).length > 0 ? lastSceneOptions : originMeta;
}

function sceneCarryoverOptions(originMeta: JsonRecord): JsonRecord {
  const source = sceneCarryoverSource(originMeta);
  const options = copyOptional(source, [...SCENE_CARRYOVER_METADATA_KEYS]);
  const activeAgentIds = stringArray(source.activeAgentIds);
  const activeToolIds = stringArray(source.activeToolIds);
  if (activeAgentIds.length > 0) {
    options.activeAgentIds = activeAgentIds;
  }
  if (source.enableTools === false) {
    options.enableTools = false;
  } else if (activeToolIds.length > 0) {
    options.activeToolIds = activeToolIds;
    options.enableTools = true;
  } else if (typeof source.enableTools === "boolean") {
    options.enableTools = source.enableTools;
  }
  return options;
}

function parseObject(raw: string): JsonRecord {
  try {
    const parsed = parseGameJsonish(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function stringArray(value: unknown): string[] {
  return parseJsonArray<string>(value).filter((item) => typeof item === "string" && item.trim().length > 0);
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function sceneFolderIdForOriginMode(mode: unknown, folderId: unknown): unknown {
  const originMode = stringValue(mode).trim();
  if (originMode === "conversation") return null;
  if (originMode === "roleplay" || originMode === "visual_novel") return folderId ?? null;
  throw new Error(`Cannot create roleplay scene from chat mode: ${originMode || "(missing)"}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "Unknown error");
}
