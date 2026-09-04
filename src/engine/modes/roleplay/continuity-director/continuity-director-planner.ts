import { z } from "zod";

import type { LlmGateway } from "../../../capabilities/llm";
import type { StorageGateway } from "../../../capabilities/storage";
import type { RoleplayContinuityDirectorState } from "../../../contracts/types/roleplay-continuity-director";
import { parseRecord, readString, type JsonRecord } from "../../../generation/runtime-records";
import { generateStructured } from "../../../generation/structured-generation";
import { validateContinuityDirectorBeat, validateContinuityDirectorText } from "./continuity-director-safety";
import { loadContinuityDirectorSource, type ContinuityDirectorSource } from "./continuity-director-source";
import {
  applyContinuityDirectorCommand,
  CONTINUITY_DIRECTOR_LIMITS,
  normalizeContinuityDirectorState,
  recordContinuityDirectorPlanningAttempt,
} from "./continuity-director-state";

const DIRECTOR_METADATA_KEY = "roleplayContinuityDirector";

const candidateSchema = z
  .object({
    currentArc: z.string().max(600).nullable(),
    openThreads: z.array(z.string().min(1).max(280)).max(12),
    beats: z.array(z.string().min(1).max(280)).max(8),
  })
  .strict();

const rerollCandidateSchema = z
  .object({
    replacementBeat: z.string().min(1).max(280),
  })
  .strict();

export type ContinuityDirectorPlannerErrorCode =
  | "disabled"
  | "connection_unavailable"
  | "invalid_output"
  | "timeout"
  | "source_unavailable"
  | "persistence_failed";

export type ContinuityDirectorPlannerResult =
  | { ok: true; state: RoleplayContinuityDirectorState; rejectedUnsafeBeats: number }
  | { ok: false; code: ContinuityDirectorPlannerErrorCode; message: string };

export interface ContinuityDirectorPlannerCapabilities {
  storage: StorageGateway;
  llm: LlmGateway;
}

export interface ContinuityDirectorPlannerInput {
  chatId: string;
  rerollBeatId?: string;
  /** Exact post-apply state that a detached, one-use initial plan is authorized to replace. */
  initialExpectedDirectorState?: RoleplayContinuityDirectorState;
  timeoutMs?: number;
  now?: () => string;
  createId?: (prefix: string) => string;
}

interface PendingPlannerRequest {
  operationKey: string;
  promise: Promise<ContinuityDirectorPlannerResult>;
}

const pendingRefreshes = new WeakMap<StorageGateway, Map<string, PendingPlannerRequest>>();

function stateFromChat(chat: JsonRecord, now: string): RoleplayContinuityDirectorState {
  return normalizeContinuityDirectorState(directorValueFromChat(chat), now);
}

function directorValueFromChat(chat: JsonRecord): unknown {
  return parseRecord(chat.metadata)[DIRECTOR_METADATA_KEY] ?? null;
}

function samePlanningAuthorization(
  authorized: RoleplayContinuityDirectorState,
  current: RoleplayContinuityDirectorState,
): boolean {
  return JSON.stringify(current) === JSON.stringify(authorized);
}

async function persistDirectorIfUnchanged(
  storage: StorageGateway,
  chatId: string,
  expectedValue: unknown,
  value: RoleplayContinuityDirectorState,
): Promise<{ updated: boolean; currentValue: unknown }> {
  const updateChatIfUnchanged = storage.updateChatIfUnchanged;
  if (!updateChatIfUnchanged) {
    throw new Error("Conditional chat persistence is unavailable.");
  }
  const result = (await updateChatIfUnchanged.call(
    storage,
    chatId,
    { metadata: { [DIRECTOR_METADATA_KEY]: expectedValue } },
    { metadata: { [DIRECTOR_METADATA_KEY]: value } },
  )) as { updated: boolean; chat: JsonRecord };
  return { updated: result.updated, currentValue: directorValueFromChat(result.chat) };
}

