import { describe, expect, it } from "vitest";

import { buildCharacterImportUpdatePlan } from "./character-import-model";

describe("buildCharacterImportUpdatePlan", () => {
  it("carries managed avatar ownership metadata when updating from an imported character", () => {
    const plan = buildCharacterImportUpdatePlan(
      {
        id: "target-character",
        data: {
          name: "Target Character",
          description: "Original description",
          character_version: "1.0",
        },
        comment: "Original comment",
        avatarPath: "asset://old-avatar.png",
        avatarFilePath: "C:/De-Koi/avatars/characters/old-avatar.png",
        avatarFilename: "old-avatar.png",
      },
      {
        id: "temporary-import",
        data: {
          name: "Imported Character",
          description: "Imported description",
        },
        comment: "Imported comment",
        avatarPath: "asset://imported-avatar.png",
        avatarFilePath: "C:/De-Koi/avatars/characters/imported-avatar.png",
        avatarFilename: "imported-avatar.png",
      },
      "imported-card.json",
    );

    expect(plan.patch).toMatchObject({
      id: "target-character",
      avatarPath: "asset://imported-avatar.png",
      avatarFilePath: "C:/De-Koi/avatars/characters/imported-avatar.png",
      avatarFilename: "imported-avatar.png",
    });
    expect(plan.snapshot).toMatchObject({
      characterId: "target-character",
      avatarPath: "asset://old-avatar.png",
      avatarFilePath: "C:/De-Koi/avatars/characters/old-avatar.png",
      avatarFilename: "old-avatar.png",
    });
  });
});
