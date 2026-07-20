import { describe, expect, it, vi } from "vitest";

import type { ChatMessageListOptions, ChatTranscriptPort } from "../capabilities/storage";
import { llmParameters, loadChatMessages } from "./context";
import { recommendedGenerationProfileForRequest } from "./generate-route-utils";

describe("generation context message loading", () => {
  it("requests attachment metadata needed to deliver stored images", async () => {
    let requestedOptions: ChatMessageListOptions | undefined;
    const storage = {
      listChatMessages: vi.fn(async (_chatId: string, options?: ChatMessageListOptions) => {
        requestedOptions = options;
        return [];
      }),
    } as unknown as ChatTranscriptPort;

    await loadChatMessages(storage, "chat-1");

    expect(requestedOptions?.fieldSelections?.extra).toContain("attachments");
  });
});

describe("recommended generation parameter precedence", () => {
  const connection = {
    provider: "openai",
    model: "gpt-5.2",
    maxContext: 128_000,
    capabilities: { reasoning: true },
  };

  it("supplies a recommendation when no explicit layer sets generation values", () => {
    expect(llmParameters(connection, {}, { mode: "conversation", metadata: {} })).toMatchObject({
      temperature: 0.7,
      topP: 0.95,
      maxTokens: 2048,
      reasoningEffort: "low",
      verbosity: "medium",
    });
  });

  it("keeps every explicit layer above the recommended baseline", () => {
    expect(
      llmParameters(
        {
          ...connection,
          defaultParameters: { topP: 0.8 },
        },
        { parameters: { temperature: 0.1 } },
        {
          mode: "conversation",
          metadata: { chatParameters: { maxTokens: 3333 } },
        },
        { topK: 20 },
      ),
    ).toMatchObject({
      temperature: 0.1,
      maxTokens: 3333,
      topP: 0.8,
      topK: 20,
      reasoningEffort: "low",
    });
  });

  it("lets an explicit chat preset override an explicit connection default", () => {
    expect(
      llmParameters(
        {
          ...connection,
          defaultParameters: { temperature: 0.8 },
        },
        {},
        { mode: "conversation", metadata: {} },
        { temperature: 0.3 },
      ),
    ).toMatchObject({
      temperature: 0.3,
    });
  });

  it("uses the efficient recommendation for structured agent calls", () => {
    expect(
      llmParameters(connection, { generationProfileMode: "agent" }, { mode: "roleplay", metadata: {} }),
    ).toMatchObject({
      temperature: 0.2,
      maxTokens: 2048,
      reasoningEffort: "low",
      verbosity: "low",
    });
  });

  it("ignores malformed explicit profile modes instead of crossing chat-mode lanes", () => {
    expect(
      recommendedGenerationProfileForRequest(
        connection,
        { generationProfileMode: "roleplay" },
        { mode: "game", metadata: {} },
      ).profileId,
    ).toBe("game-grounded");
  });
});
