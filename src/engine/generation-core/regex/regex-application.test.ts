import { describe, expect, it } from "vitest";

import { applyRegexScriptsToPromptMessages } from "./regex-application";

const baseScript = {
  enabled: true,
  findRegex: "secret",
  flags: "g",
  replaceString: "visible",
  trimStrings: [],
  placement: ["ai_output"],
  promptOnly: true,
  minDepth: null,
  maxDepth: null,
};

describe("applyRegexScriptsToPromptMessages", () => {
  it("skips character-scoped prompt scripts when there is no active target", () => {
    const messages = [{ role: "assistant", content: "secret" }];

    applyRegexScriptsToPromptMessages(messages, [
      {
        ...baseScript,
        characterId: "char-a",
      },
    ]);

    expect(messages[0]!.content).toBe("secret");
  });

  it("skips character-scoped prompt scripts for other targets", () => {
    const messages = [{ role: "assistant", content: "secret" }];

    applyRegexScriptsToPromptMessages(
      messages,
      [
        {
          ...baseScript,
          characterId: "char-a",
        },
      ],
      { targetCharacterId: "char-b" },
    );

    expect(messages[0]!.content).toBe("secret");
  });

  it("applies character-scoped prompt scripts for the active target", () => {
    const messages = [{ role: "assistant", content: "secret" }];

    applyRegexScriptsToPromptMessages(
      messages,
      [
        {
          ...baseScript,
          characterId: "char-a",
        },
      ],
      { targetCharacterId: "char-a" },
    );

    expect(messages[0]!.content).toBe("visible");
  });

  it("applies legacy targetCharacterIds arrays for matching targets", () => {
    const messages = [{ role: "assistant", content: "secret" }];

    applyRegexScriptsToPromptMessages(
      messages,
      [
        {
          ...baseScript,
          targetCharacterIds: ["char-a", "char-c"],
        },
      ],
      { targetCharacterId: "char-c" },
    );

    expect(messages[0]!.content).toBe("visible");
  });
});
