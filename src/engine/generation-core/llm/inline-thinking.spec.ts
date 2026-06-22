import { describe, expect, it } from "vitest";

import { createInlineThinkingStreamParser, extractLeadingThinkingBlocks } from "./inline-thinking";

function parseStream(chunks: string[], options?: Parameters<typeof createInlineThinkingStreamParser>[0]) {
  const parser = createInlineThinkingStreamParser(options);
  return [...chunks.flatMap((chunk) => parser.push(chunk)), ...parser.flush()];
}

describe("createInlineThinkingStreamParser", () => {
  it("extracts built-in leading thinking tags from streamed content", () => {
    expect(parseStream(["<think>hidden", "</think>Visible"])).toEqual([
      { type: "thinking", text: "hidden" },
      { type: "content", text: "Visible" },
    ]);
  });

  it("extracts configured custom thinking tags from streamed content", () => {
    expect(
      parseStream(["<analysis>hidden", "</analysis>Visible"], {
        customThinkingTags: [{ open: "<analysis>", close: "</analysis>" }],
      }),
    ).toEqual([
      { type: "thinking", text: "hidden" },
      { type: "content", text: "Visible" },
    ]);
  });

  it("extracts bracketed colon thinking tags from streamed content", () => {
    expect(parseStream(["[thought: hidden planning]Visible"])).toEqual([
      { type: "thinking", text: "hidden planning" },
      { type: "content", text: "Visible" },
    ]);
  });

  it("keeps game-style thought narration tags visible mid-text", () => {
    // [thought] is a common narration/emote bracket in roleplay and game text.
    // It must NOT be treated as a thinking opener when it appears after visible
    // content — only leading [thought]...[/thought] pairs are thinking tags.
    const parts = parseStream(["[Mira] [thought] [smirk]: Private in-world narration."]);

    expect(parts.filter((part) => part.type === "thinking")).toEqual([]);
    expect(parts.map((part) => part.text).join("")).toBe("[Mira] [thought] [smirk]: Private in-world narration.");
  });

  describe("pipe-style thinking tags", () => {
    it("extracts <|think|> pipe-style thinking tag", () => {
      expect(parseStream(["<|think|>hidden", "<|/think|>Visible"])).toEqual([
        { type: "thinking", text: "hidden" },
        { type: "content", text: "Visible" },
      ]);
    });

    it("extracts <|thinking|> pipe-style thinking tag", () => {
      expect(parseStream(["<|thinking|>hidden", "<|/thinking|>Visible"])).toEqual([
        { type: "thinking", text: "hidden" },
        { type: "content", text: "Visible" },
      ]);
    });

    it("extracts <|thought|> pipe-style thinking tag", () => {
      expect(parseStream(["<|thought|>hidden", "<|/thought|>Visible"])).toEqual([
        { type: "thinking", text: "hidden" },
        { type: "content", text: "Visible" },
      ]);
    });

    it("extracts pipe think tag across streaming chunks", () => {
      expect(parseStream(["<|thin", "k|>hidden<|/", "think|>Visible"])).toEqual([
        { type: "thinking", text: "hidden" },
        { type: "content", text: "Visible" },
      ]);
    });

    it("consumes orphan <|/think|> silently outside thinking mode", () => {
      // Orphan tag is consumed silently; adjacent content may be split across parts
      const parts = parseStream(["before<|/think|>after"]);
      expect(parts.map((p) => p.text).join("")).toBe("beforeafter");
      expect(parts.every((p) => p.type === "content")).toBe(true);
    });
  });

  describe("pipe channel thinking tags", () => {
    it("extracts <|channel>thought...<channel|> tag", () => {
      expect(parseStream(["<|channel>thought hidden<channel|>Visible"])).toEqual([
        { type: "thinking", text: " hidden" },
        { type: "content", text: "Visible" },
      ]);
    });

    it("extracts channel tag across streaming chunks", () => {
      expect(parseStream(["<|channel>", "thought hid", "den<channel|>Visible"])).toEqual([
        { type: "thinking", text: " hid" },
        { type: "thinking", text: "den" },
        { type: "content", text: "Visible" },
      ]);
    });

    it("consumes orphan <channel|> silently outside thinking mode", () => {
      const parts = parseStream(["before<channel|>after"]);
      expect(parts.map((p) => p.text).join("")).toBe("beforeafter");
      expect(parts.every((p) => p.type === "content")).toBe(true);
    });
  });

  describe("bracket open/close thinking pairs", () => {
    it("extracts [thinking]...[/thinking] bracket pair", () => {
      expect(parseStream(["[thinking]hidden[/thinking]Visible"])).toEqual([
        { type: "thinking", text: "hidden" },
        { type: "content", text: "Visible" },
      ]);
    });

    it("extracts [think]...[/think] bracket pair", () => {
      expect(parseStream(["[think]hidden[/think]Visible"])).toEqual([
        { type: "thinking", text: "hidden" },
        { type: "content", text: "Visible" },
      ]);
    });

    it("extracts [thought]...[/thought] bracket pair", () => {
      expect(parseStream(["[thought]hidden[/thought]Visible"])).toEqual([
        { type: "thinking", text: "hidden" },
        { type: "content", text: "Visible" },
      ]);
    });

    it("does not shadow the colon form [tag: content]", () => {
      // Colon form must still work: [thinking: inline] is a thinking part,
      // NOT a thinking mode opener.
      const parts = parseStream(["[thinking: inline]Visible"]);
      expect(parts).toEqual([
        { type: "thinking", text: "inline" },
        { type: "content", text: "Visible" },
      ]);
    });

    it("treats bracket open/close as distinct from colon form", () => {
      // Colon form is checked first: [thinking: inline] should be consumed
      // as a colon thinking tag. The orphan [/thinking] after visible content
      // is NOT consumed (past leading zone).
      const parts = parseStream(["[thinking: inline]after[/thinking]"]);
      const thinking = parts
        .filter((p) => p.type === "thinking")
        .map((p) => p.text)
        .join("");
      const content = parts
        .filter((p) => p.type === "content")
        .map((p) => p.text)
        .join("");
      expect(thinking).toBe("inline");
      expect(content).toBe("after[/thinking]");
    });

    it("extracts bracket pair across streaming chunks", () => {
      expect(parseStream(["[thin", "king]hid", "den[/thin", "king]Visible"])).toEqual([
        { type: "thinking", text: "hid" },
        { type: "thinking", text: "den" },
        { type: "content", text: "Visible" },
      ]);
    });

    it("extracts bracket pair when the close delimiter is split at its prefix", () => {
      for (const chunks of [
        ["[thinking]hidden[", "/thinking]Visible"],
        ["[thinking]hidden[/", "thinking]Visible"],
      ]) {
        expect(parseStream(chunks)).toEqual([
          { type: "thinking", text: "hidden" },
          { type: "content", text: "Visible" },
        ]);
      }
    });

    it("consumes orphan [/thinking] silently in the leading zone", () => {
      // Leading orphan close (no prior visible content) is consumed.
      const parts = parseStream(["[/thinking]after"]);
      expect(parts.map((p) => p.text).join("")).toBe("after");
      expect(parts.every((p) => p.type === "content")).toBe(true);
    });

    it("keeps orphan [/thinking] visible after content", () => {
      // Past the leading zone, [/thinking] is narration, not a stray close.
      const parts = parseStream(["before[/thinking]after"]);
      expect(parts.map((p) => p.text).join("")).toBe("before[/thinking]after");
      expect(parts.every((p) => p.type === "content")).toBe(true);
    });
  });
});

