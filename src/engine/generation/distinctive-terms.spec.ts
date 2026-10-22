import { describe, expect, it } from "vitest";

import { distinctiveMatch, distinctiveTermWeights, queryTermFocus } from "./distinctive-terms";

const words = (text: string) => text.toLowerCase().match(/[a-z]{2,}/g) ?? [];
const set = (text: string) => new Set(words(text));

describe("distinctive terms", () => {
  it("weights a word by how few documents share it", () => {
    const documents = [
      ...Array.from({ length: 20 }, (_, index) => set(`Odile steers the barge past bank ${index}`)),
      set("Odile learns that eel closes Cass's throat"),
    ];
    const weights = distinctiveTermWeights(documents);

    expect(weights.weight("eel")).toBe(1);
    expect(weights.weight("odile")).toBeLessThan(0.05);
    expect(weights.weight("unknown")).toBe(0);
  });

  it("counts the asking clause fully and the narration around it for less", () => {
    const focus = queryTermFocus(
      '*I squint at the slate roofs.* "Odile, do you remember what I can\'t eat?" *My stomach turns.*',
      words,
    );

    expect(focus.get("eat")).toBe(1);
    expect(focus.get("slate")).toBeCloseTo(0.35);
    expect(focus.get("stomach")).toBeCloseTo(0.35);
  });

  it("counts every word fully when nothing is asked", () => {
    const focus = queryTermFocus("*I hand Odile the book from the chapel.*", words);

    expect(focus.get("book")).toBe(1);
    expect(focus.get("chapel")).toBe(1);
  });

  it("ranks the question's rare word above scenery words the story has used before", () => {
    const documents = [
      ...Array.from({ length: 20 }, (_, index) => set(`the barge drifts down the river reach ${index}`)),
      ...Array.from({ length: 3 }, () => set("smoke over slate roofs stacked behind the wall")),
      set("Cass can't eat eel"),
      set("slate smudge stacked behind the wall"),
    ];
    const weights = distinctiveTermWeights(documents);
    const focus = queryTermFocus(
      '*Smoke and a smudge of slate roofs stacked behind the wall.* "Odile, what can\'t I eat?"',
      words,
    );

    expect(distinctiveMatch(focus, set("Cass can't eat eel"), weights)).toBeGreaterThan(
      distinctiveMatch(focus, set("slate smudge stacked behind the wall"), weights),
    );
  });
});
