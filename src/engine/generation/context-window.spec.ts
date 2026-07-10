import { describe, expect, it } from "vitest";

import type { LlmMessage, LlmToolDefinition } from "../capabilities/llm";
import { squashLeadingSystemMessages } from "../generation-core/prompt/merger";
import { ContextWindowOverflowError, estimateLlmMessageTokens, fitLlmRequestToContextWindow } from "./context-window";

function message(
  role: LlmMessage["role"],
  content: string,
  contextKind?: string,
  extra: Partial<LlmMessage> = {},
): LlmMessage {
  return { role, content, ...(contextKind ? { contextKind } : {}), ...extra } as LlmMessage;
}

const connection = { maxContext: 1_200 };

describe("fitLlmRequestToContextWindow", () => {
  it("keeps optional classification after squashing leading system messages", () => {
    const squashed = squashLeadingSystemMessages([
      { role: "system", content: "Required", contextKind: "prompt" },
      { role: "system", content: "Optional lore. ".repeat(160), contextKind: "lorebook" },
      { role: "user", content: "Current", contextKind: "history" },
    ]);

    const fitted = fitLlmRequestToContextWindow(squashed, { maxTokens: 400 }, connection);

    expect(fitted.messages[0]?.content).toBe("Required");
    expect(fitted.messages.map((entry) => entry.content).join("\n")).not.toContain("Optional lore");
    expect(fitted.messages.map((entry) => entry.content).join("\n")).toContain("Current");
  });

  it("returns an under-budget request unchanged", () => {
    const messages = [message("system", "Be concise.", "prompt"), message("user", "Hello", "history")];
    const parameters = { maxTokens: 400, temperature: 0.7 };

    const result = fitLlmRequestToContextWindow(messages, parameters, connection);

    expect(result).toEqual({ messages, parameters, decision: null });
    expect(result.messages).toBe(messages);
    expect(result.parameters).toBe(parameters);
  });

  it("removes optional non-history context before recent dialogue", () => {
    const messages = [
      message("system", "Core instruction", "prompt"),
      message("system", "Decorative context. ".repeat(100), "injection"),
      message("user", "Earlier question", "history"),
      message("assistant", "Earlier answer", "history"),
      message("user", "Current question", "history"),
    ];

    const result = fitLlmRequestToContextWindow(messages, { maxTokens: 400 }, connection);

    expect(result.messages.map((entry) => entry.content)).toEqual([
      "Core instruction",
      "Earlier question",
      "Earlier answer",
      "Current question",
    ]);
    expect(result.decision?.removedMessages).toEqual([
      expect.objectContaining({ contextKind: "injection", displayName: undefined }),
    ]);
    expect(result.parameters.maxTokens).toBe(400);
  });

  it("includes tool definitions in the input budget", () => {
    const tools: LlmToolDefinition[] = [
      { name: "search", description: "Search documentation. ".repeat(70), parameters: { type: "object" } },
    ];
    const optional = message("system", "Optional notes. ".repeat(80), "injection");
    const messages = [message("system", "Core", "prompt"), optional, message("user", "Question", "history")];

    const withoutTools = fitLlmRequestToContextWindow(messages, { maxTokens: 300 }, connection);
    const withTools = fitLlmRequestToContextWindow(messages, { maxTokens: 300 }, connection, { tools });

    expect(withoutTools.messages).toContain(optional);
    expect(withTools.messages).not.toContain(optional);
  });

  it("prefers the newest history exchange and preserves the latest user message", () => {
    const messages = [
      message("system", "Core", "prompt"),
      message("user", "old user ".repeat(45), "history"),
      message("assistant", "old assistant ".repeat(45), "history"),
      message("user", "new user ".repeat(35), "history"),
      message("assistant", "new assistant ".repeat(35), "history"),
      message("user", "current user", "history"),
    ];

    const result = fitLlmRequestToContextWindow(messages, { maxTokens: 500 }, connection);
    const text = result.messages.map((entry) => entry.content).join("\n");

    expect(text).not.toContain("old user");
    expect(text).not.toContain("old assistant");
    expect(text).toContain("new user");
    expect(text).toContain("new assistant");
    expect(text).toContain("current user");
  });

  it("does not mutate caller-owned messages while fitting", () => {
    const messages = [
      message("system", "Core", "prompt"),
      message("system", "paragraph one\n\n" + "paragraph two ".repeat(90), "summary"),
      message("user", "Current", "history"),
    ];
    const original = structuredClone(messages);

    fitLlmRequestToContextWindow(messages, { maxTokens: 500 }, connection);

    expect(messages).toEqual(original);
  });

  it("keeps assistant tool calls and their results atomic", () => {
    const toolCall = message("assistant", "", "history", {
      tool_calls: [{ id: "call-1", function: { name: "search", arguments: "{}" } }],
    });
    const toolResult = message("tool", "result ".repeat(120), "history", { tool_call_id: "call-1" });
    const messages = [
      message("system", "Core", "prompt"),
      message("user", "old", "history"),
      toolCall,
      toolResult,
      message("user", "current", "history"),
    ];

    const result = fitLlmRequestToContextWindow(messages, { maxTokens: 500 }, connection);
    const retainedToolCall = result.messages.includes(toolCall);
    const retainedToolResult = result.messages.includes(toolResult);

    expect(retainedToolCall).toBe(retainedToolResult);
  });

  it("leaves requests unchanged when the context limit is unknown", () => {
    const messages = [message("system", "x".repeat(10_000), "injection")];
    const parameters = { maxTokens: 4_096 };

    const result = fitLlmRequestToContextWindow(messages, parameters, {});

    expect(result).toEqual({ messages, parameters, decision: null });
  });

  it("preserves the output floor while removing lower-priority context", () => {
    const messages = [
      message("system", "Core", "prompt"),
      message("system", "Optional ".repeat(320), "injection"),
      message("user", "Current", "history"),
    ];

    const result = fitLlmRequestToContextWindow(messages, { maxTokens: 900 }, connection);

    expect(result.parameters.maxTokens).toBeGreaterThanOrEqual(256);
    const fittedTokens = result.messages.reduce((total, entry) => total + estimateLlmMessageTokens(entry), 0);
    expect(fittedTokens + Number(result.parameters.maxTokens) + 256).toBeLessThanOrEqual(1_200);
  });

  it("throws clearly when required context alone exceeds the model window", () => {
    const messages = [
      message("system", "Required system instruction. ".repeat(130), "prompt"),
      message("user", "Current user request", "history"),
    ];

    expect(() => fitLlmRequestToContextWindow(messages, { maxTokens: 600 }, connection)).toThrowError(
      ContextWindowOverflowError,
    );
    expect(() => fitLlmRequestToContextWindow(messages, { maxTokens: 600 }, connection)).toThrow(
      "Generation context exceeds the selected model window; reduce required prompt sections or choose a larger-context model.",
    );
  });
});
