import { z } from "zod";

import type { LlmGateway } from "../../../capabilities/llm";
import type { StorageGateway } from "../../../capabilities/storage";
import type { RoleplayWorldTickState, WorldTickCommand } from "../../../contracts/types/roleplay-world-tick";
import { parseRecord, readString, type JsonRecord } from "../../../generation/runtime-records";
import { generateStructured } from "../../../generation/structured-generation";
import { validateContinuityDirectorText } from "../continuity-director/continuity-director-safety";
import {
  loadContinuityDirectorSource,
  type ContinuityDirectorSource,
} from "../continuity-director/continuity-director-source";
import {
  applyWorldTickCommand,
  assertWorldTickReviewed,
  cleanWorldTickText,
  completePendingWorldTick,
  fitWorldTickEventText,
  normalizeWorldTickState,
  startPendingWorldTick,
  WORLD_TICK_LIMITS,
  WORLD_TICK_METADATA_KEY,
  worldTickMessageId,
  worldTickNarration,
  WorldTickStateError,
  type WorldTickStateOptions,
} from "./world-tick-state";

export type WorldTickErrorCode =
  | "chat_not_found"
  | "not_roleplay"
  | "stale_revision"
  | "pending_exists"
  | "no_pending"
  | "unreviewed_events"
  | "invalid_input"
  | "connection_unavailable"
  | "invalid_output"
  /** The model call itself failed (provider down, not signed in, rate limited); the message says why. */
  | "model_failed"
  | "timeout"
  | "source_unavailable"
  | "persistence_failed";

export class WorldTickError extends Error {
  constructor(
    public readonly code: WorldTickErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WorldTickError";
  }
}

export interface WorldTickCapabilities {
  storage: StorageGateway;
  llm: LlmGateway;
}

export interface WorldTickServiceOptions extends WorldTickStateOptions {
  timeoutMs?: number;
  loadSource?: typeof loadContinuityDirectorSource;
}

