export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  images?: string[];
  tool_call_id?: string;
  tool_calls?: unknown;
  providerMetadata?: unknown;
  /** Stable owner-provided classification used by the context-window packer. */
  contextKind?: string;
  /** Optional numeric refinement within a context kind; larger values are retained first. */
  contextPriority?: number;
  /** Human-readable section name used only in fit diagnostics and prompt previews. */
  displayName?: string;
  /** Classified logical sections retained through provider role normalization. */
  contextSegments?: Array<{
    role?: "system" | "user" | "assistant" | "tool";
    content: string;
    contextKind?: string;
    contextPriority?: number;
    displayName?: string;
  }>;
}

export interface LlmToolDefinition {
  name: string;
  description?: string;
  parameters?: unknown;
}

export interface LlmRequest {
  connectionId?: string | null;
  provider?: string | null;
  model?: string | null;
  messages: LlmMessage[];
  parameters?: Record<string, unknown>;
  tools?: LlmToolDefinition[];
}

export interface LlmCompletion {
  content: string;
  toolCalls?: unknown[];
  finishReason?: string | null;
  usage?: unknown;
  providerMetadata?: unknown;
}

export interface LlmEmbeddingRequest {
  texts: string[];
  connectionId?: string | null;
  model?: string | null;
}

export interface LlmChunk {
  type: "start" | "token" | "thinking" | "tool_call" | "usage" | "provider_metadata" | "done" | "error";
  text?: string;
  data?: unknown;
  finishReason?: string;
  providerMetadata?: unknown;
}

export interface LlmGateway {
  complete(request: LlmRequest, signal?: AbortSignal): Promise<string>;
  completeRich?(request: LlmRequest, signal?: AbortSignal): Promise<LlmCompletion>;
  stream(request: LlmRequest, signal?: AbortSignal): AsyncGenerator<LlmChunk>;
  listModels(connectionId?: string | null): Promise<Array<{ id: string; name?: string; provider?: string }>>;
  embed?(request: LlmEmbeddingRequest, signal?: AbortSignal): Promise<number[][] | null>;
}
