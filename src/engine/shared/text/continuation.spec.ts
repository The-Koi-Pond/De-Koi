import { describe, expect, it } from "vitest";

import { joinContinuation } from "./continuation";

describe("joinContinuation", () => {
  it.each([
    ["two words that meet at the seam", "The lamp", "flickered.", "The lamp flickered."],
    ["a continuation that starts mid-word", "The la", "mp went out.", "The la mp went out."],
    ["a continuation that starts with whitespace", "The lamp", " flickered.", "The lamp flickered."],
    ["text that ends with whitespace", "The lamp ", "flickered.", "The lamp flickered."],
    ["whitespace on both sides", "The lamp\n\n", "\nShe left.", "The lamp\n\n\nShe left."],
    ["a continuation that starts with punctuation", "The lamp", ", then nothing.", "The lamp , then nothing."],
  ])("joins %s with one space only when neither side has whitespace", (_label, previous, addition, joined) => {
    expect(joinContinuation(previous, addition)).toBe(joined);
  });

  it("keeps either side unchanged when the other is empty", () => {
    expect(joinContinuation("", "flickered.")).toBe("flickered.");
    expect(joinContinuation("The lamp", "")).toBe("The lamp");
  });
});
