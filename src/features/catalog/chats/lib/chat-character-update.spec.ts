import { describe, expect, it, vi } from "vitest";

import { completeCharacterTitleUpdate } from "./chat-character-update";

describe("completeCharacterTitleUpdate", () => {
  it("derives a title when membership changes without an explicit name", async () => {
    const loadName = vi.fn(async (id: string) => ({ mira: "Mira", rook: "Rook" })[id] ?? null);

    await expect(
      completeCharacterTitleUpdate(
        { characterIds: ["mira", "rook"] },
        { mode: "conversation" },
        loadName,
      ),
    ).resolves.toEqual({ characterIds: ["mira", "rook"], name: "Mira, Rook" });
    expect(loadName).toHaveBeenCalledTimes(2);
  });

  it("preserves an explicit title without loading character names", async () => {
    const loadName = vi.fn(async () => "unused");

    await expect(
      completeCharacterTitleUpdate(
        { characterIds: ["mira"], name: "Midnight Crew" },
        { mode: "conversation" },
        loadName,
      ),
    ).resolves.toEqual({ characterIds: ["mira"], name: "Midnight Crew" });
    expect(loadName).not.toHaveBeenCalled();
  });

  it("leaves non-membership updates untouched", async () => {
    const loadName = vi.fn(async () => "unused");

    await expect(
      completeCharacterTitleUpdate({ connectionId: "connection-2" }, { mode: "roleplay" }, loadName),
    ).resolves.toEqual({ connectionId: "connection-2" });
  });
});