// Lenient on purpose: an extra field, a sixth event or one long sentence shouldn't throw away the
// whole round. Counts and lengths are trimmed when the review opens.
const proposalSchema = z.object({
  events: z.array(
    z.object({
      text: z.string().min(1).max(2000),
      characters: z.array(z.string()).default([]),
    }),
  ),
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function rawState(chat: JsonRecord): unknown {
  return parseRecord(chat.metadata)[WORLD_TICK_METADATA_KEY] ?? null;
}

function stateOf(chat: JsonRecord, now: string): RoleplayWorldTickState {
  return normalizeWorldTickState(rawState(chat), now);
}

async function loadChat(storage: StorageGateway, chatId: string): Promise<JsonRecord> {
  let chat: JsonRecord | null;
  try {
    chat = await storage.get<JsonRecord>("chats", chatId);
  } catch (error) {
    throw new WorldTickError("source_unavailable", errorMessage(error));
  }
  if (!chat) throw new WorldTickError("chat_not_found", "This chat no longer exists.");
  if (readString(chat.mode).trim() !== "roleplay") {
    throw new WorldTickError("not_roleplay", "Letting time pass is only available in Roleplay chats.");
  }
  return chat;
}

/** Saves the next state only if nobody changed the stored one since it was read. */
async function persistIfUnchanged(
  storage: StorageGateway,
  chatId: string,
  expectedRaw: unknown,
  next: RoleplayWorldTickState,
): Promise<{ updated: boolean; chat: JsonRecord }> {
  const updateChatIfUnchanged = storage.updateChatIfUnchanged;
  if (!updateChatIfUnchanged) {
    throw new WorldTickError("persistence_failed", "This runtime can't save time skips safely.");
  }
  try {
    return (await updateChatIfUnchanged.call(
      storage,
      chatId,
      { metadata: { [WORLD_TICK_METADATA_KEY]: expectedRaw } },
      { metadata: { [WORLD_TICK_METADATA_KEY]: next } },
    )) as { updated: boolean; chat: JsonRecord };
  } catch (error) {
    throw new WorldTickError("persistence_failed", errorMessage(error));
  }
}

function staleError(): WorldTickError {
  return new WorldTickError("stale_revision", "This time skip changed in another window. Reload it and try again.");
}

function fromStateError(error: unknown): never {
  if (error instanceof WorldTickStateError) {
    const code: WorldTickErrorCode =
      error.code === "unreviewed_events"
        ? "unreviewed_events"
        : error.code === "no_pending"
          ? "no_pending"
          : error.code === "not_found"
            ? "stale_revision"
            : "invalid_input";
    throw new WorldTickError(code, error.message);
  }
  throw error;
}

export async function getWorldTickState(
  storage: StorageGateway,
  chatId: string,
  options: WorldTickStateOptions = {},
): Promise<RoleplayWorldTickState> {
  const chat = await loadChat(storage, chatId);
  return stateOf(chat, options.now?.() ?? new Date().toISOString());
}

export async function commandWorldTick(
  storage: StorageGateway,
  chatId: string,
  command: WorldTickCommand,
  expectedRevision: number | undefined,
  options: WorldTickStateOptions = {},
): Promise<RoleplayWorldTickState> {
  const now = options.now?.() ?? new Date().toISOString();
  const chat = await loadChat(storage, chatId);
  const current = stateOf(chat, now);
  if (expectedRevision !== undefined && current.revision !== expectedRevision) throw staleError();
  let next: RoleplayWorldTickState;
  try {
    next = applyWorldTickCommand(current, command, options);
  } catch (error) {
    fromStateError(error);
  }
  const result = await persistIfUnchanged(storage, chatId, rawState(chat), next);
  if (!result.updated) throw staleError();
  if (command.type === "discard_pending" && current.pending) {
    // An apply that was cut off after writing its message (tab closed) leaves that message behind.
    await removeNarrationIfPresent(storage, worldTickMessageId(current.pending.id));
  }
  return stateOf(result.chat, now);
}

async function removeNarrationIfPresent(storage: StorageGateway, messageId: string): Promise<void> {
  try {
    if (await storage.getChatMessage(messageId)) await storage.deleteChatMessage(messageId);
  } catch (error) {
    throw new WorldTickError(
      "persistence_failed",
      `The time skip was discarded, but its unfinished chat message couldn't be removed: ${errorMessage(error)} Delete it from the chat by hand.`,
    );
  }
}

function proposerSystemPrompt(source: ContinuityDirectorSource): string {
  const personas = source.personaNames.length > 0 ? source.personaNames.join(", ") : "the user's character";
  return [
    "You are De-Koi's off-screen world for a Roleplay chat. Time is about to pass in the story.",
    "Propose what plausibly happens in the world and to the other characters while it passes.",
    "Each event is one plain sentence of past-tense fact, not prose and not dialogue.",
    "Prefer consequences of what is already in motion: open threads, promises, plans, threats, schedules, weather, travel.",
    "Small and specific beats big and dramatic. It is fine to propose fewer events, or none, when little would change.",
    `Never decide anything for ${personas}: no dialogue, actions, choices, feelings, beliefs or plans of theirs, and do not resolve a choice they still face.`,
    "Do not kill, permanently injure or remove a main character, and do not reveal secrets a character couldn't know.",
    "Return only the requested JSON object.",
  ].join("\n");
}

function proposerInput(
  source: ContinuityDirectorSource,
  input: { elapsed: string; guidance: string; world: JsonRecord | null; deferred: string[] },
): string {
  const world = input.world
    ? Object.fromEntries(
        (["date", "time", "location", "weather"] as const)
          .map((field) => [field, readString(input.world?.[field]).trim()] as const)
          .filter(([, value]) => value),
      )
    : {};
  return JSON.stringify(
    {
      task: `Time passes: ${input.elapsed}. Propose up to ${WORLD_TICK_LIMITS.proposedEventsPerTick} off-screen events.`,
      outputShape: { events: [{ text: "string", characters: ["names involved"] }] },
      ...(input.guidance ? { userGuidance: input.guidance } : {}),
      ...(input.deferred.length ? { alreadyPending: input.deferred, alreadyPendingRule: "Do not repeat these." } : {}),
      currentWorld: world,
      characters: source.characterNames,
      userCharacter: source.personaNames,
      story: source.story,
      knowledgeConstraints: source.knowledge,
      recentTranscript: source.transcript,
    },
    null,
    2,
  );
}

export interface ProposeWorldTickInput {
  chatId: string;
  elapsed: string;
  guidance?: string;
  /** Replace a tick that is already waiting for review instead of failing. */
  replacePending?: boolean;
}

export interface ProposeWorldTickResult {
  state: RoleplayWorldTickState;
  /** Model events dropped because they decided something for the user's character. */
  rejectedUnsafeEvents: number;
}

/**
 * Asks the chat's model what happens off-screen while the requested time passes and opens the
 * proposals for review. Nothing reaches the chat or any prompt until the user applies the tick.
 */
export async function proposeWorldTick(
  capabilities: WorldTickCapabilities,
  input: ProposeWorldTickInput,
  options: WorldTickServiceOptions = {},
): Promise<ProposeWorldTickResult> {
  const now = options.now?.() ?? new Date().toISOString();
  const elapsed = cleanWorldTickText(input.elapsed, WORLD_TICK_LIMITS.elapsedCharacters);
  if (!elapsed) throw new WorldTickError("invalid_input", "Say how much time passes.");
  const guidance = cleanWorldTickText(input.guidance ?? "", WORLD_TICK_LIMITS.guidanceCharacters);

  const chat = await loadChat(capabilities.storage, input.chatId);
  const before = stateOf(chat, now);
  if (before.pending && !input.replacePending) {
    throw new WorldTickError("pending_exists", "A time skip is already waiting. Apply or discard it first.");
  }

  let source: ContinuityDirectorSource;
  try {
    source = await (options.loadSource ?? loadContinuityDirectorSource)(capabilities.storage, input.chatId, {
      now: options.now,
    });
  } catch (error) {
    throw new WorldTickError("source_unavailable", errorMessage(error));
  }
  const connectionId = source.writerConnectionId;
  if (!connectionId) {
    throw new WorldTickError("connection_unavailable", "This chat has no model connection. Pick one in Chat Settings.");
  }
  let world: JsonRecord | null;
  try {
    world = await capabilities.storage.getWorldState<JsonRecord>(input.chatId);
  } catch (error) {
    throw new WorldTickError("source_unavailable", `Couldn't read the chat's tracker: ${errorMessage(error)}`);
  }

  // A replaced review keeps what the user had put off, like a discard does.
  const base =
    before.pending && input.replacePending
      ? applyWorldTickCommand(before, { type: "discard_pending" }, options)
      : before;

  // The deadline is enforced here, not only through the abort signal: some model transports don't
  // honour it, and a late answer must not open a review the user already gave up on.
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => {
        controller.abort();
        reject(new WorldTickError("timeout", "The model took too long. Try again, or write your own events."));
      },
      Math.max(1, options.timeoutMs ?? 90_000),
    );
  });
  let proposals: Array<{ text: string; characters: string[] }>;
  try {
    const call = generateStructured(
      { llm: capabilities.llm },
      {
        taskName: "roleplay-world-tick",
        connectionId,
        messages: [
          { role: "system", content: proposerSystemPrompt(source) },
          {
            role: "user",
            content: proposerInput(source, {
              elapsed,
              guidance,
              world,
              deferred: base.deferred.map((event) => event.text),
            }),
          },
        ],
        parameters: { temperature: 0.7, max_tokens: 900 },
        schema: proposalSchema,
        schemaDescription: '{"events":[{"text":"string","characters":["string"]}]}',
        maxRepairAttempts: 1,
        failureMessage: "The model didn't return usable events. Try again, or write your own.",
      },
      controller.signal,
    );
    const generated = await Promise.race([call, deadline]);
    if (!generated.ok) throw new WorldTickError("invalid_output", generated.failure.message);
    proposals = generated.data.events.map((event) => ({
      text: fitWorldTickEventText(event.text),
      characters: event.characters ?? [],
    }));
  } catch (error) {
    if (error instanceof WorldTickError) throw error;
    if (controller.signal.aborted) {
      throw new WorldTickError("timeout", "The model took too long. Try again, or write your own events.");
    }
    throw new WorldTickError("model_failed", errorMessage(error));
  } finally {
    clearTimeout(timeout);
  }

  const safe = proposals.filter(
    (proposal) => validateContinuityDirectorText(proposal.text, { personaNames: source.personaNames }).safe,
  );
  const next = startPendingWorldTick(
    base,
    { elapsed, guidance, anchorMessageId: source.sourceSnapshot.lastMessageId, proposals: safe },
    options,
  );
  const result = await persistIfUnchanged(capabilities.storage, input.chatId, rawState(chat), next);
  if (!result.updated) throw staleError();
  return { state: stateOf(result.chat, now), rejectedUnsafeEvents: proposals.length - safe.length };
}

