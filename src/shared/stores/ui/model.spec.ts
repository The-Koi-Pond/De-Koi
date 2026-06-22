import { describe, expect, it } from "vitest";

import { normalizeUserQuickReplyActions } from "./model";

describe("normalizeUserQuickReplyActions", () => {
  it("keeps mode-scoped Game quick reply actions", () => {
    const [action] = normalizeUserQuickReplyActions([
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

    expect(action).toMatchObject({
      id: "game-action",
      scope: "mode",
      mode: "game",
    });
  });
});