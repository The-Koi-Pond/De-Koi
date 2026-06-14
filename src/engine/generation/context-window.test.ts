import { describe, expect, it } from "vitest";
import type { LlmMessage, LlmToolDefinition } from "../capabilities/llm";
import { fitLlmRequestToContextWindow } from "./context-window";

function history(content: string): LlmMessage {
  return { role: "user", content, contextKind: "history" } as LlmMessage;
}

function repeatedToolSchema(descriptionLength: number): LlmToolDefinition[] {
  return [
    {
      name: "lookup_dossier",
      description: "x".repeat(descriptionLength),
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The dossier lookup query." },
        },
        required: ["query"],
      },
    },
  ];
}

describe("context window fitting", () => {
  it("reserves tool definition tokens before choosing retained history", () => {
    const messages: LlmMessage[] = [
      { role: "system", content: "System guidance." },
      history("first history ".repeat(18)),
      history("second history ".repeat(18)),
      history("latest history ".repeat(18)),
    ];
    const connection = { maxContext: 620 };
    const parameters = { maxTokens: 80 };

    const withoutTools = fitLlmRequestToContextWindow(messages, parameters, connection).messages;
    const withTools = fitLlmRequestToContextWindow(messages, parameters, connection, {
      tools: repeatedToolSchema(520),
    }).messages;

    expect(withoutTools).toHaveLength(messages.length);
    expect(withTools.length).toBeLessThan(withoutTools.length);
    expect(withTools.at(-1)?.content).toContain("latest history");
  });

  it("reduces output tokens when tools and irreducible prompt content consume the window", () => {
    const messages: LlmMessage[] = [
      { role: "system", content: "Authoritative system guidance. ".repeat(10) },
      history("only history row ".repeat(8)),
    ];

    const fitted = fitLlmRequestToContextWindow(messages, { maxTokens: 120 }, { maxContext: 560 }, {
      tools: repeatedToolSchema(720),
    });

    expect(fitted.parameters.maxTokens).toBeLessThan(120);
    expect(fitted.parameters.maxTokens).toBeGreaterThanOrEqual(1);
  });
});