describe("extractLeadingThinkingBlocks", () => {
  it("strips leading standard XML thinking block from JSON text", () => {
    const result = extractLeadingThinkingBlocks('<think>reasoning</think>\n{"a":1}');
    expect(result.cleanText).toBe('\n{"a":1}');
    expect(result.leadingThinking).toBe("<think>reasoning</think>");
  });

  it("strips leading standard XML thinking block with built-in close alias", () => {
    const result = extractLeadingThinkingBlocks("<thinking>reasoning</think>Content");
    expect(result.cleanText).toBe("Content");
    expect(result.leadingThinking).toBe("<thinking>reasoning</think>");
  });

  it("strips leading pipe think block", () => {
    const result = extractLeadingThinkingBlocks('<|think|>reasoning<|/think|>\n{"a":1}');
    expect(result.cleanText).toBe('\n{"a":1}');
    expect(result.leadingThinking).toBe("<|think|>reasoning<|/think|>");
  });

  it("strips leading pipe thinking block with built-in close alias", () => {
    const result = extractLeadingThinkingBlocks("<|thinking|>reasoning<|/think|>Content");
    expect(result.cleanText).toBe("Content");
    expect(result.leadingThinking).toBe("<|thinking|>reasoning<|/think|>");
  });

  it("strips leading pipe channel block", () => {
    const result = extractLeadingThinkingBlocks('<|channel>thought reasoning<channel|>\n{"a":1}');
    expect(result.cleanText).toBe('\n{"a":1}');
    expect(result.leadingThinking).toBe("<|channel>thought reasoning<channel|>");
  });

  it("strips leading bracket pair block", () => {
    const result = extractLeadingThinkingBlocks('[thinking]reasoning[/thinking]\n{"a":1}');
    expect(result.cleanText).toBe('\n{"a":1}');
    expect(result.leadingThinking).toBe("[thinking]reasoning[/thinking]");
  });

  it("strips leading bracket pair block with built-in close alias", () => {
    const result = extractLeadingThinkingBlocks("[thinking]reasoning[/think]Content");
    expect(result.cleanText).toBe("Content");
    expect(result.leadingThinking).toBe("[thinking]reasoning[/think]");
  });

  it("strips leading bracket colon form", () => {
    const result = extractLeadingThinkingBlocks("[thought: reasoning]\nText");
    expect(result.cleanText).toBe("\nText");
    expect(result.leadingThinking).toBe("[thought: reasoning]");
  });

  it("strips multiple leading thinking blocks", () => {
    const result = extractLeadingThinkingBlocks("<think>first</think><think>second</think>Content");
    expect(result.cleanText).toBe("Content");
    expect(result.leadingThinking).toBe("<think>first</think><think>second</think>");
  });

  it("strips leading custom thinking block", () => {
    const result = extractLeadingThinkingBlocks("<analysis>deep</analysis>Result", [
      { open: "<analysis>", close: "</analysis>" },
    ]);
    expect(result.cleanText).toBe("Result");
    expect(result.leadingThinking).toBe("<analysis>deep</analysis>");
  });

  it("returns empty cleanText when entire text is a thinking block", () => {
    const result = extractLeadingThinkingBlocks("<think>everything</think>");
    expect(result.cleanText).toBe("");
    expect(result.leadingThinking).toBe("<think>everything</think>");
  });

  it("returns unchanged text when no leading thinking block is present", () => {
    const result = extractLeadingThinkingBlocks("Hello world");
    expect(result.cleanText).toBe("Hello world");
    expect(result.leadingThinking).toBe("");
  });

  it("ignores thinking blocks in the middle of text", () => {
    const result = extractLeadingThinkingBlocks("Start <think>middle</think> End");
    expect(result.cleanText).toBe("Start <think>middle</think> End");
    expect(result.leadingThinking).toBe("");
  });
});
