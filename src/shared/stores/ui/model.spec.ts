import { describe, expect, it } from "vitest";

import { normalizeUserQuickReplyActions } from "./model";

describe("normalizeUserQuickReplyActions", () => {
  it("drops quick replies scoped to the removed Game mode", () => {
    const actions = normalizeUserQuickReplyActions([
      {
        id: "game-action",
        label: "Scout",
        iconId: "dices",
        commandTemplate: "/guided scout the room",
        includeDraft: false,
        scope: "mode",
        mode: "game",
        enabled: true,
      },
    ]);

    expect(actions).toEqual([]);
  });
});
