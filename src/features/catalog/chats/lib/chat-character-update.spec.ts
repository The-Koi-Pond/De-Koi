import { describe, expect, it, vi } from "vitest";

import { completeCharacterTitleUpdate } from "./chat-character-update";

const names: Record<string, string> = { mira: "Mira", rook: "Rook" };
const loadName = () => vi.fn(async (id: string) => names[id] ?? null);

describe("completeCharacterTitleUpdate", () => {
  it("derives a title for a chat still on its mode fallback title", async () => {
    await expect(
      completeCharacterTitleUpdate(
        { characterIds: ["mira", "rook"] },
        { mode: "conversation", name: "New Conversation", characterIds: [] },
        loadName(),
      ),
    ).resolves.toEqual({ characterIds: ["mira", "rook"], name: "Mira, Rook" });
  });

  it("re-derives a title that still matches the previous characters", async () => {
    await expect(
      completeCharacterTitleUpdate(
        { characterIds: ["mira", "rook"] },
        { mode: "conversation", name: "Mira", characterIds: JSON.stringify(["mira"]) },
        loadName(),
      ),
    ).resolves.toEqual({ characterIds: ["mira", "rook"], name: "Mira, Rook" });
  });

  it("derives a title for a blank name", async () => {
    await expect(
      completeCharacterTitleUpdate({ characterIds: ["rook"] }, { mode: "roleplay", name: "  " }, loadName()),
    ).resolves.toEqual({ characterIds: ["rook"], name: "Rook" });
  });

  it("keeps a name the user typed when characters change", async () => {
    await expect(
      completeCharacterTitleUpdate(
        { characterIds: ["mira"] },
        { mode: "conversation", name: "[Test] Mira", characterIds: [] },
        loadName(),
      ),
    ).resolves.toEqual({ characterIds: ["mira"] });

    await expect(
      completeCharacterTitleUpdate(
        { characterIds: ["mira", "rook"] },
        { mode: "roleplay", name: "Scene: Knives, No Audience", characterIds: ["mira"] },
        loadName(),
      ),
    ).resolves.toEqual({ characterIds: ["mira", "rook"] });
  });

  it("keeps the name instead of deriving from a partial roster", async () => {
    // "ghost" fails to load: never mint "Mira" for a Mira + ghost chat.
    await expect(
      completeCharacterTitleUpdate(
        { characterIds: ["mira", "ghost"] },
        { mode: "conversation", name: "New Conversation", characterIds: [] },
        loadName(),
      ),
    ).resolves.toEqual({ characterIds: ["mira", "ghost"] });

    // A failed lookup on the previous roster cannot prove the current name is automatic.
    await expect(
      completeCharacterTitleUpdate(
        { characterIds: ["mira", "rook"] },
        { mode: "conversation", name: "Mira", characterIds: ["mira", "ghost"] },
        loadName(),
      ),
    ).resolves.toEqual({ characterIds: ["mira", "rook"] });
  });

  it("keeps the name and still saves membership when a lookup throws", async () => {
    const load = vi.fn(async (id: string) => {
      if (id === "rook") throw new Error("character read failed");
      return names[id] ?? null;
    });

    await expect(
      completeCharacterTitleUpdate(
        { characterIds: ["mira", "rook"] },
        { mode: "conversation", name: "Mira", characterIds: ["mira"] },
        load,
      ),
    ).resolves.toEqual({ characterIds: ["mira", "rook"] });
  });

  it("keeps the name when the current chat is unknown", async () => {
    const load = loadName();

    await expect(completeCharacterTitleUpdate({ characterIds: ["mira"] }, null, load)).resolves.toEqual({
      characterIds: ["mira"],
    });
    await expect(
      completeCharacterTitleUpdate({ characterIds: ["mira"] }, { mode: "conversation" }, load),
    ).resolves.toEqual({ characterIds: ["mira"] });
    expect(load).not.toHaveBeenCalled();
  });

  it("preserves an explicit title without loading character names", async () => {
    const load = loadName();

    await expect(
      completeCharacterTitleUpdate(
        { characterIds: ["mira"], name: "Midnight Crew" },
        { mode: "conversation", name: "New Conversation" },
        load,
      ),
    ).resolves.toEqual({ characterIds: ["mira"], name: "Midnight Crew" });
    expect(load).not.toHaveBeenCalled();
  });

  it("leaves non-membership updates untouched", async () => {
    const load = loadName();

    await expect(
      completeCharacterTitleUpdate({ connectionId: "connection-2" }, { mode: "roleplay", name: "Rook" }, load),
    ).resolves.toEqual({ connectionId: "connection-2" });
    expect(load).not.toHaveBeenCalled();
  });
});
