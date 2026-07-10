import { describe, expect, it } from "vitest";

import { deriveChatTitle } from "./chat-title";

describe("deriveChatTitle", () => {
  it("uses the mode fallback when no characters remain", () => {
    expect(deriveChatTitle("conversation", [])).toBe("New Conversation");
    expect(deriveChatTitle("roleplay", [])).toBe("New Roleplay");
    expect(deriveChatTitle("game", [])).toBe("New Game");
  });

  it("joins trimmed unique character names in membership order", () => {
    expect(deriveChatTitle("conversation", [" Mira ", "Rook", "Mira", ""])).toBe("Mira, Rook");
  });
});
