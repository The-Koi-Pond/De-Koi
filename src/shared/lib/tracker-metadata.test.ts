import { describe, expect, it } from "vitest";
import { normalizeMaybeJsonStringArray } from "./tracker-metadata";

describe("normalizeMaybeJsonStringArray", () => {
  it("preserves JSON-encoded single-string character ids", () => {
    expect(normalizeMaybeJsonStringArray('"char-a"')).toEqual(["char-a"]);
    expect(normalizeMaybeJsonStringArray('" char-b "')).toEqual(["char-b"]);
  });

  it("keeps array and raw string compatibility", () => {
    expect(normalizeMaybeJsonStringArray('["char-a","char-b"]')).toEqual(["char-a", "char-b"]);
    expect(normalizeMaybeJsonStringArray("char-a")).toEqual(["char-a"]);
    expect(normalizeMaybeJsonStringArray("[]")).toEqual([]);
  });
});
