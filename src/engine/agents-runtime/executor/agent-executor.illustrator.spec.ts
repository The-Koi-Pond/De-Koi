import { describe, expect, it } from "vitest";
import type { AgentContext } from "../../contracts/types/agent";
import type { BaseLLMProvider, ChatMessage } from "../../generation-core/llm/base-provider";
import { executeAgent, type AgentExecConfig } from "./agent-executor";

function illustratorConfig(): AgentExecConfig {
  return {
    id: "illustrator",
    type: "illustrator",
    name: "Illustrator",
    phase: "post_generation",
    promptTemplate: "Return image prompt JSON.",
    connectionId: null,
    settings: {},
  };
}

function illustratorContext(referenceImage: string): AgentContext {
  return {
    chatId: "chat-1",
    chatMode: "roleplay",
    recentMessages: [
      { role: "user", content: "I step back from the kitchen doorway." },
      { role: "assistant", content: "Michael Myers silently raises the knife in the dim hallway." },
    ],
    mainResponse: null,
    gameState: null,
    characters: [
      {
        id: "char-1",
        name: "Michael Myers",
        description: "A silent masked slasher in a dark mechanic suit.",
      },
    ],
    persona: null,
    memory: {
      _illustratorManualRequest: true,
      _illustratorReferenceImages: [
        {
          name: "Michael Myers",
          ownerType: "character",
          image: referenceImage,
        },
      ],
    },
    activatedLorebookEntries: null,
    writableLorebookIds: null,
    chatSummary: null,
    streaming: false,
  };
}

describe("Illustrator agent prompt requests", () => {
  it("does not attach avatar reference image payloads to the LLM prompt request", async () => {
    const calls: ChatMessage[][] = [];
    const provider: BaseLLMProvider = {
      maxTokensOverrideValue: null,
      async chatComplete(messages) {
        calls.push(messages);
        return {
          content: JSON.stringify({
            shouldGenerate: true,
            prompt: "Michael Myers stands in a dark hallway, knife raised, horror film lighting.",
            reason: "manual paintbrush request",
          }),
        };
      },
    };
    const referenceImage = `data:image/png;base64,${"A".repeat(1024)}`;

    const result = await executeAgent(illustratorConfig(), illustratorContext(referenceImage), provider, "test-model");

    expect(result.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.some((message) => Array.isArray(message.images) && message.images.length > 0)).toBe(false);
    expect(JSON.stringify(calls[0])).not.toContain(referenceImage);
    expect(calls[0]![0]?.content).toContain("passed directly to the image generator");
  });
});
