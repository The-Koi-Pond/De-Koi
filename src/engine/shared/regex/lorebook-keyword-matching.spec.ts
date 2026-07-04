import { describe, expect, it } from "vitest";
import {
  prepareKeywordMatcher,
  testPreparedPrimaryKeysAsync,
  testPreparedSecondaryKeysAsync,
} from "./lorebook-keyword-matching";

describe("lorebook keyword matching", () => {
  it("reuses prepared regex objects across repeated primary scans", async () => {
    const matcher = prepareKeywordMatcher(["ancient\\s+gate"], {
      useRegex: true,
      matchWholeWords: false,
      caseSensitive: false,
    });
    const seen: RegExp[] = [];

    const first = await testPreparedPrimaryKeysAsync(matcher, "The ancient gate opens.", {
      regexExecutor: (regex, text) => {
        seen.push(regex);
        return regex.test(text);
      },
    });
    const second = await testPreparedPrimaryKeysAsync(matcher, "The ancient gate closes.", {
      regexExecutor: (regex, text) => {
        seen.push(regex);
        return regex.test(text);
      },
    });

    expect(first).toEqual({ matched: true, matchedKeys: ["ancient\\s+gate"] });
    expect(second).toEqual({ matched: true, matchedKeys: ["ancient\\s+gate"] });
    expect(seen).toHaveLength(2);
    expect(seen[1]).toBe(seen[0]);
  });

  it("reuses prepared secondary matchers while preserving selective logic", async () => {
    const matcher = prepareKeywordMatcher(["silver moon", "red crown"], {
      useRegex: false,
      matchWholeWords: true,
      caseSensitive: false,
    });

    await expect(testPreparedSecondaryKeysAsync(matcher, "silver moon rises", "and", {})).resolves.toBe(false);
    await expect(testPreparedSecondaryKeysAsync(matcher, "silver moon and red crown", "and", {})).resolves.toBe(true);
    await expect(testPreparedSecondaryKeysAsync(matcher, "silver moon rises", "or", {})).resolves.toBe(true);
    await expect(testPreparedSecondaryKeysAsync(matcher, "quiet lake", "not", {})).resolves.toBe(true);
  });
});
