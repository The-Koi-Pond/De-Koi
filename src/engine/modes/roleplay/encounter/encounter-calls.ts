// The three encounter model calls (setup, turn, summary). All of them go through `requestEncounterText`, the one
// place that picks a connection, so routing encounters to a helper model later only changes that function.
// Behavior spec: docs/provenance/roleplay-encounters.md ("Model calls").
import type { LlmGateway, LlmMessage } from "../../../capabilities/llm";
import type { StorageGateway } from "../../../capabilities/storage";
import type { AgentContext } from "../../../contracts/types/agent";
import { requireRecord, resolveGenerationConnection } from "../../../generation/context";
import { readString, type JsonRecord } from "../../../generation/runtime-records";
import { extractLeadingThinkingBlocks } from "../../../generation-core/llm/inline-thinking";
import { userFacingError } from "../../../shared/user-facing-error";
import {
  loadEncounterCast,
  loadEncounterHistory,
  loadEncounterSpellbook,
  loadEncounterTracked,
} from "./encounter-context";
import { buildSetupMessages, buildSummaryMessages, buildTurnMessages } from "./encounter-prompts";
import { encounterSetupGaps, readSetupResponse, readTurnResponse } from "./encounter-rules";
import type {
  EncounterCallKind,
  EncounterFight,
  EncounterResult,
  EncounterRound,
  EncounterSettings,
  EncounterTurnOutcome,
} from "./encounter-types";

export interface EncounterCapabilities {
  storage: StorageGateway;
  llm: LlmGateway;
}

export type EncounterDebugSink = NonNullable<AgentContext["debugSink"]>;

export interface EncounterCallParameters {
  temperature: number;
  maxTokens: number;
}

export const ENCOUNTER_CALL_PARAMETERS: Record<EncounterCallKind, EncounterCallParameters> = {
  setup: { temperature: 0.8, maxTokens: 12_000 },
  turn: { temperature: 0.8, maxTokens: 8_192 },
  summary: { temperature: 0.9, maxTokens: 8_192 },
};

export const ENCOUNTER_SETUP_INVALID_MESSAGE = "The AI could not create a valid combat encounter. Try again.";
export const ENCOUNTER_TURN_INVALID_MESSAGE = "AI returned an invalid response. Try again.";

export interface EncounterModelRequest {
  kind: EncounterCallKind;
  chat: JsonRecord;
  messages: LlmMessage[];
  parameters: EncounterCallParameters;
  signal: AbortSignal;
}

const NO_CONNECTION_MESSAGE = "This chat has no model connection. Pick one in Chat Settings or add one in Connections.";
const EMPTY_RANDOM_POOL_MESSAGE =
  "No connections are in the random pool. Add one in Connections or pick one in Chat Settings.";

// What `resolveGenerationConnection` throws when there's no connection to use: none at all, the chat's one deleted,
// or an empty random pool. Its plain-text errors carry no code, so they're matched by their exact wording.
const RESOLVER_MISSING_CONNECTION: Record<string, string> = {
  "API connection was not found": NO_CONNECTION_MESSAGE,
  "Chat connection was not found": NO_CONNECTION_MESSAGE,
  "No connections are marked for the random pool": EMPTY_RANDOM_POOL_MESSAGE,
};

async function encounterConnectionId(storage: StorageGateway, chat: JsonRecord): Promise<string> {
  let connection: JsonRecord;
  try {
    connection = await resolveGenerationConnection(storage, chat, { connectionId: null });
  } catch (error) {
    const missing = error instanceof Error ? RESOLVER_MISSING_CONNECTION[error.message] : undefined;
    // Anything else (a storage or server failure) keeps its own message (decision 10).
    if (!missing) throw error;
    throw userFacingError(missing);
  }
  const connectionId = readString(connection.id).trim();
  if (!connectionId) throw userFacingError(NO_CONNECTION_MESSAGE);
  return connectionId;
}

/**
 * Every encounter model call: the chat's connection (no override; the Combat agent's own setting isn't used), the
 * call's parameters, and the caller's abort signal. A call cancelled while the model was answering throws instead of
 * returning, so a late answer can't reach the chat.
 */
export async function requestEncounterText(
  capabilities: EncounterCapabilities,
  request: EncounterModelRequest,
): Promise<string> {
  const connectionId = await encounterConnectionId(capabilities.storage, request.chat);
  request.signal.throwIfAborted();
  const text = await capabilities.llm.complete(
    { connectionId, messages: request.messages, parameters: { ...request.parameters } },
    request.signal,
  );
  request.signal.throwIfAborted();
  return text;
}

async function loadChat(storage: StorageGateway, chatId: string): Promise<JsonRecord> {
  return requireRecord(await storage.get<unknown>("chats", chatId), "Chat");
}

