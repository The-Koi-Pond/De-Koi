import { describe, expect, it } from "vitest";

import {
  effectiveCharacterMemoryPersistence,
  resolveAutomaticMemoryScope,
} from "./character-memory-scope";

describe("character memory scope", () => {
  it("defaults missing and invalid legacy values to character persistence", () => {
    expect(effectiveCharacterMemoryPersistence(undefined)).toBe("character");
    expect(effectiveCharacterMemoryPersistence("legacy")).toBe("character");
    expect(effectiveCharacterMemoryPersistence("chat")).toBe("chat");
  });

  it("uses the stable active assistant character id by default", () => {
    expect(
      resolveAutomaticMemoryScope({
        chatId: "chat-1",
        mode: "conversation",
        assistantCharacterId: "char-1",
        activeCharacters: [{ id: "char-1" }],
      }),
    ).toEqual({
      scope: { kind: "character", id: "char-1" },
      characterId: "char-1",
      reason: "attributed_character",
    });
  });

  it("keeps an attributed chat-only character local", () => {
    expect(
      resolveAutomaticMemoryScope({
        chatId: "chat-1",
        mode: "roleplay",
        sceneId: "scene-1",
        assistantCharacterId: "char-1",
        activeCharacters: [{ id: "char-1", memoryPersistence: "chat" }],
      }),
    ).toEqual({
      scope: { kind: "chat", id: "chat-1" },
      characterId: "char-1",
      reason: "character_chat_only",
    });
  });

  it("keeps ambiguous roleplay narration in the active scene", () => {
    expect(
      resolveAutomaticMemoryScope({
        chatId: "chat-1",
        mode: "roleplay",
        sceneId: "scene-1",
        assistantCharacterId: null,
        activeCharacters: [{ id: "char-1" }, { id: "char-2" }],
      }),
    ).toEqual({
      scope: { kind: "scene", id: "scene-1" },
      characterId: null,
      reason: "ambiguous_scene",
    });
  });

  it.each([
    ["missing identity", null],
    ["inactive identity", "char-2"],
  ])("keeps %s local to a conversation chat", (_label, assistantCharacterId) => {
    expect(
      resolveAutomaticMemoryScope({
        chatId: "chat-1",
        mode: "conversation",
        assistantCharacterId,
        activeCharacters: [{ id: "char-1" }],
      }),
    ).toEqual({
      scope: { kind: "chat", id: "chat-1" },
      characterId: null,
      reason: "ambiguous_chat",
    });
  });
});
