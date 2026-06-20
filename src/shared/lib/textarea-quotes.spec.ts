import { describe, expect, it } from "vitest";

import { applyTextareaQuoteFormat } from "./textarea-quotes";

describe("applyTextareaQuoteFormat", () => {
  it("preserves an active textarea selection while formatting quotes", () => {
    const textarea = document.createElement("textarea");
    textarea.value = '"hello"';
    textarea.setSelectionRange(1, 6, "backward");

    const formatted = applyTextareaQuoteFormat(textarea, "typographic");

    expect(formatted).toBe("\u201chello\u201d");
    expect(textarea.value).toBe("\u201chello\u201d");
    expect(textarea.selectionStart).toBe(1);
    expect(textarea.selectionEnd).toBe(6);
    expect(textarea.selectionDirection).toBe("backward");
  });
});
