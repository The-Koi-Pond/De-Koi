import { describe, expect, it } from "vitest";

import { estimatePersonaCardTokens } from "./persona-token-count";

describe("estimatePersonaCardTokens", () => {
  it("counts the whole promptable persona card and only active description extensions", () => {
    const tokens = estimatePersonaCardTokens({
      name: "Celia",
      description: "12345678",
      personality: "1234",
      backstory: "1234",
      appearance: "1234",
      scenario: "1234",
      altDescriptions: [
        { id: "active", label: "Combat", active: true, content: "12345678" },
        { id: "inactive", label: "Hidden", active: false, content: "12345678" },
      ],
    });

    expect(tokens).toBe(11);
  });
});
