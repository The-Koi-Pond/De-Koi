import { describe, expect, it, vi } from "vitest";
import type { LlmGateway, LlmRequest } from "../../../capabilities/llm";
import type { StorageGateway } from "../../../capabilities/storage";
import { analyzeGameScene } from "./game-scene-analysis.service";

function storageGateway(): StorageGateway {
  return {
    get: vi.fn(async (entity: string) =>
      entity === "chats" ? { id: "chat-1", connectionId: "scene-conn", metadata: {} } : null,
    ),
    list: vi.fn(async () => []),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    listChatMessages: vi.fn(),
    createChatMessage: vi.fn(),
    updateChatMessage: vi.fn(),
    deleteChatMessage: vi.fn(),
    patchChatMessageExtra: vi.fn(),
    addChatMessageSwipe: vi.fn(),
    patchChatMetadata: vi.fn(),
    patchChatSummaries: vi.fn(),
    listChatMemories: vi.fn(),
    getWorldState: vi.fn(),
    saveTrackerSnapshot: vi.fn(),
    listLorebookEntries: vi.fn(),
    createLorebookEntries: vi.fn(),
  } as unknown as StorageGateway;
}

describe("analyzeGameScene", () => {
  it("includes player action and world context in the scene prompt", async () => {
    const complete = vi.fn(async (_request: LlmRequest) => `{"background":null,"segmentEffects":[],"reputationChanges":[]}`);
    await analyzeGameScene(
      {
        storage: storageGateway(),
        llm: { complete, stream: vi.fn(), listModels: vi.fn() } as unknown as LlmGateway,
      },
      {
        chatId: "chat-1",
        narration: "Mira opens the sealed observatory.",
        playerAction: "I ask the party to stay quiet.",
        context: {
          currentState: "exploration",
          currentLocation: "Moonlit Observatory",
          genre: "arcane mystery",
          setting: "floating academy ruins",
          worldOverview: "The old academy drifts above a storm sea, guarded by oathbound machines.",
          currentWeather: "stormy",
          currentTimeOfDay: "night",
        },
      },
    );

    const userPrompt = complete.mock.calls[0]?.[0].messages.find((message) => message.role === "user")?.content;
    expect(userPrompt).toContain("<player_action>\nI ask the party to stay quiet.\n</player_action>");
    expect(userPrompt).toContain("location=Moonlit Observatory");
    expect(userPrompt).toContain("genre=arcane mystery");
    expect(userPrompt).toContain("setting=floating academy ruins");
    expect(userPrompt).toContain("The old academy drifts above a storm sea");
  });

  it("clears model illustration output when illustrations are disabled", async () => {
    const complete = vi.fn(
      async () =>
        JSON.stringify({
          background: null,
          segmentEffects: [],
          reputationChanges: [],
          illustration: {
            segment: 0,
            prompt:
              "A dramatic player point-of-view illustration of the forbidden door opening under silver moonlight.",
            characters: ["Mira"],
            reason: "The model should not be allowed to request this turn.",
            slug: "forbidden-door",
          },
        }),
    );

    const result = await analyzeGameScene(
      {
        storage: storageGateway(),
        llm: { complete, stream: vi.fn(), listModels: vi.fn() } as unknown as LlmGateway,
      },
      {
        chatId: "chat-1",
        narration: "The door opens.",
        context: {
          currentState: "exploration",
          canGenerateIllustrations: false,
        },
      },
    );

    expect(result.illustration).toBeNull();
  });
});
