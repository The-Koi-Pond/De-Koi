import assert from "node:assert/strict";
import { test } from "node:test";
import { findTooSmallText } from "./check-min-text-size.mjs";

test("flags arbitrary text sizes below 0.5625rem in rem and px, with variants", () => {
  const source = [
    '<span className="text-[0.5rem]">a</span>',
    '<span className="md:text-[8px] text-[0.5625rem]">b</span>',
    ".tiny { font-size: 0.4375rem; }",
  ].join("\n");
  assert.deepEqual(findTooSmallText(source), [
    { line: 1, size: "text-[0.5rem]" },
    { line: 2, size: "text-[8px]" },
    { line: 3, size: "font-size: 0.4375rem" },
  ]);
});

test("accepts the floor and anything larger", () => {
  const source = [
    '<span className="text-[0.5625rem] text-[9px] text-[0.625rem]">ok</span>',
    ".label { font-size: 0.75rem; }",
    '<span className="text-xs leading-[0.5rem]">ok</span>',
  ].join("\n");
  assert.deepEqual(findTooSmallText(source), []);
});
