import { invokeTauri } from "./tauri-client";

export type AgentCadenceStatus = {
  agentType: string;
  runInterval: number;
  lastSuccessfulRun: { messageId: string; createdAt: string } | null;
  assistantMessagesSinceLastRun: number | null;
  remainingAssistantMessages: number;
  runsNextAssistantMessage: boolean;
  lastRunMessageFound: boolean | null;
};

export type AgentMemoryResponse = {
  agentConfigId: string;
  memory: Record<string, unknown>;
};

export const agentApi = {
  patchByType: (agentType: string, patch: Record<string, unknown>) =>
    invokeTauri("agent_patch_by_type", { agentType, patch }),
  toggleByType: (agentType: string) => invokeTauri("agent_toggle_by_type", { agentType }),
  clearRunsForChat: (chatId: string) => invokeTauri<void>("agent_runs_clear_for_chat", { chatId }),
  clearEchoMessages: (chatId: string) => invokeTauri("agent_echo_messages_clear", { chatId }),
  cadenceStatus: (agentType: string, chatId: string) =>
    invokeTauri<AgentCadenceStatus>("agent_cadence_status", { agentType, chatId }),
  getMemory: (agentType: string, chatId: string) =>
    invokeTauri<AgentMemoryResponse>("agent_memory_get", { agentType, chatId }),
  patchMemory: (agentType: string, chatId: string, patch: Record<string, unknown>) =>
    invokeTauri<AgentMemoryResponse>("agent_memory_patch", { agentType, chatId, patch }),
  clearMemory: (agentType: string, chatId: string) => invokeTauri("agent_memory_clear", { agentType, chatId }),
};
