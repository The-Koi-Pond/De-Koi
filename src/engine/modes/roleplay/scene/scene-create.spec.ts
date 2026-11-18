import { describe, expect, it, vi } from "vitest";

import { createRoleplayScene } from "./scene-create";
import { SCENE_PLAN_SYSTEM_PROMPT } from "./scene-prompts";
import { createFakeSceneStorage, type FakeSceneStorageSeed } from "./scene-storage.fake";
import type { CreateSceneRequest, SceneFullPlan } from "./scene-types";

type JsonRecord = Record<string, unknown>;

const PLAN: SceneFullPlan = {
  name: "Scene: Dinner",
  description: "The dinner turns tense.",
  scenario: "A quiet dinner where a secret comes out.",
  firstMessage: "Participants: Mara\nAction: Mara sets down her glass\nPressure: The user must answer her",
  characterIds: ["mara"],
  systemPrompt: SCENE_PLAN_SYSTEM_PROMPT,
  rating: "sfw",
  relationshipHistory: "Old friends.",
};

function originFixture(origin: JsonRecord = {}, seed: FakeSceneStorageSeed = {}) {
  return createFakeSceneStorage({
    chats: [
      { id: "origin", name: "Dinner Chat", mode: "conversation", characterIds: ["mara"], metadata: {}, ...origin },
    ],
    messages: { origin: [{ id: "m-1", role: "user", content: "Let's have dinner." }] },
    ...seed,
  });
}

function request(overrides: Partial<CreateSceneRequest> = {}): CreateSceneRequest {
  return { originChatId: "origin", plan: PLAN, initiatorCharId: null, openingMode: "generated", ...overrides };
}

