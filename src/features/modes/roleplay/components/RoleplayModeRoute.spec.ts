import { describe, expect, it } from "vitest";

import { expressionAvatarOwnerKeysForRoleplay } from "./RoleplayModeRoute";

describe("expressionAvatarOwnerKeysForRoleplay", () => {
  it("keeps the active persona owner when character overlay owners are configured", () => {
    expect(
      expressionAvatarOwnerKeysForRoleplay({
        chatCharIds: ["char-1"],
        personaId: "persona-1",
        spriteOverlayOwnerKeys: ["character:char-1"],
      }),
    ).toEqual(["char-1", "persona:persona-1"]);
  });

  it("deduplicates normalized character and persona owner keys", () => {
    expect(
      expressionAvatarOwnerKeysForRoleplay({
        chatCharIds: ["char-1"],
        personaId: "persona-1",
        spriteOverlayOwnerKeys: ["character:char-1", "char-1", "persona:persona-1"],
      }),
    ).toEqual(["char-1", "persona:persona-1"]);
  });
});