export interface ApplyWorldTickInput {
  chatId: string;
  tickId: string;
  expectedRevision?: number;
}

/**
 * Writes the accepted events into the chat as one narrator message, then records the tick.
 * Safe to retry: the message id is fixed per tick and the state change is conditional, so a
 * retry after a reload, a double click or a lost response never applies the tick twice. The
 * message goes first: if recording fails, the message this call wrote is removed again, so the
 * chat never shows a time skip the review still lists as open.
 */
export async function applyWorldTick(
  storage: StorageGateway,
  input: ApplyWorldTickInput,
  options: WorldTickStateOptions = {},
): Promise<RoleplayWorldTickState> {
  const now = options.now?.() ?? new Date().toISOString();
  const chat = await loadChat(storage, input.chatId);
  const current = stateOf(chat, now);
  const messageId = worldTickMessageId(input.tickId);

  if (current.timeline.some((tick) => tick.id === input.tickId)) return current;
  if (!current.pending || current.pending.id !== input.tickId) throw staleError();
  if (input.expectedRevision !== undefined && current.revision !== input.expectedRevision) throw staleError();
  const pending = current.pending;
  let next: RoleplayWorldTickState;
  try {
    assertWorldTickReviewed(pending);
    next = completePendingWorldTick(current, { tickId: pending.id, messageId }, options);
  } catch (error) {
    fromStateError(error);
  }
  const accepted = pending.events.filter((event) => event.status === "accepted");

  const createdMessage = await ensureNarration(storage, input.chatId, messageId, {
    tickId: pending.id,
    elapsed: pending.elapsed,
    events: accepted,
  });

  let result: { updated: boolean; chat: JsonRecord };
  try {
    result = await persistIfUnchanged(storage, input.chatId, rawState(chat), next);
  } catch (error) {
    if (createdMessage) await rollbackNarration(storage, messageId, error);
    throw error;
  }
  if (result.updated) return stateOf(result.chat, now);

  // Another window may have applied this same tick a moment ago; that counts as done.
  const winner = stateOf(result.chat, now);
  if (winner.timeline.some((tick) => tick.id === input.tickId)) return winner;
  const stale = staleError();
  if (createdMessage) await rollbackNarration(storage, messageId, stale);
  throw stale;
}

