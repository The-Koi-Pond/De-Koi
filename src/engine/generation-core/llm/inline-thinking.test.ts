import { describe, expect, it } from "vitest";
import { createInlineThinkingStreamParser, extractLeadingThinkingBlocks } from "./inline-thinking";

function collect(chunks: string[]) {
  const parser = createInlineThinkingStreamParser();
  const parts = chunks.flatMap((chunk) => parser.push(chunk));
  parts.push(...parser.flush());
  return {
    content: parts
      .filter((part) => part.type === "content")
      .map((part) => part.text)
      .join(""),
    thinking: parts
      .filter((part) => part.type === "thinking")
      .map((part) => part.text)
      .join(""),
  };
}

describe("inline thinking extraction", () => {
  it("extracts leading thoughts tags used by reasoning models", () => {
    expect(extractLeadingThinkingBlocks("<thoughts>private</thoughts>\nVisible.")).toMatchObject({
      content: "Visible.",
      thinking: "private",
      stripped: true,
    });
  });

  it("splits streamed thinking tags across chunk boundaries", () => {
    expect(collect(["Hello ", "<thin", "king>secret", "</thin", "king> visible"])).toEqual({
      content: "Hello  visible",
      thinking: "secret",
    });
  });

  it("keeps unclosed thinking out of visible content", () => {
    expect(collect(["<think>private reasoning"])).toEqual({
      content: "",
      thinking: "private reasoning",
    });
  });
});
