import { describe, expect, it } from "vitest";

import { buildPromptBlocks, shownMessages, splitTaggedSections } from "./prompt-blocks";

const split = (text: string) =>
  splitTaggedSections(text, "System", "system").map(({ label, content }) => [label, content]);

describe("splitTaggedSections", () => {
  it("splits tagged sections out of the text around them, keeping the tags in the content", () => {
    expect(
      split("Intro.\n<system_prompt>\nYou are Wren.\n</system_prompt>\nBetween.\n\n<rules>\nBe kind.\n</rules>"),
    ).toEqual([
      ["System", "Intro."],
      ["system_prompt", "<system_prompt>\nYou are Wren.\n</system_prompt>"],
      ["System", "Between."],
      ["rules", "<rules>\nBe kind.\n</rules>"],
    ]);
  });

  it("finds sections separated by a blank line but not a section on the very next line", () => {
    expect(split("<a>\none\n</a>\n\n<b>\ntwo\n</b>")).toEqual([
      ["a", "<a>\none\n</a>"],
      ["b", "<b>\ntwo\n</b>"],
    ]);
    expect(split("<a>\none\n</a>\n<b>\ntwo\n</b>")).toEqual([
      ["a", "<a>\none\n</a>"],
      ["System", "<b>\ntwo\n</b>"],
    ]);
  });

  it("matches names in any case, keeps the opening tag's spelling and ends at the first closing tag", () => {
    expect(split("<Lore>\nfirst\n</LORE>")).toEqual([["Lore", "<Lore>\nfirst\n</LORE>"]]);
    expect(split("<x>\n<x>\ninner\n</x>\nrest\n</x>")).toEqual([
      ["x", "<x>\n<x>\ninner\n</x>"],
      ["System", "rest\n</x>"],
    ]);
  });

  it("ignores attributes, inline tags, empty tags, digit names and CRLF line ends", () => {
    for (const text of [
      '<a id="1">\nx\n</a>',
      "<a>x</a>",
      "<t>\n</t>",
      "<1abc>\nx\n</1abc>",
      "<a>\r\nx\r\n</a>",
      "before <a>\nx\n</a>",
    ]) {
      expect(split(text)).toEqual([["System", text]]);
    }
  });

  it("keeps a blank message as one untrimmed fallback block", () => {
    expect(split("   ")).toEqual([["System", "   "]]);
    expect(split("")).toEqual([["System", ""]]);
  });

  it("trims trailing whitespace from a section but keeps its inner layout", () => {
    expect(split("<a>\n  indented\n</a>\n")).toEqual([["a", "<a>\n  indented\n</a>"]]);
  });
});

describe("buildPromptBlocks", () => {
  it("groups runs of history messages when messages carry context kinds", () => {
    const blocks = buildPromptBlocks([
      { role: "system", content: "Main.", contextKind: "prompt", displayName: "Main Prompt" },
      { role: "user", content: " Hi ", contextKind: "history" },
      { role: "assistant", content: "   ", contextKind: "history" },
      { role: "system", content: "Tracker text\n", contextKind: "injection", displayName: "Trackers" },
      { role: "user", content: "<last_message>\nWhat now?\n</last_message>", contextKind: "prompt" },
    ]);
    expect(blocks).toEqual([
      { kind: "section", label: "Main Prompt", role: "system", content: "Main." },
      { kind: "history", entries: [{ role: "user", content: "Hi" }] },
      { kind: "section", label: "Trackers", role: "system", content: "Tracker text" },
      { kind: "section", label: "last_message", role: "user", content: "What now?" },
    ]);
  });

  it("finds the chat history and last message across older snapshots", () => {
    const blocks = buildPromptBlocks([
      { role: "system", content: "Rules." },
      { role: "system", content: "<chat_history>\nuser: hi" },
      { role: "assistant", content: "hello\n</chat_history>" },
      { role: "user", content: "## Last Message\nNow?" },
    ]);
    expect(blocks).toEqual([
      { kind: "section", label: "system", role: "system", content: "Rules." },
      {
        kind: "history",
        entries: [
          { role: "system", content: "user: hi" },
          { role: "assistant", content: "hello" },
        ],
      },
      { kind: "section", label: "last_message", role: "user", content: "Now?" },
    ]);
  });

  describe("older snapshots (pinned old behavior)", () => {
    type Message = Parameters<typeof buildPromptBlocks>[0][number];
    const summary = (messages: Message[]) =>
      buildPromptBlocks(messages).map((block) =>
        block.kind === "history"
          ? ["history", block.entries.map((entry) => entry.content)]
          : [block.label, block.content],
      );

    it("ends an unclosed history right before a later last message, even when that is the start itself", () => {
      expect(
        summary([
          { role: "system", content: "Rules." },
          { role: "assistant", content: "## Chat History\nhello" },
          { role: "user", content: "## Last Message\nhi" },
        ]),
      ).toEqual([
        ["system", "Rules."],
        ["history", ["hello"]],
        ["last_message", "hi"],
      ]);
      expect(
        summary([
          { role: "assistant", content: "<chat_history>\nHello" },
          { role: "user", content: "<last_message>\nHi\n</last_message>" },
        ]),
      ).toEqual([
        ["history", ["Hello"]],
        ["last_message", "Hi"],
      ]);
    });

    it("reads a `## Chat History` heading in any case and removes it in any case", () => {
      expect(
        summary([
          { role: "user", content: "## chat history\nhello" },
          { role: "assistant", content: "there" },
        ]),
      ).toEqual([["history", ["hello", "there"]]]);
    });

    it("removes only the literal heading and at most one newline after it", () => {
      expect(summary([{ role: "user", content: "## Last Message:\n<last_message>\nhi" }])).toEqual([
        ["last_message", ":\n<last_message>\nhi"],
      ]);
      expect(summary([{ role: "user", content: "## Last message\n\nhi" }])).toEqual([["last_message", "hi"]]);
      expect(
        summary([
          { role: "user", content: "<chat_history>\nfirst" },
          { role: "user", content: "## Chat History (recent)\nhello" },
          { role: "assistant", content: "</chat_history>" },
        ]),
      ).toEqual([["history", ["first", "(recent)\nhello"]]]);
    });
  });

  it("finds `<last_message>` tags in the original text, so length-changing case folds don't shift them", () => {
    const blocks = buildPromptBlocks([
      {
        role: "user",
        content: "Trip to İstanbul\n<last_message>\nWhere next?\n</last_message>",
        contextKind: "prompt",
      },
    ]);
    expect(blocks.map((block) => (block.kind === "section" ? block.content : null))).toEqual([
      "Trip to İstanbul",
      "Where next?",
    ]);
  });
});

describe("shownMessages", () => {
  it("uses preview messages whenever they have a length, whatever their type", () => {
    const messages = [{ role: "user", content: "a" }];
    expect(shownMessages({ messages, previewMessages: [] })).toBe(messages);
    expect(shownMessages({ messages, previewMessages: undefined })).toBe(messages);
    expect(shownMessages({ messages, previewMessages: "abc" as never })).toBe("abc");
  });
});
