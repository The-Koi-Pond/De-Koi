interface GenerationAgentConnectionWarningBase {
  severity: "warning";
  message: string;
  agentNames: string[];
}

interface GenerationDefaultAgentConnectionWarning extends GenerationAgentConnectionWarningBase {
  code: "default_agent_connection_active";
  connectionId: string | null;
  connectionName: string;
  model: string;
  dismissalKey: string;
}

interface GenerationLocalSidecarUnavailableWarning extends GenerationAgentConnectionWarningBase {
  code: "local_sidecar_unavailable";
}

type GenerationAgentConnectionWarning =
  | GenerationDefaultAgentConnectionWarning
  | GenerationLocalSidecarUnavailableWarning;

export interface GenerationDiagnosticEventData {
  kind: "timing";
  name: string;
  durationMs: number;
  chatId: string;
  chatMode: string;
  groupChatMode: string | null;
  characterCount: number;
  targetCharacterId: string | null;
  messageCount?: number;
  promptMessageCount?: number;
  savedUserMessage?: boolean;
}

export type LegacyStreamProtocolEvent =
  | { type: "agent_update"; data: string; agentId?: string; messageId?: string }
  | { type: "game_state"; data: string; agentId?: string; messageId?: string }
  | { type: "error"; data: string; agentId?: string; messageId?: string };

export type GenerationEvent =
  | { type: "phase"; data: string }
  | { type: "thinking"; data: string }
  | { type: "token"; data: string }
  | { type: "delta"; data: string }
  | { type: "content_replace"; data: string }
  | { type: "tool_call"; data: { id?: string; name: string; arguments: string } }
  | { type: "tool_result"; data: { toolCallId?: string; name: string; result: string; success: boolean } }
  | { type: "typing"; data: { characters: string[] } }
  | { type: "delayed"; data: { characters: string[]; status: string; delayMs: number } }
  | { type: "offline"; data: { characters: string[] } }
  | { type: "group_turn"; data: { characterId: string; characterName: string; index: number; total: number } }
  | { type: "diagnostic"; data: GenerationDiagnosticEventData }
  | { type: "message"; data: unknown }
  | { type: "user_message"; data: unknown }
  | { type: "assistant_message"; data: unknown }
  | { type: "agent_injection_review"; data: unknown }
  | { type: "agent_warning"; data: GenerationAgentConnectionWarning }
  | { type: "agent_result"; data: unknown }
  | { type: "cross_post"; data: unknown }
  | { type: "assistant_action"; data: unknown }
  | { type: "ooc_posted"; data: unknown }
  | { type: "selfie"; data: unknown }
  | { type: "selfie_error"; data: unknown }
  | { type: "command_error"; data: unknown }
  | { type: "illustration"; data: unknown }
  | { type: "illustration_error"; data: unknown }
  | { type: "scene_created"; data: unknown }
  | { type: "done"; data?: unknown };
