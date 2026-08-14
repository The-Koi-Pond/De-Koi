import { describe, expect, it } from "vitest";

import type { LlmMessage } from "../capabilities/llm";
import { fitGenerationRequestToContextWindow, ROLEPLAY_SOFT_CONTEXT_TOKENS } from "./generation-context-fit";

function longRoleplayHistory(): LlmMessage[] {
  return [
    { role: "system", content: "Keep the roleplay coherent.", contextKind: "prompt" },
    ...Array.from(
      { length: 48 },
      (_, index): LlmMessage => ({
        role: index % 2 === 0 ? "user" : "assistant",
        content: `history-${index} ${"detail ".repeat(420)}`,
        contextKind: "history",
      }),
    ),
    { role: "user", content: "The current turn", contextKind: "history" },
  ];
}

const largeConnection = { provider: "test", model: "large", maxContext: 128_000 };

describe("fitGenerationRequestToContextWindow", () => {
  it("packs roleplay to a soft context budget while retaining the newest exchanges", () => {
    const messages = longRoleplayHistory();
    const result = fitGenerationRequestToContextWindow(messages, { maxTokens: 4_096 }, largeConnection, {
      chatMode: "roleplay",
    });
    const text = result.messages.map((message) => message.content).join("\n");

    expect(result.decision?.inputBudgetTokens).toBeLessThan(ROLEPLAY_SOFT_CONTEXT_TOKENS);
    expect(result.messages.length).toBeLessThan(messages.length);
    expect(text).toContain("history-46");
    expect(text).toContain("history-47");
    expect(text).toContain("The current turn");
  });

  it("does not apply the roleplay soft budget to sibling modes", () => {
    const messages = longRoleplayHistory();
    const result = fitGenerationRequestToContextWindow(messages, { maxTokens: 4_096 }, largeConnection, {
      chatMode: "conversation",
    });

    expect(result.messages).toBe(messages);
    expect(result.decision).toBeNull();
  });

  it("falls back to the provider hard limit when required context cannot fit the soft budget", () => {
    const messages: LlmMessage[] = [
      { role: "system", content: "required ".repeat(18_000), contextKind: "prompt" },
      { role: "user", content: "Continue", contextKind: "history" },
    ];

    const result = fitGenerationRequestToContextWindow(messages, { maxTokens: 4_096 }, largeConnection, {
      chatMode: "roleplay",
    });

    expect(result.messages).toBe(messages);
    expect(result.decision).toBeNull();
  });
});
