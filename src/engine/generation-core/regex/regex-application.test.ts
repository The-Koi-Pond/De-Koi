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
  it("rewrites chat history only, never De-Koi's own prompt text", () => {
    // The script every install seeds (src-tauri/src/seed_defaults.rs, "Clean HTML (Outgoing Prompt)").
    const cleanHtml = {
      ...baseScript,
      findRegex: "[ \\t]?<(?!--)(?!\\/?(?:font|lie|filter)\\b)(?:\"[^\"]*\"|'[^']*'|[^'\">])*>",
      replaceString: "",
      placement: ["user_input", "ai_output"],
    };
    const messages = [
      { role: "system", content: "<character>Mira <b>glows</b></character>", contextKind: "prompt" },
      { role: "system", content: "<memories>\nMira owes Jo a song.\n</memories>", contextKind: "memory_recall" },
      {
        role: "system",
        content: "<story_continuity>\n- [episode] The fair\n</story_continuity>",
        contextKind: "story_projection",
      },
      { role: "assistant", content: "<p>Hello Jo</p>", contextKind: "history" },
      { role: "user", content: "<i>Sing it</i>", contextKind: "history" },
    ];

    applyRegexScriptsToPromptMessages(messages, [cleanHtml]);

    expect(messages.map((message) => message.content)).toEqual([
      "<character>Mira <b>glows</b></character>",
      "<memories>\nMira owes Jo a song.\n</memories>",
      "<story_continuity>\n- [episode] The fair\n</story_continuity>",
      "Hello Jo",
      "Sing it",
    ]);
  });

  it("skips character-scoped prompt scripts when there is no active target", () => {
    const messages = [{ role: "assistant", content: "secret", contextKind: "history" }];

    applyRegexScriptsToPromptMessages(messages, [
      {
        ...baseScript,
        characterId: "char-a",
      },
    ]);

    expect(messages[0]!.content).toBe("secret");
  });

  it("skips character-scoped prompt scripts for other targets", () => {
    const messages = [{ role: "assistant", content: "secret", contextKind: "history" }];

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
    const messages = [{ role: "assistant", content: "secret", contextKind: "history" }];

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

  it("treats character-scoped scripts as prompt-only even when stored promptOnly is false", () => {
    const messages = [{ role: "assistant", content: "secret", contextKind: "history" }];

    applyRegexScriptsToPromptMessages(
      messages,
      [
        {
          ...baseScript,
          promptOnly: false,
          characterId: "char-a",
        },
      ],
      { targetCharacterId: "char-a" },
    );

    expect(messages[0]!.content).toBe("visible");
  });

  it("applies legacy targetCharacterIds arrays for matching targets", () => {
    const messages = [{ role: "assistant", content: "secret", contextKind: "history" }];

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

  it("keeps display-only scripts out of the prompt and applies scoped Both scripts to it", () => {
    const messages = [{ role: "assistant", content: "secret", contextKind: "history" }];

    applyRegexScriptsToPromptMessages(messages, [{ ...baseScript, promptOnly: false, applyMode: "display" }]);
    expect(messages[0]!.content).toBe("secret");

    applyRegexScriptsToPromptMessages(
      messages,
      [{ ...baseScript, promptOnly: false, applyMode: "both", characterId: "char-a" }],
      { targetCharacterId: "char-a" },
    );
    expect(messages[0]!.content).toBe("visible");
  });
});
