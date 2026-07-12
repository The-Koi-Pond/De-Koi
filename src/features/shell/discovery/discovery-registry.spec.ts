import { describe, expect, it } from "vitest";

import { DISCOVERY_ENTRIES, validateDiscoveryEntries } from "./discovery-registry";
import { NO_MODEL_GAME_SHOWCASE_ID } from "./showcase";

describe("discovery showcase registry", () => {
  it("rejects unknown settings tabs and destination ids", () => {
    const baseEntry = DISCOVERY_ENTRIES[0];
    const entries = DISCOVERY_ENTRIES.map((entry, index) =>
      index === 0
        ? {
            ...baseEntry,
            actions: [
              { type: "open-settings", tab: "mystery", destination: "missing-control" },
            ],
          }
        : entry,
    );

    expect(validateDiscoveryEntries(entries)).toContain(`${baseEntry.id}.actions[0].tab must target a known settings tab.`);
    expect(validateDiscoveryEntries(entries)).toContain(
      `${baseEntry.id}.actions[0].destination must target a known settings destination.`,
    );
  });

  it("rejects a settings destination assigned to the wrong tab", () => {
    const baseEntry = DISCOVERY_ENTRIES[0];
    const entries = DISCOVERY_ENTRIES.map((entry, index) =>
      index === 0
        ? { ...baseEntry, actions: [{ type: "open-settings", tab: "general", destination: "notification-sounds" }] }
        : entry,
    );

    expect(validateDiscoveryEntries(entries)).toContain(
      `${baseEntry.id}.actions[0].destination belongs to the appearance settings tab.`,
    );
  });

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

  it("describes Discover as the dedicated home for resumable setup and optional orientation", () => {
    const entry = DISCOVERY_ENTRIES.find((item) => item.id === "onboarding-tutorial");

    expect(entry?.title).toBe("Show Me Around");
    expect(entry?.summary.toLowerCase()).toContain("readiness checklist");
    expect(entry?.summary.toLowerCase()).toContain("resume");
    expect(entry?.where).toContain("Discover");
    expect(entry?.actions).toContainEqual({ type: "replay-onboarding", label: "Show me around" });
  });
});