function planningSystemPrompt(source: ContinuityDirectorSource): string {
  const personas = source.personaNames.length > 0 ? source.personaNames.join(", ") : "the user persona";
  return [
    "You are De-Koi's visible Roleplay Continuity Director.",
    "Propose compact story structure, not prose. Return only the requested JSON object.",
    `Never prescribe ${personas}'s dialogue, deliberate actions, beliefs, intent, decisions, or strategy.`,
    "Leave the user's response open. External pressure and other characters' actions are allowed.",
    "Treat story projections as narrative context and knowledge edges as constraints on who knows or suspects what.",
    "Do not invent approval state, IDs, timestamps, canonical memories, lorebook edits, card edits, tracker edits, or chat text.",
  ].join("\n");
}

function planningInput(
  source: ContinuityDirectorSource,
  rerollTarget?: { id: string; text: string },
): string {
  return JSON.stringify(
    {
      task: rerollTarget
        ? "Replace exactly the requested beat with one different structural beat."
        : "Propose the current arc, open threads, and up to eight next structural beats.",
      outputShape: rerollTarget
        ? { replacementBeat: "string" }
        : { currentArc: "string or null", openThreads: ["string"], beats: ["string"] },
      ...(rerollTarget
        ? {
            rerollTarget: {
              beatId: rerollTarget.id,
              text: rerollTarget.text,
            },
            rerollRules: [
              "Return exactly one replacementBeat for this target.",
              "Do not rewrite, repeat, or refer to sibling beats.",
            ],
          }
        : {}),
      characters: source.characterNames,
      userPersonas: source.personaNames,
      story: source.story,
      knowledgeConstraints: source.knowledge,
      recentTranscript: source.transcript,
    },
    null,
    2,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runRefresh(
  capabilities: ContinuityDirectorPlannerCapabilities,
  input: ContinuityDirectorPlannerInput,
): Promise<ContinuityDirectorPlannerResult> {
  const now = input.now?.() ?? new Date().toISOString();
  let source: ContinuityDirectorSource;
  try {
    source = await loadContinuityDirectorSource(capabilities.storage, input.chatId, { now: input.now });
  } catch (error) {
    return { ok: false, code: "source_unavailable", message: errorMessage(error) };
  }

  const initialExpectedState = input.initialExpectedDirectorState;
  const initialState = initialExpectedState
    ? normalizeContinuityDirectorState(initialExpectedState, now)
    : stateFromChat(source.chat, now);
  if (!initialState.enabled) {
    return { ok: false, code: "disabled", message: "Enable Continuity Director before refreshing its plan." };
  }

  if (initialExpectedState) {
    const expectedStateIsUnplanned =
      initialExpectedState.enabled &&
      initialExpectedState.sourceSnapshot === null &&
      initialExpectedState.currentArc === null &&
      initialExpectedState.openThreads.length === 0 &&
      initialExpectedState.beats.length === 0;
    if (!expectedStateIsUnplanned) {
      return {
        ok: false,
        code: "persistence_failed",
        message: "The initial Continuity Director plan is no longer authorized for this chat state.",
      };
    }
  }

  const targetBeatId = input.rerollBeatId?.trim() || null;
  const rerollTarget = targetBeatId ? initialState.beats.find((beat) => beat.id === targetBeatId) : undefined;
  if (targetBeatId && !rerollTarget) {
    return { ok: false, code: "persistence_failed", message: "The requested beat is no longer available." };
  }

  const connectionId = initialState.connectionId ?? source.writerConnectionId;
  if (initialState.connectionId) {
    const explicitConnection = await capabilities.storage
      .get<JsonRecord>("connections", initialState.connectionId)
      .catch(() => null);
    if (!explicitConnection) {
      return {
        ok: false,
        code: "connection_unavailable",
        message: "The selected Continuity Director connection is unavailable.",
      };
    }
  }

  const attemptedState = recordContinuityDirectorPlanningAttempt(
    initialState,
    source.sourceSnapshot.visibleAssistantTurnCount ?? 0,
    { now: input.now },
  );
  try {
    const attemptWrite = await persistDirectorIfUnchanged(
      capabilities.storage,
      input.chatId,
      initialExpectedState ?? directorValueFromChat(source.chat),
      attemptedState,
    );
    if (!attemptWrite.updated) {
      const currentState = normalizeContinuityDirectorState(attemptWrite.currentValue, now);
      if (!currentState.enabled) {
        return { ok: false, code: "disabled", message: "Continuity Director was disabled before refresh began." };
      }
      return {
        ok: false,
        code: "persistence_failed",
        message: "Continuity Director changed before the planning attempt could begin.",
      };
    }
  } catch (error) {
    return { ok: false, code: "persistence_failed", message: errorMessage(error) };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, input.timeoutMs ?? 30_000));
  let candidate: z.infer<typeof candidateSchema>;
  try {
    if (rerollTarget) {
      const generated = await generateStructured(
        { llm: capabilities.llm },
        {
          taskName: "roleplay-continuity-director-reroll",
          connectionId,
          messages: [
            { role: "system", content: planningSystemPrompt(source) },
            { role: "user", content: planningInput(source, rerollTarget) },
          ],
          parameters: { temperature: 0.2, max_tokens: 900 },
          schema: rerollCandidateSchema,
          schemaDescription: '{"replacementBeat":"string"}',
          maxRepairAttempts: 0,
          failureMessage: "Continuity Director did not return one valid replacement beat.",
        },
        controller.signal,
      );
      if (!generated.ok) {
        return { ok: false, code: "invalid_output", message: generated.failure.message };
      }
      candidate = { currentArc: null, openThreads: [], beats: [generated.data.replacementBeat] };
    } else {
      const generated = await generateStructured(
        { llm: capabilities.llm },
        {
          taskName: "roleplay-continuity-director",
          connectionId,
          messages: [
            { role: "system", content: planningSystemPrompt(source) },
            { role: "user", content: planningInput(source) },
          ],
          parameters: { temperature: 0.2, max_tokens: 900 },
          schema: candidateSchema,
          schemaDescription: '{"currentArc":"string or null","openThreads":["string"],"beats":["string"]}',
          maxRepairAttempts: 0,
          failureMessage: "Continuity Director did not return a valid plan.",
        },
        controller.signal,
      );
      if (!generated.ok) {
        return { ok: false, code: "invalid_output", message: generated.failure.message };
      }
      candidate = generated.data;
      if (candidate.currentArc === null && candidate.openThreads.length === 0 && candidate.beats.length === 0) {
        return {
          ok: false,
          code: "invalid_output",
          message: "Continuity Director returned an empty plan.",
        };
      }
    }
  } catch (error) {
    const timedOut = controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError");
    return {
      ok: false,
      code: timedOut ? "timeout" : "invalid_output",
      message: timedOut ? "Continuity Director timed out." : errorMessage(error),
    };
  } finally {
    clearTimeout(timeout);
  }

  const safeBeats = candidate.beats.filter(
    (beat) => validateContinuityDirectorBeat(beat, { personaNames: source.personaNames }).safe,
  );
  const rejectedUnsafeBeats = candidate.beats.length - safeBeats.length;
  const unsafeArc =
    !rerollTarget &&
    candidate.currentArc !== null &&
    !validateContinuityDirectorText(candidate.currentArc, {
      personaNames: source.personaNames,
      maxCharacters: CONTINUITY_DIRECTOR_LIMITS.arcCharacters,
    }).safe;
  const unsafeThread =
    !rerollTarget &&
    candidate.openThreads.some(
      (thread) => !validateContinuityDirectorText(thread, { personaNames: source.personaNames }).safe,
    );
  const allCandidateBeatsUnsafe = candidate.beats.length > 0 && safeBeats.length === 0;
  if (unsafeArc || unsafeThread || allCandidateBeatsUnsafe) {
    return {
      ok: false,
      code: "invalid_output",
      message: "Continuity Director returned a plan that could not be stored safely.",
    };
  }

  try {
    const currentChat = await capabilities.storage.get<JsonRecord>("chats", input.chatId);
    if (!currentChat) throw new Error("Chat not found while saving the plan.");
    const currentState = stateFromChat(currentChat, input.now?.() ?? new Date().toISOString());
    if (!currentState.enabled) {
      return { ok: false, code: "disabled", message: "Continuity Director was disabled before refresh completed." };
    }
    if (!samePlanningAuthorization(attemptedState, currentState)) {
      return {
        ok: false,
        code: "persistence_failed",
        message: "Continuity Director settings or source changed before refresh completed.",
      };
    }
    if (targetBeatId && !currentState.beats.some((beat) => beat.id === targetBeatId)) {
      return { ok: false, code: "persistence_failed", message: "The beat changed before reroll completed." };
    }
    if (targetBeatId && safeBeats.length === 0) {
      return {
        ok: false,
        code: "invalid_output",
        message: "Continuity Director did not return a safe replacement beat.",
      };
    }
    const updatedState = targetBeatId
      ? applyContinuityDirectorCommand(
          currentState,
          { type: "reroll_beat", beatId: targetBeatId, replacementText: safeBeats[0]! },
          { now: input.now, createId: input.createId },
        )
      : applyContinuityDirectorCommand(
          currentState,
          {
            type: "replace_director_proposals",
            arc: candidate.currentArc,
            threads: candidate.openThreads,
            beats: safeBeats,
            sourceSnapshot: source.sourceSnapshot,
          },
          { now: input.now, createId: input.createId },
        );
    const nextState = targetBeatId ? { ...updatedState, sourceSnapshot: source.sourceSnapshot } : updatedState;
    const persisted = await persistDirectorIfUnchanged(
      capabilities.storage,
      input.chatId,
      directorValueFromChat(currentChat),
      nextState,
    );
    if (!persisted.updated) {
      const winningState = normalizeContinuityDirectorState(persisted.currentValue, now);
      if (!winningState.enabled) {
        return { ok: false, code: "disabled", message: "Continuity Director was disabled before refresh completed." };
      }
      return {
        ok: false,
        code: "persistence_failed",
        message: "Continuity Director changed before the plan could be saved.",
      };
    }
    return { ok: true, state: nextState, rejectedUnsafeBeats };
  } catch (error) {
    return { ok: false, code: "persistence_failed", message: errorMessage(error) };
  }
}

export function refreshContinuityDirectorPlan(
  capabilities: ContinuityDirectorPlannerCapabilities,
  input: ContinuityDirectorPlannerInput,
): Promise<ContinuityDirectorPlannerResult> {
  const chatId = readString(input.chatId).trim();
  const operationKey = input.rerollBeatId?.trim()
    ? `reroll:${input.rerollBeatId.trim()}`
    : input.initialExpectedDirectorState
      ? `initial:${JSON.stringify(input.initialExpectedDirectorState)}`
      : "refresh";
  const pendingByChat = pendingRefreshes.get(capabilities.storage) ?? new Map<string, PendingPlannerRequest>();
  pendingRefreshes.set(capabilities.storage, pendingByChat);
  const existing = pendingByChat.get(chatId);
  if (existing) {
    if (existing.operationKey === operationKey) return existing.promise;
    return existing.promise.then(() => refreshContinuityDirectorPlan(capabilities, input));
  }
  const refresh = runRefresh(capabilities, { ...input, chatId }).finally(() => {
    if (pendingByChat.get(chatId)?.promise === refresh) pendingByChat.delete(chatId);
    if (pendingByChat.size === 0) pendingRefreshes.delete(capabilities.storage);
  });
  pendingByChat.set(chatId, { operationKey, promise: refresh });
  return refresh;
}
