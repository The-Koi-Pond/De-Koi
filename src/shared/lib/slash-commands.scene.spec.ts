import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LlmGateway } from "../../engine/capabilities/llm";
import type { StorageGateway } from "../../engine/capabilities/storage";
import {
  createFakeSceneStorage,
  scriptedLlm,
  type FakeSceneStorage,
} from "../../engine/modes/roleplay/scene/scene-storage.fake";

const runtime = vi.hoisted(() => ({
  storage: null as unknown as StorageGateway,
  llm: null as unknown as LlmGateway,
  setActiveChatId: vi.fn(),
  toast: { dismiss: vi.fn(), error: vi.fn(), loading: vi.fn(() => "scene-toast"), success: vi.fn() },
}));

// The wrappers forward to the in-memory runtime of the current test.
vi.mock("../api/storage-api", () => {
  const forward = new Proxy({}, { get: (_target, key) => runtime.storage[key as keyof StorageGateway] });
  return { storageApi: forward, chatTranscriptStorageApi: forward, chatMetadataStorageApi: forward };
});
vi.mock("../api/llm-api", () => ({
  llmApi: new Proxy({}, { get: (_target, key) => runtime.llm[key as keyof LlmGateway] }),
}));
vi.mock("../api/image-generation-api", () => ({ spriteApi: {} }));
vi.mock("../stores/chat.store", () => ({
  useChatStore: { getState: () => ({ setActiveChatId: runtime.setActiveChatId }) },
}));
vi.mock("../stores/ui.store", () => ({ useUIStore: { getState: () => ({}) } }));
vi.mock("sonner", () => ({ toast: runtime.toast }));

import { matchSlashCommand, type SlashCommandContext } from "./slash-commands";

const BEAT = "Participants: Harlequin\nAction: Harlequin blocks the corridor\nPressure: The user must answer";
const PLAN_ANSWER = JSON.stringify({
  name: "Scene: Hallway",
  description: "A confrontation backstage.",
  scenario: "Harlequin wants the joke repeated.",
  firstMessage: BEAT,
  characterIds: ["harlequin"],
  rating: "sfw",
  relationshipHistory: "They were teasing.",
});

let fixture: FakeSceneStorage;

function useRuntime(options: { metadata?: Record<string, unknown>; messages?: number; answer?: string } = {}) {
  fixture = createFakeSceneStorage({
    chats: [
      {
        id: "conversation-chat",
        mode: "conversation",
        connectionId: "main",
        characterIds: ["harlequin"],
        metadata: options.metadata ?? {},
      },
    ],
    connections: [{ id: "main", enabled: true }],
    messages: {
      "conversation-chat": Array.from({ length: options.messages ?? 1 }, (_, index) => ({
        id: `m-${index}`,
        role: "user",
        content: "Say that joke again.",
      })),
    },
  });
  const model = scriptedLlm(() => options.answer ?? PLAN_ANSWER);
  runtime.storage = fixture.storage;
  runtime.llm = model.llm;
  return model;
}

function context(generate = vi.fn().mockResolvedValue(true)): SlashCommandContext {
  return {
    chatId: "conversation-chat",
    mode: "conversation",
    generate,
    createMessage: vi.fn(),
    invalidate: vi.fn(),
    characterNames: ["Harlequin"],
  };
}

async function run(input: string, ctx = context()) {
  const match = matchSlashCommand(input);
  if (!match) throw new Error(`${input} didn't match a command`);
  return { result: await match.command.execute(match.args, ctx), ctx };
}

describe("/scene", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("plans, creates and opens the scene, then streams its opening through the Roleplay writer", async () => {
    const model = useRuntime();

    const { result, ctx } = await run("/scene a heist at the gala");

    expect(result).toEqual({ handled: true });
    expect(model.requests).toHaveLength(1);
    const scene = fixture.createdChats[0]!;
    expect(scene).toMatchObject({ name: "Scene: Hallway", mode: "roleplay", connectedChatId: "conversation-chat" });
    expect(fixture.messages(String(scene.id))).toEqual([]);
    expect(ctx.invalidate).toHaveBeenCalled();
    expect(runtime.setActiveChatId).toHaveBeenCalledWith(scene.id);
    expect(ctx.generate).toHaveBeenCalledWith({
      chatId: scene.id,
      connectionId: null,
      generationGuide: expect.stringContaining(BEAT),
      generationGuideSource: "narrator",
    });
    expect(runtime.toast.loading).toHaveBeenCalledWith("Planning scene...", { icon: "🎬" });
    expect(runtime.toast.loading).toHaveBeenCalledWith("Creating scene...", { id: "scene-toast", icon: "🎬" });
    expect(runtime.toast.success).toHaveBeenCalledWith("Scene created: Scene: Hallway", {
      id: "scene-toast",
      icon: "🎬",
    });
  });

  it("answers to /rp too", async () => {
    useRuntime();

    await run("/rp");

    expect(fixture.createdChats).toHaveLength(1);
  });

  it.each([
    ["returns false", () => vi.fn().mockResolvedValue(false)],
    ["throws", () => vi.fn().mockRejectedValue(new Error("provider unavailable"))],
  ])("keeps the scene and says so when the opening %s", async (_label, makeGenerate) => {
    useRuntime();

    const { result } = await run("/scene", context(makeGenerate()));

    expect(result).toEqual({
      handled: true,
      feedback: "Scene created, but its opening could not start. Send a message in the scene to continue.",
    });
    expect(fixture.createdChats).toHaveLength(1);
    expect(runtime.setActiveChatId).toHaveBeenCalledWith(fixture.createdChats[0]!.id);
  });

  it("asks for a description when there's nothing to base the scene on", async () => {
    const model = useRuntime({ messages: 0 });

    const { result } = await run("/scene");

    expect(result).toEqual({
      handled: true,
      feedback: "No conversation history to base a scene on. Provide a description or chat first: /scene <description>",
    });
    expect(model.requests).toEqual([]);
    expect(runtime.toast.loading).not.toHaveBeenCalled();
  });

  // Decision 1.
  it("shows the real reason and creates nothing when planning fails", async () => {
    useRuntime({ answer: "Sorry, I can't plan that." });

    const { result, ctx } = await run("/scene a heist");

    expect(result).toEqual({
      handled: true,
      feedback:
        "Scene planning failed: The model's answer wasn't a scene plan. Try again, or switch to a stronger model.",
    });
    expect(fixture.createdChats).toEqual([]);
    expect(ctx.generate).not.toHaveBeenCalled();
    expect(runtime.setActiveChatId).not.toHaveBeenCalled();
    expect(runtime.toast.dismiss).toHaveBeenCalledWith("scene-toast");
  });

  it("shows why it can't create a second scene", async () => {
    useRuntime({ metadata: { activeSceneChatId: "earlier-scene" } });

    const { result } = await run("/scene another one");

    expect(result).toEqual({
      handled: true,
      feedback: "This conversation already has an active scene. Conclude or discard that scene first.",
    });
    expect(fixture.createdChats).toEqual([]);
  });

  // Decision 7.
  it("refuses inside an active scene without planning", async () => {
    const model = useRuntime({ metadata: { sceneStatus: "active", sceneOriginChatId: "origin" } });

    const { result } = await run("/scene a scene within a scene");

    expect(result).toEqual({ handled: true, feedback: "Finish this scene first." });
    expect(model.requests).toEqual([]);
  });
});
