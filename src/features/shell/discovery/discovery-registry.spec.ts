import { describe, expect, it } from "vitest";

import { DISCOVERY_ENTRIES, validateDiscoveryEntries } from "./discovery-registry";
import { NO_MODEL_GAME_SHOWCASE_ID } from "./showcase";

describe("discovery showcase registry", () => {
  it("accepts the no-model showcase as a core discoverable action", () => {
    expect(validateDiscoveryEntries()).toEqual([]);

    const entry = DISCOVERY_ENTRIES.find((item) => item.id === "no-model-showcase");
    expect(entry).toMatchObject({
      category: "Getting started",
      coverage: "core",
    });
    expect(entry?.actions).toContainEqual({
      type: "open-showcase",
      showcaseId: NO_MODEL_GAME_SHOWCASE_ID,
      label: "Explore Sample World",
    });
  });
});
