import { describe, expect, it } from "vitest";

import { createInputMacroResolverForChat } from "./chat-macros";

describe("chat macro description extensions", () => {
  it("keeps character description macros on the base character description", () => {
    const resolve = createInputMacroResolverForChat(
      { characterIds: ["char-1"], mode: "roleplay" },
      [
        {
          id: "char-1",
          data: {
            name: "Mira",
            description: "Base character description.",
            altDescriptions: [{ active: true, content: "Character alternate description." }],
            extensions: {
              altDescriptions: [{ active: true, content: "Legacy extension alternate description." }],
            },
          },
        },
      ],
      [],
    );

    expect(resolve("{{description}}")).toBe("Base character description.");
  });

  it("appends active persona alt descriptions to the persona macro", () => {
    const resolve = createInputMacroResolverForChat(
      { personaId: "persona-1", mode: "roleplay" },
      [],
      [
        {
          id: "persona-1",
          name: "Pilot",
          description: "Base persona description.",
          altDescriptions: [
            { active: true, content: "Active persona detail." },
            { active: false, content: "Inactive persona detail." },
            { active: true, content: "   " },
          ],
        },
      ],
    );

    expect(resolve("{{persona}}")).toBe("Base persona description.\nActive persona detail.");
  });
});
