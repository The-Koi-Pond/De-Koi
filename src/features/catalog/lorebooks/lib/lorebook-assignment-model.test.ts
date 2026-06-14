import { describe, expect, it } from "vitest";

import { eligibleScopeChatIds, normalizeLorebookScope, ownerCreateDefaultCategory } from "./lorebook-assignment-model";

describe("lorebook assignment model", () => {
  it("prunes stale and other-owner chat ids before saving a specific scope", () => {
    expect(
      eligibleScopeChatIds(["other-owner-chat", " owner-chat ", "missing-chat", "owner-chat"], [{ id: "owner-chat" }]),
    ).toEqual(["owner-chat"]);
  });

  it("rejects specific scope when no stored chat ids are eligible for the owner", () => {
    expect(eligibleScopeChatIds(["other-owner-chat", "deleted-chat"], [{ id: "owner-chat" }])).toEqual([]);
  });

  it("keeps stored specific chat ids while eligibility data is still loading", () => {
    const draftChatIds = normalizeLorebookScope({ mode: "specific", chatIds: ["owner-chat"] }).chatIds;

    expect(draftChatIds).toEqual(["owner-chat"]);
    expect(eligibleScopeChatIds(draftChatIds, [])).toEqual([]);
    expect(eligibleScopeChatIds(draftChatIds, [{ id: "owner-chat" }])).toEqual(["owner-chat"]);
  });

  it("uses non-character category defaults for persona-created lorebooks", () => {
    expect(ownerCreateDefaultCategory("character")).toBe("character");
    expect(ownerCreateDefaultCategory("persona")).toBe("uncategorized");
  });
});
