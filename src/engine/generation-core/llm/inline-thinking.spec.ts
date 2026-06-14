import { describe, expect, it } from "vitest";

import { createInlineThinkingStreamParser } from "./inline-thinking";

function parseStream(
  chunks: string[],
  options?: Parameters<typeof createInlineThinkingStreamParser>[0],
) {
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
});
