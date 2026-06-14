import { describe, expect, it } from "vitest";

import { eligibleScopeChatIds, ownerCreateDefaultCategory } from "./lorebook-assignment-model";

describe("lorebook assignment model", () => {
  it("prunes stale and other-owner chat ids before saving a specific scope", () => {
    expect(
      eligibleScopeChatIds(["other-owner-chat", " owner-chat ", "missing-chat", "owner-chat"], [{ id: "owner-chat" }]),
    ).toEqual(["owner-chat"]);
  });

  it("rejects specific scope when no stored chat ids are eligible for the owner", () => {
    expect(eligibleScopeChatIds(["other-owner-chat", "deleted-chat"], [{ id: "owner-chat" }])).toEqual([]);
  });

  it("uses non-character category defaults for persona-created lorebooks", () => {
    expect(ownerCreateDefaultCategory("character")).toBe("character");
    expect(ownerCreateDefaultCategory("persona")).toBe("uncategorized");
  });
});
