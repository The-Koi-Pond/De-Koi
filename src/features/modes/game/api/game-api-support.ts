import type { Chat } from "../../../../engine/contracts/types/chat";
import type { Lorebook, LorebookEntry } from "../../../../engine/contracts/types/lorebook";
import type {
  CombatInitState,
  CombatMechanic,
  EncounterSettings,
} from "../../../../engine/contracts/types/combat-encounter";
import type { AgentDebugEntry } from "../../../../engine/contracts/types/agent";
import type {
  Combatant,
  CombatPlayerAction,
  GameActiveState,
  GameCheckpoint,
  GameMap,
  GameNpc,
  GameSetupConfig,
  HudWidget,
  PartyArc,
  SessionSummary,
  SkillCheckResult,
} from "../../../../engine/contracts/types/game";
import type { RPGAttributes } from "../../../../engine/contracts/types/game-state";
import { ApiError, isJsonRepairApiError, type JsonRepairRequest } from "../../../../shared/api/api-errors";
import { gameAssetsApi } from "../../../../shared/api/assets-api";
import { imageGenerationApi, spriteApi } from "../../../../shared/api/image-generation-api";
import { integrationGateway } from "../../../../shared/api/integration-gateway";
import { spotifyApi } from "../../../../shared/api/integration-utility-api";
import { llmApi } from "../../../../shared/api/llm-api";
import { chatCommandApi } from "../../../../shared/api/chat-command-api";
import { resolveGalleryFileUrl } from "../../../../shared/api/local-file-api";
import { storageApi } from "../../../../shared/api/storage-api";
import { urlBinaryApi } from "../../../../shared/api/url-binary-api";
import { visualAssetsApi } from "../../../../shared/api/visual-assets-api";
import {
  createLorebookEntrySchema,
  createLorebookSchema,
  updateLorebookEntrySchema,
} from "../../../../engine/contracts/schemas/lorebook.schema";
import { resolveCombatRound } from "../../../../engine/modes/game/mechanics/combat.service";
import { initGameCombatEncounter } from "../../../../engine/modes/game/mechanics/combat-init.service";
import { rollDice as rollGameDice } from "../../../../engine/modes/game/mechanics/dice.service";
import {
  rollEncounter as rollGameEncounter,
  rollEnemyCount,
} from "../../../../engine/modes/game/mechanics/encounter.service";
import {
  generateCombatLoot,
  generateLootTable,
  type LootDrop,
} from "../../../../engine/modes/game/mechanics/loot.service";
import { processReputationActions } from "../../../../engine/modes/game/mechanics/reputation.service";
import {
  getGoverningAttribute,
  mapSheetAttributesToRPG,
  resolveSkillCheck,
} from "../../../../engine/modes/game/mechanics/skill-check.service";
import { serializeResolvedSkillCheckTag } from "../../../../engine/shared/scoring/skill-check-format";
import { parseGameJsonish } from "../../../../engine/shared/parsing-jsonish";
import {
  applyMoraleEvent,
  getMoraleTier,
  type MoraleEvent,
} from "../../../../engine/modes/game/mechanics/morale.service";
import {
  getElementPreset,
  listElementPresets,
} from "../../../../engine/modes/game/mechanics/element-reactions.service";
import { buildPartySystemPrompt } from "../../../../engine/modes/game/prompts/party-prompts";
import {
  buildPartyRecruitCardPrompt,
  buildSessionConclusionPrompt,
  buildSetupPrompt,
} from "../../../../engine/modes/game/prompts/gm-prompts";
import {
  loadCharacterSprites,
  type CharacterSpriteSubject,
} from "../../../../engine/modes/game/prompts/sprite.service";
import {
  GAME_BACKGROUND_PROMPT_OVERRIDE,
  GAME_ILLUSTRATION_PROMPT_OVERRIDE,
  GAME_PORTRAIT_PROMPT_OVERRIDE,
  loadRegisteredPrompt,
  type ImagePromptOverrideContext,
  type PromptOverrideKeyDef,
} from "../../../../engine/generation/prompt-overrides";
import { dedupeSessionSummaryLists } from "../../../../engine/modes/game/state/session-summary-normalization";
import { buildRecapPrompt, buildSessionCarryoverContext } from "../../../../engine/modes/game/state/session.service";
import { validateTransition } from "../../../../engine/modes/game/state/state-machine.service";
import {
  applyJournalEntry,
  buildDeterministicSummary,
  buildStructuredRecap,
  createJournal,
  syncJournalFromGameState,
  type Journal,
} from "../../../../engine/modes/game/world/journal.service";
import { buildMapGenerationPrompt } from "../../../../engine/modes/game/world/map.service";
import { withActiveGameMapMeta } from "../../../../engine/modes/game/world/map-position.service";
import {
  createInitialTime,
  formatGameTime,
  advanceTime as advanceGameTime,
  isTimeOfDayLabel,
  setTimeOfDay,
  type GameTime,
} from "../../../../engine/modes/game/world/time.service";
import {
  generateWeather,
  inferBiome,
  type Season,
  type WeatherState,
} from "../../../../engine/modes/game/world/weather.service";
import { clonePlayerStats } from "../../../../engine/shared/game-state/player-stats";
import { parsePartyDialogue } from "../lib/party-dialogue-parser";
import {
  compiledSceneAssetNegativePrompt,
  gameImageGenerationRequest,
  sceneAssetPrompt,
  type GameImageAssetKind,
} from "./game-asset-prompts";
import type { ImageStyleProfileSettings } from "../../../../engine/generation/image-style-profiles";

