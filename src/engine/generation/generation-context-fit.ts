import type { LlmMessage, LlmToolDefinition } from "../capabilities/llm";
import {
  ContextWindowOverflowError,
  estimateLlmMessageTokens,
  fitLlmRequestToContextWindow,
  type ContextWindowFit,
} from "./context-window";

export const ROLEPLAY_SOFT_CONTEXT_TOKENS = 32_768;

function withRoleplaySoftLimitTrace(fit: ContextWindowFit, fallbackUsed: boolean): ContextWindowFit {
  const estimatedTokens = fit.messages.reduce((total, message) => total + estimateLlmMessageTokens(message), 0);
  return {
    ...fit,
    decision: {
      removedMessages: fit.decision?.removedMessages ?? [],
      truncatedMessages: fit.decision?.truncatedMessages ?? [],
      originalEstimatedTokens: fit.decision?.originalEstimatedTokens ?? estimatedTokens,
      fittedEstimatedTokens: fit.decision?.fittedEstimatedTokens ?? estimatedTokens,
      inputBudgetTokens: fit.decision?.inputBudgetTokens ?? 0,
      softLimitTokens: ROLEPLAY_SOFT_CONTEXT_TOKENS,
      softLimitFallbackUsed: fallbackUsed,
    },
  };
}

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
    const fit = fitLlmRequestToContextWindow(messages, parameters, connection, {
      ...sharedOptions,
      maxContextOverride: ROLEPLAY_SOFT_CONTEXT_TOKENS,
    });
    return fit.decision ? withRoleplaySoftLimitTrace(fit, false) : fit;
  } catch (error) {
    if (!(error instanceof ContextWindowOverflowError)) throw error;
    return withRoleplaySoftLimitTrace(
      fitLlmRequestToContextWindow(messages, parameters, connection, sharedOptions),
      true,
    );
  }
}
