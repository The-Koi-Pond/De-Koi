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

  it("allows manually selected lorebook with no owner links to activate", () => {
    const reasons = resolveActiveLorebookScopeReasons(
      {
        id: "book-1",
        name: "No Owner",
        enabled: true,
        scope: { mode: "all", chatIds: [] },
      },
      {
        ...baseContext,
        chat: { id: "chat-1", metadata: { activeLorebookIds: ["book-1"] } },
      },
    );
    expect(reasons).toHaveLength(1);
    expect(reasons[0]!.reason).toBe("selected");
  });

  it("gates manually selected lorebook behind owner-link match when character links exist", () => {
    // Owner link matches — should activate
    const matchReasons = resolveActiveLorebookScopeReasons(
      {
        id: "book-1",
        name: "Char Matches",
        enabled: true,
        characterId: "char-1",
        scope: { mode: "all", chatIds: [] },
      },
      {
        ...baseContext,
        chat: { id: "chat-1", metadata: { activeLorebookIds: ["book-1"] } },
        characters: [{ id: "char-1" }],
      },
    );
    expect(matchReasons.some((r) => r.reason === "selected")).toBe(true);

    // Owner link does NOT match — should NOT activate
    const noMatchReasons = resolveActiveLorebookScopeReasons(
      {
        id: "book-1",
        name: "Char No Match",
        enabled: true,
        characterId: "char-1",
        scope: { mode: "all", chatIds: [] },
      },
      {
        ...baseContext,
        chat: { id: "chat-1", metadata: { activeLorebookIds: ["book-1"] } },
        characters: [{ id: "char-2" }],
      },
    );
    expect(noMatchReasons).toEqual([]);
  });

  it("gates manually selected lorebook behind owner-link match when persona links exist", () => {
    // Persona link matches — should activate
    const matchReasons = resolveActiveLorebookScopeReasons(
      {
        id: "book-1",
        name: "Persona Matches",
        enabled: true,
        personaId: "pers-1",
        scope: { mode: "all", chatIds: [] },
      },
      {
        chat: { id: "chat-1", personaId: "pers-1", metadata: { activeLorebookIds: ["book-1"] } },
        characters: [{ id: "char-1" }],
        persona: { id: "pers-1" },
      },
    );
    expect(matchReasons.some((r) => r.reason === "selected")).toBe(true);

    // Persona link does NOT match — should NOT activate
    const noMatchReasons = resolveActiveLorebookScopeReasons(
      {
        id: "book-1",
        name: "Persona No Match",
        enabled: true,
        personaId: "pers-1",
        scope: { mode: "all", chatIds: [] },
      },
      {
        chat: { id: "chat-1", personaId: "pers-2", metadata: { activeLorebookIds: ["book-1"] } },
        characters: [{ id: "char-1" }],
        persona: null,
      },
    );
    expect(noMatchReasons).toEqual([]);
  });

  it("gates manually selected lorebook behind owner-link match when chat link exists", () => {
    // Chat link matches — should activate
    const matchReasons = resolveActiveLorebookScopeReasons(
      {
        id: "book-1",
        name: "Chat Matches",
        enabled: true,
        chatId: "chat-1",
        scope: { mode: "all", chatIds: [] },
      },
      {
        ...baseContext,
        chat: { id: "chat-1", metadata: { activeLorebookIds: ["book-1"] } },
      },
    );
    expect(matchReasons.some((r) => r.reason === "selected")).toBe(true);

    // Chat link does NOT match — should NOT activate
    const noMatchReasons = resolveActiveLorebookScopeReasons(
      {
        id: "book-1",
        name: "Chat No Match",
        enabled: true,
        chatId: "chat-1",
        scope: { mode: "all", chatIds: [] },
      },
      {
        ...baseContext,
        chat: { id: "chat-2", metadata: { activeLorebookIds: ["book-1"] } },
      },
    );
    expect(noMatchReasons).toEqual([]);
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
