import type { LlmGateway } from "../../engine/capabilities/llm";
import type { StorageGateway } from "../../engine/capabilities/storage";
import type {
  ContinuityDirectorCommand,
  RoleplayContinuityDirectorState,
} from "../../engine/contracts/types/roleplay-continuity-director";
import {
  refreshContinuityDirectorPlan,
  type ContinuityDirectorPlannerInput,
  type ContinuityDirectorPlannerResult,
} from "../../engine/modes/roleplay/continuity-director/continuity-director-planner";
import {
  loadContinuityDirectorSource,
  type ContinuityDirectorSource,
} from "../../engine/modes/roleplay/continuity-director/continuity-director-source";
import {
  applyContinuityDirectorCommand,
  normalizeContinuityDirectorState,
} from "../../engine/modes/roleplay/continuity-director/continuity-director-state";
import { parseRecord, type JsonRecord } from "../../engine/generation/runtime-records";
import { llmApi } from "./llm-api";
import { storageApi } from "./storage-api";
export { roleplayContinuityDirectorKeys } from "./roleplay-continuity-director-query-keys";

export type ContinuityDirectorApiErrorCode =
  | "chat_not_found"
  | "stale_revision"
  | "disabled"
  | "connection_unavailable"
  | "invalid_output"
  | "timeout"
  | "source_unavailable"
  | "persistence_failed";

export class ContinuityDirectorApiError extends Error {
  constructor(
    public readonly code: ContinuityDirectorApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ContinuityDirectorApiError";
  }
}

export interface ContinuityDirectorStateView {
  state: RoleplayContinuityDirectorState;
  isStale: boolean;
  sourceUnavailable: boolean;
}

export interface RoleplayContinuityDirectorApi {
  getState(chatId: string): Promise<ContinuityDirectorStateView>;
  command(
    chatId: string,
    command: ContinuityDirectorCommand,
    expectedRevision?: number,
  ): Promise<ContinuityDirectorStateView>;
  refresh(
    chatId: string,
    options?: { initialExpectedDirectorState?: RoleplayContinuityDirectorState },
  ): Promise<ContinuityDirectorStateView & { rejectedUnsafeBeats: number }>;
  reroll(chatId: string, beatId: string): Promise<ContinuityDirectorStateView & { rejectedUnsafeBeats: number }>;
}

interface ApiOptions {
  now?: () => string;
  createId?: (prefix: string) => string;
  loadSource?: typeof loadContinuityDirectorSource;
  refreshPlan?: (
    capabilities: { storage: StorageGateway; llm: LlmGateway },
    input: ContinuityDirectorPlannerInput,
  ) => Promise<ContinuityDirectorPlannerResult>;
}

function stateFromChat(chat: JsonRecord, now: string): RoleplayContinuityDirectorState {
  return normalizeContinuityDirectorState(parseRecord(chat.metadata).roleplayContinuityDirector, now);
}

function rawStateFromChat(chat: JsonRecord): unknown {
  return parseRecord(chat.metadata).roleplayContinuityDirector ?? null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createRoleplayContinuityDirectorApi(
  capabilities: { storage: StorageGateway; llm: LlmGateway },
  options: ApiOptions = {},
): RoleplayContinuityDirectorApi {
  const now = () => options.now?.() ?? new Date().toISOString();
  const sourceLoader = options.loadSource ?? loadContinuityDirectorSource;
  const planner = options.refreshPlan ?? refreshContinuityDirectorPlan;

  async function chat(chatId: string): Promise<JsonRecord> {
    let record: JsonRecord | null;
    try {
      record = await capabilities.storage.get<JsonRecord>("chats", chatId);
    } catch (error) {
      throw new ContinuityDirectorApiError("source_unavailable", errorMessage(error));
    }
    if (!record) throw new ContinuityDirectorApiError("chat_not_found", "Chat not found");
    return record;
  }

  async function view(chatId: string, state: RoleplayContinuityDirectorState): Promise<ContinuityDirectorStateView> {
    if (!state.sourceSnapshot) return { state, isStale: false, sourceUnavailable: false };
    try {
      const source: ContinuityDirectorSource = await sourceLoader(capabilities.storage, chatId, { now: options.now });
      return {
        state,
        isStale: source.sourceSnapshot.fingerprint !== state.sourceSnapshot.fingerprint,
        sourceUnavailable: false,
      };
    } catch (error) {
      if (error instanceof ContinuityDirectorApiError) throw error;
      throw new ContinuityDirectorApiError("source_unavailable", errorMessage(error));
    }
  }

  async function runPlanner(
    chatId: string,
    plannerOptions: { rerollBeatId?: string; initialExpectedDirectorState?: RoleplayContinuityDirectorState } = {},
  ) {
    const result = await planner(capabilities, {
      chatId,
      ...(plannerOptions.rerollBeatId ? { rerollBeatId: plannerOptions.rerollBeatId } : {}),
      ...(plannerOptions.initialExpectedDirectorState
        ? { initialExpectedDirectorState: plannerOptions.initialExpectedDirectorState }
        : {}),
      now: options.now,
      createId: options.createId,
    });
    if (!result.ok) throw new ContinuityDirectorApiError(result.code, result.message);
    return {
      state: result.state,
      isStale: false,
      sourceUnavailable: false,
      rejectedUnsafeBeats: result.rejectedUnsafeBeats,
    };
  }

  return {
    async getState(chatId) {
      const current = await chat(chatId);
      return view(chatId, stateFromChat(current, now()));
    },

    async command(chatId, command, expectedRevision) {
      const current = await chat(chatId);
      const currentState = stateFromChat(current, now());
      if (expectedRevision !== undefined && currentState.revision !== expectedRevision) {
        throw new ContinuityDirectorApiError(
          "stale_revision",
          "The continuity plan changed. Reload it before applying this edit.",
        );
      }
      const nextState = applyContinuityDirectorCommand(currentState, command, {
        now: options.now,
        createId: options.createId,
      });
      const updateChatIfUnchanged = capabilities.storage.updateChatIfUnchanged;
      if (!updateChatIfUnchanged) {
        throw new ContinuityDirectorApiError(
          "persistence_failed",
          "Conditional chat persistence is unavailable.",
        );
      }
      let result: { updated: boolean; chat: JsonRecord };
      try {
        result = (await updateChatIfUnchanged.call(
          capabilities.storage,
          chatId,
          { metadata: { roleplayContinuityDirector: rawStateFromChat(current) } },
          { metadata: { roleplayContinuityDirector: nextState } },
        )) as { updated: boolean; chat: JsonRecord };
      } catch (error) {
        throw new ContinuityDirectorApiError("persistence_failed", errorMessage(error));
      }
      if (!result.updated) {
        throw new ContinuityDirectorApiError(
          "stale_revision",
          "The continuity plan changed. Reload it before applying this edit.",
        );
      }
      const committedState = stateFromChat(result.chat, now());
      try {
        return await view(chatId, committedState);
      } catch {
        return { state: committedState, isStale: false, sourceUnavailable: true };
      }
    },

    async refresh(chatId, options) {
      return runPlanner(chatId, options);
    },

    async reroll(chatId, beatId) {
      return runPlanner(chatId, { rerollBeatId: beatId });
    },
  };
}

export const roleplayContinuityDirectorApi = createRoleplayContinuityDirectorApi({
  storage: storageApi,
  llm: llmApi,
});
