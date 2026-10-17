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

    await expect(testPreparedSecondaryKeysAsync(matcher, "silver moon rises", "and_all", {})).resolves.toBe(false);
    await expect(testPreparedSecondaryKeysAsync(matcher, "silver moon and red crown", "and_all", {})).resolves.toBe(
      true,
    );
    await expect(testPreparedSecondaryKeysAsync(matcher, "silver moon rises", "or", {})).resolves.toBe(true);
    await expect(testPreparedSecondaryKeysAsync(matcher, "quiet lake", "not", {})).resolves.toBe(true);
  });

  it("matches SillyTavern's four secondary-key modes", async () => {
    const matcher = prepareKeywordMatcher(["moon", "crown"], {
      useRegex: false,
      matchWholeWords: true,
      caseSensitive: false,
    });
    const verdicts = async (text: string) => ({
      andAny: await testPreparedSecondaryKeysAsync(matcher, text, "and", {}),
      andAll: await testPreparedSecondaryKeysAsync(matcher, text, "and_all", {}),
      notAny: await testPreparedSecondaryKeysAsync(matcher, text, "not", {}),
      notAll: await testPreparedSecondaryKeysAsync(matcher, text, "not_all", {}),
    });

    await expect(verdicts("the moon rises")).resolves.toEqual({
      andAny: true,
      andAll: false,
      notAny: false,
      notAll: true,
    });
    await expect(verdicts("moon and crown")).resolves.toEqual({
      andAny: true,
      andAll: true,
      notAny: false,
      notAll: false,
    });
    await expect(verdicts("a quiet lake")).resolves.toEqual({
      andAny: false,
      andAll: false,
      notAny: true,
      notAll: true,
    });
  });
});
