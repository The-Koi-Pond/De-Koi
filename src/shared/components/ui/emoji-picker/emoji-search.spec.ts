import { describe, expect, it } from "vitest";

import { EMOJI_CATEGORIES } from "./emoji-categories";
import { EMOJI_KEYWORDS } from "./emoji-keywords";
import { emojiName, searchEmojis } from "./emoji-search";
import recorded from "./test-fixtures/recorded-picker.json";

/** First place kept, later repeats dropped (decision 2). */
function withoutRepeats(emojis: readonly string[]): string[] {
  return [...new Set(emojis)];
}

/** True when every item of `part` appears in `whole`, in the same order. */
function isInOrder(part: readonly string[], whole: readonly string[]): boolean {
  let at = 0;
  for (const item of part) {
    at = whole.indexOf(item, at);
    if (at === -1) return false;
    at += 1;
  }
  return true;
}

describe("emoji categories", () => {
  it("match the recorded tabs: labels, icons and emoji order, in-category repeats removed", () => {
    expect(EMOJI_CATEGORIES.map((category) => category.label)).toEqual(
      recorded.categories.map((category) => category.title),
    );
    expect(EMOJI_CATEGORIES.map((category) => category.icon)).toEqual(
      recorded.categories.map((category) => category.icon),
    );
    recorded.categories.forEach((category, index) => {
      expect(category.grid).toHaveLength(1);
      expect(category.grid[0].heading).toBe(category.title);
      expect(EMOJI_CATEGORIES[index].emojis).toEqual(withoutRepeats(category.grid[0].emojis));
    });
  });

  it("show 623 emojis with no repeats inside a category and the three cross-category ones in both", () => {
    const all = EMOJI_CATEGORIES.flatMap((category) => category.emojis);
    expect(all).toHaveLength(626);
    expect(new Set(all).size).toBe(623);
    for (const category of EMOJI_CATEGORIES) {
      expect(new Set(category.emojis).size).toBe(category.emojis.length);
    }
    const inTwo = [...new Set(all)].filter((emoji) => all.indexOf(emoji) !== all.lastIndexOf(emoji));
    expect(inTwo.sort()).toEqual(["♥️", "❤️", "🫶"].sort());
  });
});

describe("emoji keywords", () => {
  const shown = new Set(EMOJI_CATEGORIES.flatMap((category) => category.emojis));

  it("cover exactly the emojis the picker shows", () => {
    expect(new Set(Object.keys(EMOJI_KEYWORDS))).toEqual(shown);
  });

  it("give every emoji a lowercase name and make it findable by that name (decision 3)", () => {
    for (const category of EMOJI_CATEGORIES) {
      for (const emoji of category.emojis) {
        const keywords = EMOJI_KEYWORDS[emoji];
        expect(keywords, emoji).toBe(keywords.toLowerCase());
        const name = emojiName(emoji);
        expect(name.length, emoji).toBeGreaterThan(0);
        const found = searchEmojis(name).find((section) => section.label === category.label);
        expect(found?.emojis, `${emoji} by "${name}"`).toContain(emoji);
      }
    }
  });
});

describe("emoji search", () => {
  it.each(recorded.search.map((entry) => [entry.query, entry.grid] as const))(
    "finds everything the old picker found for %j, in category and emoji order",
    (query, oldGrid) => {
      const results = searchEmojis(query);
      const labels = results.map((section) => section.label);
      const categoryOrder = EMOJI_CATEGORIES.map((category) => category.label);
      expect(isInOrder(labels, categoryOrder)).toBe(true);
      for (const section of results) {
        const category = EMOJI_CATEGORIES.find((item) => item.label === section.label)!;
        expect(isInOrder(section.emojis, category.emojis)).toBe(true);
      }
      for (const oldSection of oldGrid) {
        const section = results.find((item) => item.label === oldSection.heading);
        expect(section, `${query}: ${oldSection.heading}`).toBeDefined();
        const missing = withoutRepeats(oldSection.emojis).filter((emoji) => !section!.emojis.includes(emoji));
        expect(missing, `${query}: ${oldSection.heading}`).toEqual([]);
      }
    },
  );

  it("trims and lowercases the query and matches inside words", () => {
    expect(searchEmojis("  HeArT eYeS ")).toEqual(searchEmojis("heart eyes"));
    expect(searchEmojis("eart")).toEqual(searchEmojis("heart"));
    expect(searchEmojis("pizza")).toEqual([{ label: "Food", emojis: ["🍕"] }]);
  });

  it("returns nothing for an empty or unmatched query", () => {
    expect(searchEmojis("   ")).toEqual([]);
    expect(searchEmojis("xyzzy")).toEqual([]);
  });

  it("matches inside one keyword phrase, never across the commas between phrases", () => {
    expect(searchEmojis(",")).toEqual([]);
    expect(searchEmojis("e, ")).toEqual([]);
    expect(searchEmojis("face, happy")).toEqual([]);
    expect(searchEmojis("heart eyes").flatMap((section) => section.emojis)).toEqual(["😍", "😻"]);
  });
});
