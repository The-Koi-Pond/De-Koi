import { describe, expect, it } from "vitest";
import { lorebookCanBeSelectedForContext, resolveActiveLorebookScopeReasons } from "./active-lorebook-scope";

const baseContext = {
  chat: { id: "chat-1", metadata: {} },
  characters: [],
  persona: null,
};

describe("active lorebook scope", () => {
  it("honors disabled scope before global, chat, or selected activation", () => {
    const reasons = resolveActiveLorebookScopeReasons(
      {
        id: "book-1",
        name: "Disabled Book",
        enabled: true,
        isGlobal: true,
        chatId: "chat-1",
        scope: { mode: "disabled", chatIds: [] },
      },
      {
        ...baseContext,
        chat: { id: "chat-1", metadata: { activeLorebookIds: ["book-1"] } },
      },
    );

    expect(reasons).toEqual([]);
  });

  it("limits specific scope to listed chats", () => {
    const lorebook = {
      id: "book-1",
      name: "Scoped Book",
      enabled: true,
      isGlobal: true,
      scope: { mode: "specific", chatIds: ["chat-1"] },
    };

    expect(resolveActiveLorebookScopeReasons(lorebook, baseContext)).toHaveLength(1);
    expect(
      resolveActiveLorebookScopeReasons(lorebook, {
        ...baseContext,
        chat: { id: "chat-2", metadata: {} },
      }),
    ).toEqual([]);
  });

  it("allows otherwise unscoped books to be manually selected when the top-level scope allows the chat", () => {
    expect(
      lorebookCanBeSelectedForContext(
        {
          id: "book-1",
          name: "Selectable Book",
          enabled: true,
          scope: { mode: "all", chatIds: [] },
        },
        baseContext,
      ),
    ).toBe(true);
  });

  it("does not offer manual selection when disabled or scoped to another chat", () => {
    expect(
      lorebookCanBeSelectedForContext(
        {
          id: "disabled-book",
          name: "Disabled Book",
          enabled: true,
          scope: { mode: "disabled", chatIds: [] },
        },
        baseContext,
      ),
    ).toBe(false);

    expect(
      lorebookCanBeSelectedForContext(
        {
          id: "other-chat-book",
          name: "Other Chat Book",
          enabled: true,
          scope: { mode: "specific", chatIds: ["chat-2"] },
        },
        baseContext,
      ),
    ).toBe(false);
  });

  it("allows game lorebook keeper books to be selected when game keeper is enabled", () => {
    const keeperBook = {
      id: "keeper-book",
      name: "Keeper Book",
      enabled: true,
      sourceAgentId: "game-lorebook-keeper",
      scope: { mode: "all", chatIds: [] },
    };

    expect(
      lorebookCanBeSelectedForContext(keeperBook, {
        ...baseContext,
        chat: { id: "game-chat", mode: "game", metadata: {} },
      }),
    ).toBe(false);

    expect(
      lorebookCanBeSelectedForContext(keeperBook, {
        ...baseContext,
        chat: { id: "game-chat", mode: "game", metadata: { gameLorebookKeeperEnabled: true } },
      }),
    ).toBe(true);
  });
});
