import { describe, expect, it } from "vitest";

import { characterWebResearchPresentation, isCharacterWebToolName } from "./web-research-presentation";

describe("character web research presentation", () => {
  it("defaults missing and invalid metadata to quiet presentation", () => {
    expect(characterWebResearchPresentation({})).toBe("quiet");
    expect(characterWebResearchPresentation({ characterWebResearchPresentation: "quiet" })).toBe("quiet");
    expect(characterWebResearchPresentation({ characterWebResearchPresentation: "unexpected" })).toBe("quiet");
  });

  it("retains an explicit visible presentation", () => {
    expect(characterWebResearchPresentation({ characterWebResearchPresentation: "visible" })).toBe("visible");
  });

  it("classifies only character web tools as research turns", () => {
    expect(isCharacterWebToolName("request_character_web_research")).toBe(true);
    expect(isCharacterWebToolName("search_character_web")).toBe(true);
    expect(isCharacterWebToolName("read_character_web_page")).toBe(true);
    expect(isCharacterWebToolName("save_lorebook_entry")).toBe(false);
  });
});