function emitSetupDebug(sink: EncounterDebugSink | undefined, step: string, details: Record<string, unknown>) {
  sink?.({
    level: "debug",
    phase: "roleplay-encounter-init",
    message: `[debug/roleplay/encounter:init] ${step}`,
    args: [details],
    timestamp: Date.now(),
  });
}

export interface EncounterStartInput {
  chatId: string;
  settings: EncounterSettings;
  signal: AbortSignal;
  /** Given only while the app's debug mode is on. */
  debugSink?: EncounterDebugSink;
}

export async function startEncounterFight(
  capabilities: EncounterCapabilities,
  input: EncounterStartInput,
): Promise<EncounterFight> {
  const { storage } = capabilities;
  const chat = await loadChat(storage, input.chatId);
  const [cast, tracked, spellbook, history] = await Promise.all([
    loadEncounterCast(storage, chat),
    loadEncounterTracked(storage, input.chatId),
    loadEncounterSpellbook(storage, input.settings.spellbookId),
    loadEncounterHistory(storage, input.chatId, input.settings.historyDepth),
  ]);
  const messages = buildSetupMessages({ cast, tracked, spellbook, history });
  emitSetupDebug(input.debugSink, "request", {
    chatId: input.chatId,
    connectionOverride: null,
    historyCount: history.length,
    settings: input.settings,
    messages,
  });
  const raw = await requestEncounterText(capabilities, {
    kind: "setup",
    chat,
    messages,
    parameters: ENCOUNTER_CALL_PARAMETERS.setup,
    signal: input.signal,
  });
  emitSetupDebug(input.debugSink, "raw response", { chatId: input.chatId, length: raw.length, raw });
  const fight = readSetupResponse(raw, encounterSetupGaps(cast, tracked, spellbook));
  if (!fight) throw userFacingError(ENCOUNTER_SETUP_INVALID_MESSAGE);
  emitSetupDebug(input.debugSink, "parsed response", { chatId: input.chatId, fight });
  return fight;
}

export interface EncounterTurnInput {
  chatId: string;
  settings: EncounterSettings;
  fight: EncounterFight;
  rounds: EncounterRound[];
  action: string;
  signal: AbortSignal;
}

export async function resolveEncounterTurn(
  capabilities: EncounterCapabilities,
  input: EncounterTurnInput,
): Promise<EncounterTurnOutcome> {
  const { storage } = capabilities;
  const chat = await loadChat(storage, input.chatId);
  const [cast, spellbook, history] = await Promise.all([
    loadEncounterCast(storage, chat),
    loadEncounterSpellbook(storage, input.settings.spellbookId),
    loadEncounterHistory(storage, input.chatId, input.settings.historyDepth),
  ]);
  const messages = buildTurnMessages({
    cast,
    spellbook,
    history,
    rounds: input.rounds,
    fight: input.fight,
    action: input.action,
    style: input.settings.combatNarration,
  });
  const raw = await requestEncounterText(capabilities, {
    kind: "turn",
    chat,
    messages,
    parameters: ENCOUNTER_CALL_PARAMETERS.turn,
    signal: input.signal,
  });
  const outcome = readTurnResponse(raw, input.fight, input.action);
  if (!outcome) throw userFacingError(ENCOUNTER_TURN_INVALID_MESSAGE);
  return outcome;
}

const FIGHT_CONCLUDED_MARKER = /\[\s*FIGHT CONCLUDED\s*\]/gi;

function cleanSummary(raw: string): string {
  return extractLeadingThinkingBlocks(raw).cleanText.replace(FIGHT_CONCLUDED_MARKER, "").trim();
}

export interface EncounterSummaryInput {
  chatId: string;
  settings: EncounterSettings;
  result: EncounterResult;
  rounds: EncounterRound[];
  signal: AbortSignal;
  /** Called once the message is being saved: from then on the summary counts as written, even if the call is left. */
  onSaveStart: () => void;
}

/** Writes the fight's summary as one assistant message, the only change an encounter makes to its chat. */
export async function writeEncounterSummary(
  capabilities: EncounterCapabilities,
  input: EncounterSummaryInput,
): Promise<string> {
  const { storage } = capabilities;
  const chat = await loadChat(storage, input.chatId);
  const cast = await loadEncounterCast(storage, chat);
  const messages = buildSummaryMessages({
    cast,
    result: input.result,
    rounds: input.rounds,
    style: input.settings.summaryNarration,
  });
  const raw = await requestEncounterText(capabilities, {
    kind: "summary",
    chat,
    messages,
    parameters: ENCOUNTER_CALL_PARAMETERS.summary,
    signal: input.signal,
  });
  const summary = cleanSummary(raw);
  if (!summary) throw userFacingError("The model returned an empty combat summary. Try again.");
  input.onSaveStart();
  await storage.createChatMessage(input.chatId, { role: "assistant", characterId: null, content: summary });
  return summary;
}
