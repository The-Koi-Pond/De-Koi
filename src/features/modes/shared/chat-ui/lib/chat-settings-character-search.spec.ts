import { describe, expect, it } from "vitest";

import {
  characterSearchValues,
  mergeDrawerCharacters,
  searchValuesMatchTerms,
  splitSearchTerms,
} from "./chat-settings-character-search";

describe("chat settings character search", () => {
  it("merges stable ids with the later source winning and normalizes avatars", () => {
    const result = mergeDrawerCharacters(
      [
        { id: "shared", data: { name: "Earlier" }, avatarPath: "earlier.png" },
        { id: "first-only", data: { name: "First" } },
      ],
      [
        { id: "shared", data: { name: "Later" }, avatarPath: "later.png" },
        undefined,
        { id: "second-only", data: { name: "Second" } },
      ],
    );

    expect(result.map((character) => character.id)).toEqual(["shared", "first-only", "second-only"]);
    expect(result[0]).toMatchObject({
      data: { name: "Later" },
      avatarPath: "later.png",
    });
  });

  it("indexes the existing identity and metadata fields", () => {
    expect(
      characterSearchValues({
        id: "character-7",
        comment: "Archive lead",
        data: {
          name: "Mara Venn",
          creator: "Celia",
          creator_notes: "Cold case specialist",
          character_version: "2.1",
          tags: ["mystery", 1987],
        },
      }),
    ).toEqual([
      "character-7",
      "Mara Venn",
      "Archive lead",
      "Celia",
      "Cold case specialist",
      "2.1",
      "mystery",
      "1987",
    ]);
  });

  it("normalizes whitespace and case while requiring every term to match", () => {
    const terms = splitSearchTerms("  MARA   mystery ");
    const values = characterSearchValues({
      id: "character-7",
      data: { name: "Mara Venn", tags: ["Mystery"] },
    }).map((value) => value.toLowerCase());

    expect(terms).toEqual(["mara", "mystery"]);
    expect(searchValuesMatchTerms(values, terms)).toBe(true);
    expect(searchValuesMatchTerms(values, [...terms, "missing"])).toBe(false);
    expect(searchValuesMatchTerms(values, [])).toBe(true);
  });
});
