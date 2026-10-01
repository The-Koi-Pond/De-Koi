import { describe, expect, it } from "vitest";
import { pickDefaultLanguageConnection } from "./connection-filters";

describe("pickDefaultLanguageConnection", () => {
  it("prefers the connection marked default", () => {
    expect(
      pickDefaultLanguageConnection([
        { id: "a", provider: "openai" },
        { id: "b", provider: "anthropic", isDefault: true },
      ])?.id,
    ).toBe("b");
  });

  it("uses the only language connection when none is marked default", () => {
    expect(
      pickDefaultLanguageConnection([
        { id: "img", provider: "image_generation", isDefault: true },
        { id: "text", provider: "openai" },
      ])?.id,
    ).toBe("text");
  });

  it("does not guess between several unmarked connections", () => {
    expect(pickDefaultLanguageConnection([{ id: "a" }, { id: "b" }])).toBeNull();
    expect(pickDefaultLanguageConnection([])).toBeNull();
  });
});
