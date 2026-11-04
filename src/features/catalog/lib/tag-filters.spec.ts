import { describe, expect, it } from "vitest";

import {
  NO_TAG_FILTERS,
  countTagFilters,
  cycleTagFilter,
  keepExistingTagFilters,
  matchesTagFilters,
  withoutTagFilter,
} from "./tag-filters";

describe("tag filters", () => {
  it("cycles a clicked tag off → include → exclude → off", () => {
    const included = cycleTagFilter(NO_TAG_FILTERS, "fluff");
    expect(included).toEqual({ fluff: "include" });
    const excluded = cycleTagFilter(included, "fluff");
    expect(excluded).toEqual({ fluff: "exclude" });
    expect(cycleTagFilter(excluded, "fluff")).toEqual({});
  });

  it("shows items with any included tag and none of the excluded ones, ignoring case", () => {
    const filters = { Fluff: "include", angst: "include", nsfw: "exclude" } as const;
    expect(matchesTagFilters(["fluff"], filters)).toBe(true);
    expect(matchesTagFilters(["ANGST", "drama"], filters)).toBe(true);
    expect(matchesTagFilters(["drama"], filters)).toBe(false);
    expect(matchesTagFilters(["fluff", "NSFW"], filters)).toBe(false);
  });

  it("with only exclusions, shows everything without those tags", () => {
    const filters = { nsfw: "exclude" } as const;
    expect(matchesTagFilters([], filters)).toBe(true);
    expect(matchesTagFilters(["fluff"], filters)).toBe(true);
    expect(matchesTagFilters(["nsfw"], filters)).toBe(false);
  });

  it("passes everything with no filters", () => {
    expect(matchesTagFilters([], NO_TAG_FILTERS)).toBe(true);
    expect(matchesTagFilters(["anything"], NO_TAG_FILTERS)).toBe(true);
  });

  it("drops filters on deleted or vanished tags, and counts the rest", () => {
    const filters = { a: "include", b: "exclude", c: "include" } as const;
    expect(withoutTagFilter(filters, "b")).toEqual({ a: "include", c: "include" });
    expect(keepExistingTagFilters(filters, ["a", "b"])).toEqual({ a: "include", b: "exclude" });
    expect(keepExistingTagFilters(filters, ["a", "b", "c"])).toBe(filters);
    expect(countTagFilters(filters)).toEqual({ included: 2, excluded: 1 });
  });
});
