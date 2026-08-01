import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createRoleplayScene: vi.fn(),
  planRoleplayScene: vi.fn(),
  setActiveChatId: vi.fn(),
}));

vi.mock("../../engine/modes/roleplay/scene/scene-service", () => ({
  createRoleplayScene: mocks.createRoleplayScene,
  planRoleplayScene: mocks.planRoleplayScene,
}));

vi.mock("../api/storage-api", () => ({
  chatMetadataStorageApi: {},
  chatTranscriptStorageApi: { listChatMessages: vi.fn().mockResolvedValue([{ role: "user", content: "hello" }]) },
  storageApi: {},
}));

vi.mock("../api/llm-api", () => ({ llmApi: {} }));
vi.mock("../api/visual-assets-api", () => ({ visualAssetsApi: {} }));
vi.mock("../api/image-generation-api", () => ({ spriteApi: {} }));
vi.mock("../stores/chat.store", () => ({
  useChatStore: { getState: () => ({ setActiveChatId: mocks.setActiveChatId }) },
}));
vi.mock("../stores/ui.store", () => ({
  useUIStore: { getState: () => ({ setChatBackground: vi.fn() }) },
}));
vi.mock("sonner", () => ({
  toast: {
    dismiss: vi.fn(),
    error: vi.fn(),
    loading: vi.fn().mockReturnValue("scene-toast"),
    success: vi.fn(),
  },
}));

import { matchSlashCommand, type SlashCommandContext } from "./slash-commands";

const plan = {
  name: "Scene: Hallway",
  description: "A confrontation begins backstage.",
  scenario: "Harlequin asks Chai to repeat the joke.",
  firstMessage: "Harlequin steps into the corridor and blocks the way.",
  background: null,
  characterIds: ["harlequin"],
  systemPrompt: "Keep the confrontation playful.",
  rating: "sfw" as const,
  relationshipHistory: "They were teasing each other moments ago.",
  participationGuide: "",
};

function sceneContext(generate = vi.fn().mockResolvedValue(true)): SlashCommandContext {
  return {
    chatId: "conversation-chat",
    mode: "conversation",
    generate,
    createMessage: vi.fn(),
    invalidate: vi.fn(),
    characterNames: ["Harlequin"],
  };
}

describe("/scene", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.planRoleplayScene.mockResolvedValue({ plan });
    mocks.createRoleplayScene.mockResolvedValue({
      chatId: "scene-chat",
      chatName: plan.name,
      description: plan.description,
      background: null,
    });
  });

  it("defers the planner draft so the Roleplay writer owns the opening", async () => {
    const match = matchSlashCommand("/scene");

    await match!.command.execute(match!.args, sceneContext());

    expect(mocks.createRoleplayScene).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ openingMode: "generated" }),
      expect.anything(),
    );
  });

  it("generates the opening through the new scene chat's Roleplay pipeline", async () => {
    const generate = vi.fn().mockResolvedValue(true);
    const match = matchSlashCommand("/scene");

    await match!.command.execute(match!.args, sceneContext(generate));

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "scene-chat",
        connectionId: null,
        generationGuide: expect.stringContaining(plan.firstMessage),
        generationGuideSource: "narrator",
      }),
    );
  });

  it("reports a partial success when the scene exists but opening generation cannot start", async () => {
    const match = matchSlashCommand("/scene");

    const result = await match!.command.execute(match!.args, sceneContext(vi.fn().mockResolvedValue(false)));

    expect(result).toEqual({
      handled: true,
      feedback: "Scene created, but its opening could not start. Send a message in the scene to continue.",
    });
  });

  it("keeps the created scene and reports the opening failure when generation throws", async () => {
    const match = matchSlashCommand("/scene");

    const result = await match!.command.execute(
      match!.args,
      sceneContext(vi.fn().mockRejectedValue(new Error("provider unavailable"))),
    );

    expect(result).toEqual({
      handled: true,
      feedback: "Scene created, but its opening could not start. Send a message in the scene to continue.",
    });
    expect(mocks.setActiveChatId).toHaveBeenCalledWith("scene-chat");
  });
});
