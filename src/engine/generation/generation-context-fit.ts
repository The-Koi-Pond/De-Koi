import type { LlmMessage, LlmToolDefinition } from "../capabilities/llm";
import { ContextWindowOverflowError, fitLlmRequestToContextWindow, type ContextWindowFit } from "./context-window";

export const ROLEPLAY_SOFT_CONTEXT_TOKENS = 32_768;

/** Apply roleplay's bounded working set without turning the soft cap into a hard failure. */
export function fitGenerationRequestToContextWindow(
  messages: LlmMessage[],
  parameters: Record<string, unknown>,
  connection: Record<string, unknown> | null | undefined,
  options: { chatMode: string; tools?: LlmToolDefinition[] | null },
): ContextWindowFit {
  const sharedOptions = { tools: options.tools };
  if (options.chatMode.trim() !== "roleplay") {
    return fitLlmRequestToContextWindow(messages, parameters, connection, sharedOptions);
  }

  try {
    return fitLlmRequestToContextWindow(messages, parameters, connection, {
      ...sharedOptions,
      maxContextOverride: ROLEPLAY_SOFT_CONTEXT_TOKENS,
    });
  } catch (error) {
    if (!(error instanceof ContextWindowOverflowError)) throw error;
    return fitLlmRequestToContextWindow(messages, parameters, connection, sharedOptions);
  }
}