export interface CreateGameResponse {
  sessionChat: Chat;
  gameId: string;
}

export interface SetupResponse {
  setup: Record<string, unknown>;
  worldOverview: string | null;
  sessionChat: Chat;
}

export interface StartGameResponse {
  status: string;
  alreadyStarted?: boolean;
  sessionChat: Chat;
  checkpointWarning?: GameCheckpointWarning;
}

export interface StartSessionResponse {
  sessionChat: Chat;
  sessionNumber: number;
  recap: string;
  checkpointWarning?: GameCheckpointWarning;
}

export interface SessionSummaryResponse {
  summary: SessionSummary;
  sessionChat: Chat;
  checkpointWarning?: GameCheckpointWarning;
}

export interface GameCheckpointWarning {
  chatId: string;
  triggerType: string;
  label: string;
  message: string;
}

export interface RegenerateSessionLorebookResponse {
  sessionNumber: number;
  lorebookId: string;
  entryCount: number;
  sessionChat: Chat;
}

export interface UpdateCampaignProgressionResponse {
  sessionChat: Chat;
  gameId: string;
  campaignProgression: {
    storyArc: string | null;
    plotTwists: string[];
    partyArcs: unknown[];
  };
}

export interface PartyCardResponse {
  sessionChat: Chat;
  added?: boolean;
  removed?: boolean;
  characterName: string;
  cardCreated?: boolean;
  gameCard?: unknown;
}

export interface MapResponse {
  map: GameMap;
  maps?: GameMap[];
  activeGameMapId?: string | null;
  sessionChat: Chat;
}

export interface GameJournalResponse {
  journal: Journal;
  recap: string;
  playerNotes?: string;
}

export interface GameImagePromptReviewItem {
  id: string;
  kind: GameImageAssetKind;
  title: string;
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  referenceImages?: string[];
  referenceSubjectNames?: string[];
}

export interface GameAssetGenerationResult {
  generatedBackground: string | null;
  fallbackBackground: string | null;
  generatedIllustration: { tag: string; segment?: number; galleryId?: string | null } | null;
  generatedNpcAvatars: Array<{ name: string; avatarUrl: string; avatarGalleryId?: string | null }>;
  sessionChat?: Chat;
}

export type ImagePromptSettings = {
  includeAppearances?: boolean;
  format?: "descriptive" | "tags";
  styleProfileId?: string | null;
  styleProfiles?: ImageStyleProfileSettings;
};

