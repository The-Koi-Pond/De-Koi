import { describe, expect, it } from "vitest";
import { resolveActiveLorebookScopeReasons } from "./active-lorebook-scope";

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
});