/** Removes a message this apply wrote before failing; if that fails too, the error says so. */
async function rollbackNarration(storage: StorageGateway, messageId: string, cause: unknown): Promise<void> {
  try {
    await storage.deleteChatMessage(messageId);
  } catch (error) {
    throw new WorldTickError(
      cause instanceof WorldTickError ? cause.code : "persistence_failed",
      `${errorMessage(cause)} Its chat message was already added and couldn't be removed (${errorMessage(error)}). Discard this time skip to clean it up.`,
    );
  }
}

/**
 * Writes the tick's narrator message. A message left by an apply that was cut off is rewritten when
 * the review changed since, so the chat always shows exactly the events being applied now. Returns
 * true when this call wrote the message (and so owns removing it if recording the tick fails).
 */
async function ensureNarration(
  storage: StorageGateway,
  chatId: string,
  messageId: string,
  tick: { tickId: string; elapsed: string; events: Array<{ id: string; text: string; source: string }> },
): Promise<boolean> {
  const content = worldTickNarration(
    tick.elapsed,
    tick.events.map((event) => event.text),
  );
  try {
    const existing = await storage.getChatMessage<JsonRecord>(messageId);
    if (existing && readString(existing.content) === content) return false;
    if (existing) await storage.deleteChatMessage(messageId);
    await storage.createChatMessage(chatId, {
      id: messageId,
      role: "narrator",
      characterId: null,
      content,
      extra: {
        worldTick: {
          tickId: tick.tickId,
          elapsed: tick.elapsed,
          eventIds: tick.events.map((event) => event.id),
          userEventIds: tick.events.filter((event) => event.source === "user").map((event) => event.id),
        },
      },
    });
    return true;
  } catch (error) {
    throw new WorldTickError("persistence_failed", `Couldn't add the time skip to the chat: ${errorMessage(error)}`);
  }
}