export type GameAssetGenerationPayload = {
  chatId: string;
  backgroundTag?: string;
  npcsNeedingAvatars?: Array<{ name: string; description: string; gender?: string | null; pronouns?: string | null }>;
  forceNpcAvatarNames?: string[];
  illustration?: unknown;
  imageConnectionId?: string | null;
  artStylePrompt?: string | null;
  imageSizes?: Record<string, { width?: number; height?: number }>;
  imagePromptSettings?: ImagePromptSettings;
  promptOverrides?: PromptOverride[];
  [key: string]: unknown;
};

export type ChatMessage = {
  id?: string;
  role?: string;
  content?: string;
  createdAt?: string;
  [key: string]: unknown;
};

export type IllustrationReferenceSubject = {
  id: string;
  name: string;
  avatar: string;
  spriteOwnerType?: "character" | "persona";
};

export type PromptOverride = {
  id?: string;
  prompt?: string;
};

type GameJsonRepairKind =
  | "game_setup"
  | "game_map"
  | "session_conclusion"
  | "session_lorebook"
  | "campaign_progression"
  | "party_card";

export type GameJsonRepairContext = {
  kind: GameJsonRepairKind;
  title: string;
  applyBody: Record<string, unknown>;
};

export function newId(prefix = ""): string {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return prefix ? `${prefix}-${id}` : id;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function readTrimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function sheetAttributes(value: unknown): ReadonlyArray<{ name: string; value: number }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const attrs = value
    .map((item) => {
      const record = asRecord(item);
      const name = typeof record.name === "string" ? record.name.trim() : "";
      const parsedValue = Number(record.value);
      return name && Number.isFinite(parsedValue) ? { name, value: parsedValue } : null;
    })
    .filter((item): item is { name: string; value: number } => item !== null);
  return attrs.length ? attrs : undefined;
}

export function chatMeta(chat: Chat | null | undefined): Record<string, unknown> {
  return asRecord(chat?.metadata);
}

function discordWebhookUrl(meta: Record<string, unknown>): string {
  return typeof meta.discordWebhookUrl === "string" ? meta.discordWebhookUrl.trim() : "";
}

export function mirrorGameMessageToDiscord(meta: Record<string, unknown>, content: string, username: string): void {
  const webhookUrl = discordWebhookUrl(meta);
  const trimmed = content.trim();
  if (!webhookUrl || !trimmed) return;
  if (!integrationGateway.discord) {
    console.warn("[game] Discord mirror skipped: integration gateway unavailable");
    return;
  }
  void integrationGateway.discord.mirrorMessage({ webhookUrl, content: trimmed, username }).catch((error) => {
    console.warn("[game] Discord mirror failed", error);
  });
}

export async function getChat(chatId: string): Promise<Chat> {
  const chat = await storageApi.get<Chat>("chats", chatId);
  if (!chat) throw new Error(`Chat ${chatId} was not found.`);
  return chat;
}

export async function patchChatMetadata(chatId: string, patch: Record<string, unknown>): Promise<Chat> {
  const chat = await getChat(chatId);
  return storageApi.update<Chat>("chats", chatId, { metadata: { ...chatMeta(chat), ...patch } });
}

export async function patchChat(chatId: string, patch: Record<string, unknown>): Promise<Chat> {
  return storageApi.update<Chat>("chats", chatId, patch);
}

export async function listMessages(chatId: string, limit?: number): Promise<ChatMessage[]> {
  return storageApi.list<ChatMessage>("messages", { filters: { chatId }, limit });
}

export async function createChatRecord(value: Record<string, unknown>): Promise<Chat> {
  return storageApi.create<Chat>("chats", value);
}

export async function createChatMessage(chatId: string, value: Record<string, unknown>): Promise<ChatMessage> {
  return storageApi.create<ChatMessage>("messages", { ...value, chatId });
}

