import { describe, expect, it } from "vitest";
import { getHomeSuggestions, type HomeSuggestionContext } from "./home-suggestions";

const ready: HomeSuggestionContext = {
  needsServerSetup: false,
  hasLanguageModel: true,
  libraryIsEmpty: false,
  hasActivity: true,
};

describe("getHomeSuggestions", () => {
  it("caps contextual journeys at three", () => {
    expect(getHomeSuggestions({ ...ready, needsServerSetup: true, hasLanguageModel: false, libraryIsEmpty: true })).toHaveLength(3);
  });

  it("prioritizes server setup when the web runtime is incomplete", () => {
    expect(getHomeSuggestions({ ...ready, needsServerSetup: true })[0]?.destination).toBe("server-setup");
  });

  it("offers the sample world when no language model is connected", () => {
    expect(getHomeSuggestions({ ...ready, hasLanguageModel: false }).map((item) => item.destination)).toContain("sample-world");
  });

  it("offers import when the library is empty", () => {
    expect(getHomeSuggestions({ ...ready, libraryIsEmpty: true }).map((item) => item.destination)).toContain("library-import");
  });

  it("offers Discover to active users without inventory language", () => {
    const discover = getHomeSuggestions(ready).find((item) => item.destination === "discover");
    expect(discover?.label).toBe("Open Discover");
    expect(`${discover?.label} ${discover?.description}`).not.toMatch(/features tracked|coverage|Browse all \d+/i);
  });

  it("removes duplicate destinations", () => {
    const destinations = getHomeSuggestions({ ...ready, hasLanguageModel: false, libraryIsEmpty: true }).map(
      (item) => item.destination,
    );
    expect(new Set(destinations).size).toBe(destinations.length);
  });
});
