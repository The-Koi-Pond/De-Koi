import { describe, expect, it } from "vitest";
import type { Lorebook } from "../../../../../engine/contracts/types/lorebook";
import { NO_TAG_FILTERS, type TagFilters } from "../../../lib/tag-filters";
import { filterLorebooksForPanel, formatLorebookTokenBudget } from "./lorebook-panel-model";

function lorebook(id: string, category: string): Lorebook {
  return { id, name: id, description: "", category, tags: [] } as unknown as Lorebook;
}

const world = lorebook("world-book", "world");
const npc = lorebook("npc-book", "npc");
const other = lorebook("other-book", "uncategorized");
// Older or imported records can have an empty category; they count as "Other".
const blank = lorebook("blank-book", "");

function filterByType(typeFilters: TagFilters): string[] {
  return filterLorebooksForPanel({
    lorebooks: [world, npc, other, blank],
    activeFilter: "all",
    activeScopeContext: { chat: null, characters: [], persona: null },
    typeFilters,
    tagFilters: NO_TAG_FILTERS,
    searchQuery: "",
    getCharacterNames: () => [],
    getPersonaNames: () => [],
  }).map((book) => book.id);
}

describe("filterLorebooksForPanel type filter", () => {
  it("keeps every lorebook when no type is filtered", () => {
    expect(filterByType(NO_TAG_FILTERS)).toEqual(["world-book", "npc-book", "other-book", "blank-book"]);
  });

  it("shows only the included types, with an empty category counting as Other", () => {
    expect(filterByType({ world: "include" })).toEqual(["world-book"]);
    expect(filterByType({ uncategorized: "include" })).toEqual(["other-book", "blank-book"]);
  });

  it("hides the excluded types", () => {
    expect(filterByType({ npc: "exclude", uncategorized: "exclude" })).toEqual(["world-book"]);
  });
});

describe("formatLorebookTokenBudget", () => {
  it("shortens thousands", () => {
    expect(formatLorebookTokenBudget(800)).toBe("800");
    expect(formatLorebookTokenBudget(1200)).toBe("1.2k");
    expect(formatLorebookTokenBudget(2000)).toBe("2k");
  });
});
