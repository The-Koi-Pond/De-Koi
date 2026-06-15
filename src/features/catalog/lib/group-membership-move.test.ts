import { describe, expect, it } from "vitest";

import { applyGroupMembershipChangesWithRollback, buildGroupMembershipMoveChanges } from "./group-membership-move";

describe("buildGroupMembershipMoveChanges", () => {
  it("moves a member from its source group to a real target group", () => {
    const changes = buildGroupMembershipMoveChanges({
      groups: [
        { id: "source", memberIds: ["member", "other"] },
        { id: "target", memberIds: ["existing"] },
      ],
      itemId: "member",
      sourceGroupId: "source",
      targetGroupId: "target",
    });

    expect(changes).toEqual([
      { id: "source", previousMemberIds: ["member", "other"], memberIds: ["other"] },
      { id: "target", previousMemberIds: ["existing"], memberIds: ["existing", "member"] },
    ]);
  });

  it("adds a list member to a group without inventing a source removal", () => {
    const changes = buildGroupMembershipMoveChanges({
      groups: [{ id: "target", memberIds: ["existing"] }],
      itemId: "member",
      sourceGroupId: null,
      targetGroupId: "target",
    });

    expect(changes).toEqual([
      { id: "target", previousMemberIds: ["existing"], memberIds: ["existing", "member"] },
    ]);
  });

  it("removes only the dragged source group when dropping to root", () => {
    const changes = buildGroupMembershipMoveChanges({
      groups: [
        { id: "source", memberIds: ["member", "other"] },
        { id: "other-group", memberIds: ["member"] },
      ],
      itemId: "member",
      sourceGroupId: "source",
      targetGroupId: null,
    });

    expect(changes).toEqual([{ id: "source", previousMemberIds: ["member", "other"], memberIds: ["other"] }]);
  });
});

describe("applyGroupMembershipChangesWithRollback", () => {
  it("restores successful writes when a later write fails", async () => {
    const state = new Map([
      ["source", ["member", "other"]],
      ["target", ["existing"]],
    ]);
    const writes: Array<{ id: string; memberIds: string[] }> = [];

    await expect(
      applyGroupMembershipChangesWithRollback(
        [
          { id: "source", previousMemberIds: ["member", "other"], memberIds: ["other"] },
          { id: "target", previousMemberIds: ["existing"], memberIds: ["existing", "member"] },
        ],
        async (change) => {
          writes.push(change);
          if (change.id === "target") throw new Error("target write failed");
          state.set(change.id, change.memberIds);
        },
      ),
    ).rejects.toThrow("target write failed");

    expect(state.get("source")).toEqual(["member", "other"]);
    expect(state.get("target")).toEqual(["existing"]);
    expect(writes).toEqual([
      { id: "source", memberIds: ["other"] },
      { id: "target", memberIds: ["existing", "member"] },
      { id: "source", memberIds: ["member", "other"] },
    ]);
  });
});
