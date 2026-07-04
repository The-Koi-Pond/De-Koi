import type { SelectiveLogic } from "../../contracts/types/lorebook.js";
import { isPatternSafe } from "./regex-safety.js";

/** Pluggable executor for compiled regex test calls. Runtime-specific callers can add extra guards. */
type RegexExecutor = (regex: RegExp, text: string) => boolean;
type AsyncRegexExecutor = (regex: RegExp, text: string) => boolean | Promise<boolean>;

const defaultRegexExecutor: RegexExecutor = (regex, text) => regex.test(text);

export interface KeywordMatchOptions {
  useRegex: boolean;
  matchWholeWords: boolean;
  caseSensitive: boolean;
  /** Optional override for executing user-supplied regex patterns. Only applied
   *  to the `useRegex` path; the matchWholeWords branch builds its regex from
   *  escaped-literal text and skips the executor. */
  regexExecutor?: RegexExecutor;
}

type KeywordMatchBaseOptions = Pick<KeywordMatchOptions, "caseSensitive">;
type KeywordMatcherOptions = Pick<KeywordMatchOptions, "useRegex" | "matchWholeWords" | "caseSensitive">;
export interface PreparedKeywordMatchOptions {
  regexExecutor?: AsyncRegexExecutor;
}

type PreparedKeyword = {
  keyword: string;
  test(text: string, options?: PreparedKeywordMatchOptions): Promise<boolean>;
};

export interface PreparedKeywordMatcher {
  keywords: string[];
  options: KeywordMatcherOptions;
  matchers: PreparedKeyword[];
}

function literalMatch(keyword: string, text: string, options: KeywordMatchBaseOptions): boolean {
  const needle = options.caseSensitive ? keyword : keyword.toLowerCase();
  const haystack = options.caseSensitive ? text : text.toLowerCase();
  return haystack.includes(needle);
}

function literalPreparedKeyword(keyword: string, options: KeywordMatchBaseOptions): PreparedKeyword {
  const needle = options.caseSensitive ? keyword : keyword.toLowerCase();
  return {
    keyword,
    async test(text) {
      const haystack = options.caseSensitive ? text : text.toLowerCase();
      return haystack.includes(needle);
    },
  };
}

function regexPreparedKeyword(
  keyword: string,
  regex: RegExp,
  fallback: PreparedKeyword,
  useExecutor: boolean,
): PreparedKeyword {
  return {
    keyword,
    async test(text, options = {}) {
      try {
        regex.lastIndex = 0;
        const matched = useExecutor
          ? await (options.regexExecutor ?? defaultRegexExecutor)(regex, text)
          : regex.test(text);
        regex.lastIndex = 0;
        return matched;
      } catch {
        regex.lastIndex = 0;
        return fallback.test(text, options);
      }
    },
  };
}

function prepareKeyword(keyword: string, options: KeywordMatcherOptions): PreparedKeyword {
  const fallback = literalPreparedKeyword(keyword, options);
  if (!keyword) {
    return {
      keyword,
      async test() {
        return false;
      },
    };
  }

  try {
    if (options.useRegex) {
      if (!isPatternSafe(keyword)) return fallback;
      const flags = options.caseSensitive ? "g" : "gi";
      return regexPreparedKeyword(keyword, new RegExp(keyword, flags), fallback, true);
    }

    if (options.matchWholeWords) {
      const needle = options.caseSensitive ? keyword : keyword.toLowerCase();
      const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const flags = options.caseSensitive ? "g" : "gi";
      return regexPreparedKeyword(keyword, new RegExp(`\\b${escaped}\\b`, flags), fallback, false);
    }

    return fallback;
  } catch {
    return fallback;
  }
}

export function prepareKeywordMatcher(keywords: string[], options: KeywordMatcherOptions): PreparedKeywordMatcher {
  return {
    keywords: [...keywords],
    options,
    matchers: keywords.map((keyword) => prepareKeyword(keyword, options)),
  };
}

/** Test whether a single keyword would match the given text under the given options. */
function testKeyword(keyword: string, text: string, options: KeywordMatchOptions): boolean {
  if (!keyword) return false;

  try {
    if (options.useRegex) {
      if (!isPatternSafe(keyword)) {
        return literalMatch(keyword, text, options);
      }
      const flags = options.caseSensitive ? "g" : "gi";
      const regex = new RegExp(keyword, flags);
      const exec = options.regexExecutor ?? defaultRegexExecutor;
      return exec(regex, text);
    }

    if (options.matchWholeWords) {
      const needle = options.caseSensitive ? keyword : keyword.toLowerCase();
      const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const flags = options.caseSensitive ? "g" : "gi";
      const regex = new RegExp(`\\b${escaped}\\b`, flags);
      return regex.test(text);
    }

    return literalMatch(keyword, text, options);
  } catch {
    return literalMatch(keyword, text, options);
  }
}

/** Primary key set: any single key matching counts as a match. */
export function testPrimaryKeys(
  keys: string[],
  text: string,
  options: KeywordMatchOptions,
): { matched: boolean; matchedKeys: string[] } {
  const matchedKeys: string[] = [];
  for (const key of keys) {
    if (testKeyword(key, text, options)) {
      matchedKeys.push(key);
    }
  }
  return { matched: matchedKeys.length > 0, matchedKeys };
}

export async function testPreparedPrimaryKeysAsync(
  matcher: PreparedKeywordMatcher,
  text: string,
  options: PreparedKeywordMatchOptions = {},
): Promise<{ matched: boolean; matchedKeys: string[] }> {
  const matchedKeys: string[] = [];
  for (const prepared of matcher.matchers) {
    if (await prepared.test(text, options)) {
      matchedKeys.push(prepared.keyword);
    }
  }
  return { matched: matchedKeys.length > 0, matchedKeys };
}

export async function testPreparedSecondaryKeysAsync(
  matcher: PreparedKeywordMatcher,
  text: string,
  logic: SelectiveLogic,
  options: PreparedKeywordMatchOptions = {},
): Promise<boolean> {
  if (matcher.matchers.length === 0) return true;

  switch (logic) {
    case "and":
      for (const prepared of matcher.matchers) {
        if (!(await prepared.test(text, options))) return false;
      }
      return true;
    case "or":
      for (const prepared of matcher.matchers) {
        if (await prepared.test(text, options)) return true;
      }
      return false;
    case "not":
      for (const prepared of matcher.matchers) {
        if (await prepared.test(text, options)) return false;
      }
      return true;
    default:
      return true;
  }
}
