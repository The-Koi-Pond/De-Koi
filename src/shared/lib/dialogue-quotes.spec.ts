import { describe, expect, it } from "vitest";

import { formatTextQuotes } from "./dialogue-quotes";

describe("formatTextQuotes", () => {
  it("treats a lone quote as an opening typographic quote", () => {
    expect(formatTextQuotes('"', "typographic")).toBe("\u201c");
    expect(formatTextQuotes("'", "typographic")).toBe("\u2018");
  });

  it("treats a terminal quote after existing text as a closing typographic quote", () => {
    expect(formatTextQuotes('She paused "', "typographic")).toBe("She paused \u201d");
    expect(formatTextQuotes("Wait '", "typographic")).toBe("Wait \u2019");
  });
});
