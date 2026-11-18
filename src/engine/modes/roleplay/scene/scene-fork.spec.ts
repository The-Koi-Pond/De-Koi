import { describe, expect, it, vi } from "vitest";

import { forkRoleplayScene } from "./scene-fork";
import { createFakeSceneStorage } from "./scene-storage.fake";

type JsonRecord = Record<string, unknown>;

function forkFixture(sceneMetadata: JsonRecord = {}, messageCount = 4) {
  return createFakeSceneStorage({
    chats: [
      {
        id: "origin",
        mode: "conversation",
        connectedChatId: "scene",
        metadata: { activeSceneChatId: "scene", sceneBusyCharIds: ["mara"], scenePreviousConnectedChatId: null },
      },
      {
        id: "scene",
        name: "Scene: Keep the Good Bits",
        mode: "roleplay",
        characterIds: ["mara"],
        personaId: "persona-1",
        promptPresetId: "preset-1",
        connectionId: "main",
        folderId: "rp-folder",
        connectedChatId: "origin",
        metadata: {
          sceneOriginChatId: "origin",
          sceneStatus: "active",
          sceneScenario: "A flooded archive.",
          sceneRelationshipHistory: "Old friends.",
          sceneConversationContext: "user: Shall we?",
          sceneSystemPrompt: "Scene rules.",
          activeSceneChatId: "nested",
          enableAgents: true,
          activeLorebookIds: ["lore-1"],
          ...sceneMetadata,
        },
      },
    ],
    messages: {
      scene: Array.from({ length: messageCount }, (_, index) => ({
        id: `m-${index + 1}`,
        role: index % 2 ? "user" : "assistant",
        content: `Beat ${index + 1}`,
        swipes: [{ content: `Beat ${index + 1}` }, { content: `Alt ${index + 1}` }],
        activeSwipeIndex: 0,
        extra: { spriteExpressions: { mara: "joy" } },
      })),
    },
  });
}

describe("forking a scene", () => {
  it("converts: copies every message after a hidden continuity note, then removes the scene", async () => {
    const fixture = forkFixture({}, 18);

    const forked = await forkRoleplayScene(fixture.storage, { sceneChatId: "scene", mode: "convert" });

    expect(forked).toEqual({
      chatId: expect.any(String),
      chatName: "Scene: Keep the Good Bits Converted",
      mode: "convert",
      originChatId: "origin",
    });
    expect(fixture.chat(forked.chatId)).toMatchObject({
      mode: "roleplay",
      characterIds: ["mara"],
      personaId: "persona-1",
      promptPresetId: "preset-1",
      connectionId: "main",
      folderId: "rp-folder",
      connectedChatId: null,
      metadata: { enableAgents: true, activeLorebookIds: ["lore-1"] },
    });
    const metadataKeys = Object.keys(fixture.metadata(forked.chatId));
    expect(metadataKeys.filter((key) => key.startsWith("scene") || key === "activeSceneChatId")).toEqual([]);

    const copied = fixture.messages(forked.chatId);
    expect(copied).toHaveLength(19);
    expect(copied[0]).toMatchObject({
      role: "narrator",
      extra: { hiddenFromUser: true, isSceneContinuity: true },
    });
    expect(copied[0]!.content).toMatch(/^Hidden continuity carried from the original scene branch\./);
    expect(copied[0]!.content).toContain("A flooded archive.");
    expect(copied[0]!.content).toContain("Old friends.");
    expect(copied[0]!.content).toContain("user: Shall we?");
    expect(copied.slice(1).map((message) => message.content)).toEqual(
      Array.from({ length: 18 }, (_, index) => `Beat ${index + 1}`),
    );
    expect(copied[1]).toMatchObject({
      swipes: [{ content: "Beat 1" }, { content: "Alt 1" }],
      extra: { spriteExpressions: { mara: "joy" } },
    });
    expect(copied[1]!.id).not.toBe("m-1");

    expect(fixture.bulkDeletes).toEqual([
      { chatId: "scene", messageIds: Array.from({ length: 18 }, (_, index) => `m-${index + 1}`) },
    ]);
    expect(fixture.singleDeletes).toEqual([]);
    expect(fixture.calls.indexOf("bulkDeleteChatMessages:scene")).toBeLessThan(
      fixture.calls.indexOf("delete:chats:scene"),
    );
    expect(fixture.chat("origin")).toMatchObject({
      connectedChatId: null,
      metadata: { activeSceneChatId: null, sceneBusyCharIds: null },
    });
    expect(fixture.metadata("origin")).not.toHaveProperty("lastRoleplaySceneSummary");
    expect(fixture.messages("origin")).toEqual([]);
  });

  it("clones up to and including one message and leaves the scene active", async () => {
    const fixture = forkFixture();

    const forked = await forkRoleplayScene(fixture.storage, {
      sceneChatId: "scene",
      mode: "clone",
      upToMessageId: "m-2",
    });

    expect(forked.chatName).toBe("Scene: Keep the Good Bits Clone");
    expect(fixture.messages(forked.chatId).map((message) => message.content)).toEqual([
      expect.stringContaining("Hidden continuity"),
      "Beat 1",
      "Beat 2",
    ]);
    expect(fixture.metadata("scene").sceneStatus).toBe("active");
    expect(fixture.chat("origin")?.connectedChatId).toBe("scene");
    expect(fixture.deletedChats).toEqual([]);
  });

  it("adds no continuity note when the scene carries no context", async () => {
    const fixture = forkFixture({ sceneScenario: "", sceneRelationshipHistory: "", sceneConversationContext: "" });

    const forked = await forkRoleplayScene(fixture.storage, { sceneChatId: "scene", mode: "clone" });

    expect(fixture.messages(forked.chatId).map((message) => message.content)).toEqual([
      "Beat 1",
      "Beat 2",
      "Beat 3",
      "Beat 4",
    ]);
  });

  it("refuses a message outside the scene and a convert limited to a message", async () => {
    const fixture = forkFixture();

    await expect(
      forkRoleplayScene(fixture.storage, { sceneChatId: "scene", mode: "clone", upToMessageId: "elsewhere" }),
    ).rejects.toThrow("Message is not part of this scene");
    await expect(
      forkRoleplayScene(fixture.storage, { sceneChatId: "scene", mode: "convert", upToMessageId: "m-2" }),
    ).rejects.toThrow("Convert cannot be limited to a message");
    expect(fixture.createdChats).toEqual([]);
  });

  it("removes a half-copied chat when copying fails", async () => {
    const fixture = forkFixture();
    const createMessage = fixture.storage.createChatMessage.bind(fixture.storage);
    let writes = 0;
    vi.spyOn(fixture.storage, "createChatMessage").mockImplementation(async (chatId, value) => {
      if (++writes === 3) throw new Error("copy failed");
      return createMessage(chatId, value);
    });

    await expect(forkRoleplayScene(fixture.storage, { sceneChatId: "scene", mode: "convert" })).rejects.toThrow(
      "copy failed",
    );

    const copy = fixture.createdChats[0]!;
    expect(fixture.chat(String(copy.id))).toBeUndefined();
    expect(fixture.chat("scene")).toBeDefined();
    expect(fixture.metadata("origin").activeSceneChatId).toBe("scene");
  });
});
