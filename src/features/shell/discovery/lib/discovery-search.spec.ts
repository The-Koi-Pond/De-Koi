import { describe, expect, it } from "vitest";
import type { DiscoveryEntry } from "../discovery-types";
import { filterDiscoveryEntries } from "./discovery-search";

function entry(overrides: Partial<DiscoveryEntry>): DiscoveryEntry {
  return {
    id: "feature",
    title: "Feature",
    category: "Advanced",
    summary: "A useful capability",
    keywords: ["utility"],
    audience: "Everyone",
    where: "Discover",
    actions: [],
    coverage: "advanced",
    ...overrides,
  };
}

describe("discovery search ranking", () => {
  it("ranks exact title, title prefix, keyword, then descriptive matches", () => {
    const entries = [
      entry({ id: "description", title: "Audio", summary: "Includes voice controls" }),
      entry({ id: "keyword", title: "Speech", keywords: ["voice"] }),
      entry({ id: "prefix", title: "Voice Studio" }),
      entry({ id: "exact", title: "Voice" }),
    ];

    expect(filterDiscoveryEntries(entries, "voice", { category: "All", coverage: "All" }).map(({ id }) => id)).toEqual([
      "exact",
      "prefix",
      "keyword",
      "description",
    ]);
  });

  it("keeps registry order for equal scores and requires every term", () => {
    const entries = [
      entry({ id: "first", title: "Voice Tools" }),
      entry({ id: "second", title: "Voice Notes" }),
      entry({ id: "partial", title: "Voice" }),
    ];

    expect(filterDiscoveryEntries(entries, "voice tools", { category: "All", coverage: "All" }).map(({ id }) => id)).toEqual([
      "first",
    ]);
  });
});
