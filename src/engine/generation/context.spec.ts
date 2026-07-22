import { describe, expect, it, vi } from "vitest";

import type { ChatMessageListOptions, ChatTranscriptPort, StorageGateway } from "../capabilities/storage";
import { llmParameters, loadChatMessages, resolveGenerationConnection } from "./context";
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

describe("generation connection resolution", () => {
  function storageWithConnections(connections: Array<Record<string, unknown>>): StorageGateway {
    return {
      list: vi.fn(async (entity: string) => (entity === "connections" ? connections : [])),
      get: vi.fn(async (_entity: string, id: string) => connections.find((connection) => connection.id === id) ?? null),
    } as unknown as StorageGateway;
  }

  it("resolves a random request to a concrete enabled pool connection", async () => {
    const storage = storageWithConnections([
      { id: "disabled", useForRandom: true, enabled: false },
      { id: "nanogpt", useForRandom: true, enabled: true },
    ]);

    await expect(
      resolveGenerationConnection(storage, {}, { connectionId: "random" }, { random: () => 0 }),
    ).resolves.toMatchObject({ id: "nanogpt" });
  });

  it("fails clearly instead of falling back when the random pool is empty", async () => {
    const storage = storageWithConnections([{ id: "default", isDefault: true, enabled: true }]);

    await expect(resolveGenerationConnection(storage, {}, { connectionId: "random" })).rejects.toThrow(
      "No connections are marked for the random pool",
    );
  });

  it("falls back to the default connection when neither the request nor chat selects one", async () => {
    const storage = storageWithConnections([
      { id: "other", enabled: true },
      { id: "default", isDefault: true, enabled: true },
    ]);

    await expect(resolveGenerationConnection(storage, {}, {})).resolves.toMatchObject({ id: "default" });
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
