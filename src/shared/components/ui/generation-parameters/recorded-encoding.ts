// The recordings' value encoding (test-fixtures/README.md): JSON can't hold `undefined`, `NaN`, `±Infinity`
// or `-0`, so the recorder tagged them as `{"$": "<name>"}`. Key order is kept both ways.

type Tag = "undefined" | "NaN" | "Infinity" | "-Infinity" | "-0";

const TAGGED: Record<Tag, unknown> = {
  undefined: undefined,
  NaN: Number.NaN,
  Infinity: Number.POSITIVE_INFINITY,
  "-Infinity": Number.NEGATIVE_INFINITY,
  "-0": -0,
};

function tagOf(value: unknown): Tag | null {
  if (value === undefined) return "undefined";
  if (typeof value !== "number") return null;
  if (Number.isNaN(value)) return "NaN";
  if (value === Number.POSITIVE_INFINITY) return "Infinity";
  if (value === Number.NEGATIVE_INFINITY) return "-Infinity";
  if (Object.is(value, -0)) return "-0";
  return null;
}

function isTagged(value: unknown): value is { $: Tag } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  const tag = (value as { $: unknown }).$;
  return keys.length === 1 && keys[0] === "$" && typeof tag === "string" && Object.hasOwn(TAGGED, tag);
}

export function decode(value: unknown): unknown {
  if (isTagged(value)) return TAGGED[value.$];
  if (Array.isArray(value)) return value.map(decode);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item)]));
  }
  return value;
}

export function encode(value: unknown): unknown {
  const tag = tagOf(value);
  if (tag) return { $: tag };
  if (Array.isArray(value)) return value.map(encode);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]));
  }
  return value;
}