describe("creating a scene", () => {
  it("creates a linked Roleplay chat and points the origin at it", async () => {
    const fixture = originFixture({ connectionId: "origin-conn", personaId: "persona-1", groupId: "group-1" });

    const created = await createRoleplayScene(fixture.storage, request());

    expect(created).toEqual({
      chatId: expect.any(String),
      chatName: "Scene: Dinner",
      description: "The dinner turns tense.",
      background: null,
    });
    expect(fixture.chat(created.chatId)).toMatchObject({
      name: "Scene: Dinner",
      mode: "roleplay",
      characterIds: ["mara"],
      personaId: "persona-1",
      groupId: "group-1",
      connectionId: "origin-conn",
      connectedChatId: "origin",
      metadata: {
        sceneOriginChatId: "origin",
        sceneInitiatorCharId: null,
        sceneDescription: "The dinner turns tense.",
        sceneScenario: PLAN.scenario,
        sceneBackground: null,
        sceneRelationshipHistory: "Old friends.",
        sceneRating: "sfw",
        sceneStatus: "active",
        enableMemoryRecall: true,
        enableAgents: true,
      },
    });
    const sceneSystemPrompt = String(fixture.metadata(created.chatId).sceneSystemPrompt);
    expect(sceneSystemPrompt.startsWith(SCENE_PLAN_SYSTEM_PROMPT)).toBe(true);
    expect(sceneSystemPrompt).toContain("quotation marks");
    expect(fixture.chat("origin")).toMatchObject({
      connectedChatId: created.chatId,
      metadata: { activeSceneChatId: created.chatId, sceneBusyCharIds: ["mara"] },
    });
  });

  it("refuses a second active scene before creating anything", async () => {
    const fixture = originFixture({ metadata: { activeSceneChatId: "other-scene" } });

    await expect(createRoleplayScene(fixture.storage, request())).rejects.toThrow(
      "This conversation already has an active scene. Conclude or discard that scene first.",
    );
    expect(fixture.createdChats).toHaveLength(0);
  });

  it("refuses a create while another one for the same origin is running", async () => {
    const fixture = originFixture();
    const create = fixture.storage.create.bind(fixture.storage);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => (release = resolve));
    vi.spyOn(fixture.storage, "create").mockImplementationOnce(async (entity, value) => {
      await blocked;
      return create(entity, value);
    });

    const first = createRoleplayScene(fixture.storage, request());
    await vi.waitFor(() => expect(fixture.storage.create).toHaveBeenCalled());
    await expect(createRoleplayScene(fixture.storage, request())).rejects.toThrow(
      "A scene is already being created for this conversation. Wait for it to finish.",
    );
    release();
    await expect(first).resolves.toMatchObject({ chatName: "Scene: Dinner" });
    expect(fixture.createdChats).toHaveLength(1);
  });

  // Decision 7.
  it("refuses to start a scene inside an active scene", async () => {
    const fixture = originFixture({ mode: "roleplay", metadata: { sceneStatus: "active", sceneOriginChatId: "x" } });

    await expect(createRoleplayScene(fixture.storage, request())).rejects.toThrow("Finish this scene first.");
    expect(fixture.createdChats).toHaveLength(0);
  });

  it.each([
    ["missing mode", {}],
    ["another mode", { mode: "fanfic" }],
  ])("refuses an origin with %s", async (_label, origin) => {
    const fixture = originFixture({ mode: undefined, ...origin });

    await expect(createRoleplayScene(fixture.storage, request())).rejects.toThrow(
      "A scene can only start from a Conversation or Roleplay chat.",
    );
    expect(fixture.createdChats).toHaveLength(0);
  });

  it("starts a scene from a Conversation unfiled, and from a Roleplay in the origin's folder", async () => {
    const fromConversation = originFixture({ folderId: "texts-folder" });
    const fromRoleplay = originFixture({ mode: "roleplay", folderId: "rp-folder" });
    const fromVisualNovel = originFixture({ mode: "visual_novel", folderId: "vn-folder" });

    const a = await createRoleplayScene(fromConversation.storage, request());
    const b = await createRoleplayScene(fromRoleplay.storage, request());
    const c = await createRoleplayScene(fromVisualNovel.storage, request());

    expect(fromConversation.chat(a.chatId)?.folderId).toBeNull();
    expect(fromRoleplay.chat(b.chatId)?.folderId).toBe("rp-folder");
    expect(fromVisualNovel.chat(c.chatId)?.folderId).toBe("vn-folder");
  });

  it("never applies a background and starts with the default background agents", async () => {
    const fixture = originFixture();

    const created = await createRoleplayScene(fixture.storage, request());

    expect(fixture.metadata(created.chatId)).toMatchObject({ sceneBackground: null, activeAgentIds: [] });
    expect(fixture.metadata(created.chatId)).not.toHaveProperty("chatBackground");
  });

  it("carries the last scene's options, lorebooks and music source over", async () => {
    const fixture = originFixture({
      activeLorebookIds: ["lore-b", "lore-c"],
      metadata: {
        activeLorebookIds: ["lore-a", "lore-b"],
        musicSpotifySource: { type: "artist", artist: "Björk" },
        enableTools: true,
        activeToolIds: ["origin-tool"],
        lastRoleplaySceneOptions: { activeAgentIds: ["expression"], activeToolIds: ["dice"], spriteSide: "left" },
      },
    });

    const created = await createRoleplayScene(fixture.storage, request());

    expect(fixture.chat(created.chatId)?.activeLorebookIds).toEqual(["lore-a", "lore-b", "lore-c"]);
    expect(fixture.metadata(created.chatId)).toMatchObject({
      activeLorebookIds: ["lore-a", "lore-b", "lore-c"],
      musicSpotifySource: { type: "artist", artist: "Björk" },
      activeAgentIds: ["expression"],
      activeToolIds: ["dice"],
      enableTools: true,
      spriteSide: "left",
    });
  });

  it("keeps tools off when the carried options turn them off", async () => {
    const fixture = originFixture({ metadata: { enableTools: false, activeToolIds: ["dice"] } });

    const created = await createRoleplayScene(fixture.storage, request());

    expect(fixture.metadata(created.chatId)).toMatchObject({ enableTools: false });
    expect(fixture.metadata(created.chatId)).not.toHaveProperty("activeToolIds");
  });

  it("leaves the opening to the Roleplay writer, or writes the planned one", async () => {
    const generated = originFixture();
    const planned = originFixture();

    const a = await createRoleplayScene(generated.storage, request({ openingMode: "generated" }));
    const b = await createRoleplayScene(planned.storage, request({ openingMode: "planned", initiatorCharId: "mara" }));

    expect(generated.messages(a.chatId)).toEqual([]);
    expect(planned.messages(b.chatId)).toEqual([
      expect.objectContaining({
        role: "assistant",
        characterId: "mara",
        content: `${PLAN.description}\n\n${PLAN.firstMessage}`,
      }),
    ]);
  });

  it("carries the origin's last 24 visible messages, without ones hidden from the AI", async () => {
    const fixture = originFixture(
      {},
      {
        messages: {
          origin: [
            ...Array.from({ length: 30 }, (_, index) => ({ id: `m-${index}`, role: "user", content: `line ${index}` })),
            { id: "old-return", role: "assistant", content: "HIDDEN_RETURN", extra: { hiddenFromAI: true } },
            { id: "last", role: "assistant", content: "VISIBLE_LAST" },
          ],
        },
      },
    );

    const created = await createRoleplayScene(fixture.storage, request());

    const context = String(fixture.metadata(created.chatId).sceneConversationContext);
    expect(context).toContain("assistant: VISIBLE_LAST");
    expect(context).not.toContain("HIDDEN_RETURN");
    expect(context).toContain("user: line 29");
    expect(context).not.toContain("line 7\n");
    expect(fixture.messageReads.every((read) => (read.options?.limit ?? Infinity) <= 24)).toBe(true);
  });

  it("starts on the Universal preset with the choices it infers", async () => {
    const fixture = originFixture();

    const created = await createRoleplayScene(
      fixture.storage,
      request({ plan: { ...PLAN, rating: "nsfw", scenario: "A filthy, explicit night together." } }),
    );

    expect(fixture.chat(created.chatId)).toMatchObject({
      promptPresetId: "preset_universal_v2",
      metadata: {
        sceneUniversalPresetId: "preset_universal_v2",
        sceneUniversalPresetChoiceHints: expect.objectContaining({ contentBoundary: "boundary_mature_dark" }),
        presetChoices: { contentBoundary: "MATURE_BOUNDARY_TEXT", eroticTone: "FILTHY_EROTIC_TONE" },
      },
    });
  });

  it("keeps a dark but non-explicit scene genre-neutral", async () => {
    const fixture = originFixture();

    const created = await createRoleplayScene(
      fixture.storage,
      request({ plan: { ...PLAN, scenario: "A ruthless betrayal ends the alliance in blood." } }),
    );

    expect(fixture.metadata(created.chatId).presetChoices).toMatchObject({ contentBoundary: "SFW_BOUNDARY_TEXT" });
  });

  it("uses the origin's preset when the Universal preset isn't installed", async () => {
    const fixture = originFixture({ promptPresetId: "my-preset" }, { universalPreset: false });

    const created = await createRoleplayScene(fixture.storage, request());

    expect(fixture.chat(created.chatId)?.promptPresetId).toBe("my-preset");
    expect(fixture.metadata(created.chatId)).not.toHaveProperty("sceneUniversalPresetId");
  });

  it("removes the scene and puts the origin back when a later write fails", async () => {
    const fixture = originFixture({ connectedChatId: "linked-rp" });
    vi.spyOn(fixture.storage, "createChatMessage").mockRejectedValueOnce(new Error("opening write failed"));

    await expect(createRoleplayScene(fixture.storage, request({ openingMode: "planned" }))).rejects.toThrow(
      "opening write failed",
    );

    expect(fixture.deletedChats).toHaveLength(1);
    expect(fixture.chat(fixture.deletedChats[0]!)).toBeUndefined();
    expect(fixture.chat("origin")).toMatchObject({
      connectedChatId: "linked-rp",
      metadata: { activeSceneChatId: null, sceneBusyCharIds: null, scenePreviousConnectedChatId: null },
    });
  });

  it("names both failures when putting things back fails too", async () => {
    const fixture = originFixture();
    vi.spyOn(fixture.storage, "createChatMessage").mockRejectedValueOnce(new Error("opening write failed."));
    vi.spyOn(fixture.storage, "delete").mockRejectedValueOnce(new Error("disk is full"));

    await expect(createRoleplayScene(fixture.storage, request({ openingMode: "planned" }))).rejects.toThrow(
      /opening write failed\..*disk is full/,
    );
  });

  // Decision 2.
  it("remembers the origin's existing link while the scene borrows it", async () => {
    const fixture = originFixture({ connectedChatId: "linked-rp" });

    const created = await createRoleplayScene(fixture.storage, request());

    expect(fixture.chat("origin")).toMatchObject({
      connectedChatId: created.chatId,
      metadata: { scenePreviousConnectedChatId: "linked-rp" },
    });
  });
});