export function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = parseGameJsonish(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function readNumber(value: unknown, fallback: number): number {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return fallback;
  const parsed = typeof value === "number" ? value : Number(value.trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function recordName(record: Record<string, unknown>): string {
  const data = asRecord(record.data);
  return readTrimmed(data.name) || readTrimmed(record.name);
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => readTrimmed(entry)).filter(Boolean) : [];
}

export async function llmJson(input: {
  connectionId?: string | null;
  system: string;
  user: string;
  fallback: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  repair?: GameJsonRepairContext;
}): Promise<Record<string, unknown>> {
  if (!input.connectionId) return input.fallback;
  const raw = await llmApi.complete({
    connectionId: input.connectionId,
    messages: [
      { role: "system", content: input.system },
      { role: "user", content: input.user },
    ],
    parameters: input.parameters,
  });
  const parsed = parseJsonObject(raw);
  if (parsed) return parsed;
  if (input.repair) {
    throw new ApiError("The model returned JSON that needs review before it can be applied.", 422, {
      jsonRepair: {
        kind: input.repair.kind,
        title: input.repair.title,
        rawJson: raw,
        applyEndpoint: `local://game/${input.repair.kind}`,
        applyBody: input.repair.applyBody,
      },
    });
  }
  throw new Error("The model returned JSON that could not be parsed.");
}

export async function sessionTranscript(chatId: string, limit = 80): Promise<string> {
  const messages = await listMessages(chatId, limit);
  return messages
    .map((message) => `${message.role ?? "message"}: ${message.content ?? ""}`)
    .filter((line) => line.trim())
    .join("\n");
}

export type {
  Chat,
  Lorebook,
  LorebookEntry,
  CombatInitState,
  CombatMechanic,
  EncounterSettings,
  AgentDebugEntry,
  Combatant,
  CombatPlayerAction,
  GameActiveState,
  GameCheckpoint,
  GameMap,
  GameNpc,
  GameSetupConfig,
  HudWidget,
  PartyArc,
  SessionSummary,
  SkillCheckResult,
  RPGAttributes,
  JsonRepairRequest,
  ImageStyleProfileSettings,
  ImagePromptOverrideContext,
  PromptOverrideKeyDef,
  MoraleEvent,
  GameTime,
  Season,
  WeatherState,
  CharacterSpriteSubject,
  LootDrop,
  Journal,
};

export {
  ApiError,
  isJsonRepairApiError,
  gameAssetsApi,
  imageGenerationApi,
  spriteApi,
  spotifyApi,
  llmApi,
  chatCommandApi,
  resolveGalleryFileUrl,
  storageApi,
  urlBinaryApi,
  visualAssetsApi,
  createLorebookEntrySchema,
  createLorebookSchema,
  updateLorebookEntrySchema,
  resolveCombatRound,
  initGameCombatEncounter,
  rollGameDice,
  rollGameEncounter,
  rollEnemyCount,
  generateCombatLoot,
  generateLootTable,
  processReputationActions,
  getGoverningAttribute,
  mapSheetAttributesToRPG,
  resolveSkillCheck,
  serializeResolvedSkillCheckTag,
  applyMoraleEvent,
  getMoraleTier,
  getElementPreset,
  listElementPresets,
  buildPartySystemPrompt,
  buildPartyRecruitCardPrompt,
  buildSessionConclusionPrompt,
  buildSetupPrompt,
  loadCharacterSprites,
  GAME_BACKGROUND_PROMPT_OVERRIDE,
  GAME_ILLUSTRATION_PROMPT_OVERRIDE,
  GAME_PORTRAIT_PROMPT_OVERRIDE,
  loadRegisteredPrompt,
  dedupeSessionSummaryLists,
  buildRecapPrompt,
  buildSessionCarryoverContext,
  validateTransition,
  applyJournalEntry,
  buildDeterministicSummary,
  buildStructuredRecap,
  createJournal,
  syncJournalFromGameState,
  buildMapGenerationPrompt,
  withActiveGameMapMeta,
  createInitialTime,
  formatGameTime,
  advanceGameTime,
  isTimeOfDayLabel,
  setTimeOfDay,
  generateWeather,
  inferBiome,
  clonePlayerStats,
  parsePartyDialogue,
  compiledSceneAssetNegativePrompt,
  gameImageGenerationRequest,
  sceneAssetPrompt,
};
