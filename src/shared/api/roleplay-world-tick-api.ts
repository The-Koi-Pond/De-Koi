import type { LlmGateway } from "../../engine/capabilities/llm";
import type { StorageGateway } from "../../engine/capabilities/storage";
import type { RoleplayWorldTickState, WorldTickCommand } from "../../engine/contracts/types/roleplay-world-tick";
import {
  applyWorldTick,
  commandWorldTick,
  getWorldTickState,
  proposeWorldTick,
  type ProposeWorldTickResult,
  type WorldTickServiceOptions,
} from "../../engine/modes/roleplay/world-tick/world-tick-service";
import { llmApi } from "./llm-api";
import { storageApi } from "./storage-api";
export { roleplayWorldTickKeys } from "./roleplay-world-tick-query-keys";

export interface RoleplayWorldTickApi {
  getState(chatId: string): Promise<RoleplayWorldTickState>;
  propose(
    chatId: string,
    input: { elapsed: string; guidance?: string; replacePending?: boolean; offerId?: string | null },
  ): Promise<ProposeWorldTickResult>;
  command(chatId: string, command: WorldTickCommand, expectedRevision?: number): Promise<RoleplayWorldTickState>;
  apply(chatId: string, tickId: string, expectedRevision?: number): Promise<RoleplayWorldTickState>;
}

/** Runs the engine's world-tick service on the active runtime's storage and model transport. */
function createRoleplayWorldTickApi(
  capabilities: { storage: StorageGateway; llm: LlmGateway },
  options: WorldTickServiceOptions = {},
): RoleplayWorldTickApi {
  return {
    getState: (chatId) => getWorldTickState(capabilities.storage, chatId, options),
    propose: (chatId, input) => proposeWorldTick(capabilities, { chatId, ...input }, options),
    command: (chatId, command, expectedRevision) =>
      commandWorldTick(capabilities.storage, chatId, command, expectedRevision, options),
    apply: (chatId, tickId, expectedRevision) =>
      applyWorldTick(capabilities.storage, { chatId, tickId, expectedRevision }, options),
  };
}

export const roleplayWorldTickApi = createRoleplayWorldTickApi({ storage: storageApi, llm: llmApi });
