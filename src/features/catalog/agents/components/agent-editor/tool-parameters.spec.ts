import { describe, expect, it } from "vitest";
import { toolParameterRows } from "./tool-parameters";

const LOOKUP = {
  type: "object",
  properties: {
    item: { type: "string", description: "Item name" },
    currency: { type: "string", enum: ["gold", "silver"] },
    count: { type: "number" },
  },
  required: ["item"],
};

describe("toolParameterRows", () => {
  it("lists a well-formed schema's parameters in stored order", () => {
    expect(toolParameterRows(LOOKUP)).toEqual([
      { name: "item", type: "string", description: "Item name", required: true },
      { name: "currency", type: "string", required: false, enum: ["gold", "silver"] },
      { name: "count", type: "number", required: false },
    ]);
  });

  it("reads a schema stored as a JSON string, as the generation runtime does", () => {
    expect(toolParameterRows(JSON.stringify(LOOKUP))).toEqual(toolParameterRows(LOOKUP));
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a number", 3],
    ["an array", [{ type: "string" }]],
    ["text that isn't JSON", "{not json"],
    ["a JSON string of null", "null"],
    ["properties that aren't an object", { type: "object", properties: "item" }],
    ["properties that are an array", { type: "object", properties: ["item"] }],
  ])("shows no parameters for %s", (_name, schema) => {
    expect(toolParameterRows(schema)).toEqual([]);
  });

  it("marks only names listed in an array as required (a string is not a list)", () => {
    const schema = {
      type: "object",
      properties: { item: { type: "string" }, it: { type: "string" }, count: { type: "number", description: "" } },
      required: "item count",
    };
    expect(toolParameterRows(schema).map((row) => row.required)).toEqual([false, false, false]);
    expect(toolParameterRows({ ...schema, required: ["it", 4, null] }).map((row) => row.required)).toEqual([
      false,
      true,
      false,
    ]);
  });

  it("drops parts of a parameter that can't be shown, and keeps its name", () => {
    expect(
      toolParameterRows({
        type: "object",
        properties: {
          mode: { type: "string", enum: "a,b" },
          odd: { type: ["string", "null"], description: { text: "x" }, enum: [1, true, null, "c"] },
          bare: null,
          word: "string",
        },
      }),
    ).toEqual([
      { name: "mode", type: "string", required: false },
      { name: "odd", type: "", required: false, enum: ["1", "true", "null", "c"] },
      { name: "bare", type: "", required: false },
      { name: "word", type: "", required: false },
    ]);
  });

  it("keeps an empty description out, like the old card", () => {
    expect(toolParameterRows({ properties: { count: { type: "number", description: "" } } })).toEqual([
      { name: "count", type: "number", required: false },
    ]);
  });
});
