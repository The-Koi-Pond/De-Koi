import { describe, expect, it } from "vitest";
import { findPersonaSnapshotForChat } from "./persona-snapshot";

describe("findPersonaSnapshotForChat", () => {
  it("keeps the persona's name and look, not its card text", () => {
    const persona = {
      id: "persona-1",
      data: {
        name: "Chai",
        description: "A long description",
        personality: "Warm",
        backstory: "Grew up by the pond",
        appearance: "Tall",
        scenario: "At home",
        avatarPath: "/avatars/chai.png",
        nameColor: "#ff0000",
      },
    };

    expect(findPersonaSnapshotForChat([persona], { personaId: "persona-1" })).toEqual({
      personaId: "persona-1",
      name: "Chai",
      avatarUrl: "/avatars/chai.png",
      avatarFilePath: null,
      avatarFilename: null,
      avatarCrop: null,
      nameColor: "#ff0000",
      dialogueColor: null,
      boxColor: null,
    });
  });
});
