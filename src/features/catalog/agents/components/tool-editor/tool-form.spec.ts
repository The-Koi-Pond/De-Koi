import { describe, expect, it } from "vitest";
import type { CustomToolRow } from "../../hooks/use-custom-tools";
import {
  newToolForm,
  newToolParameter,
  parameterDescriptionText,
  parameterTypeFromOption,
  parameterTypeLabel,
  parameterTypeOptions,
  parametersFromSchema,
  toolFormFromRow,
  toolFormProblem,
  toolSavePayload,
  type ToolForm,
  type ToolParameter,
} from "./tool-form";

const ROW: CustomToolRow = {
  id: "tool",
  name: "check_weather",
  description: "Looks up the weather.",
  parametersSchema: {
    type: "object",
    properties: {
      city: { type: "string", description: "City name" },
      days: { type: "number", description: "How many days" },
    },
    required: ["city"],
  },
  executionType: "webhook",
  webhookUrl: "https://example.com/hook",
  staticResult: "left over",
  enabled: true,
  createdAt: "",
  updatedAt: "",
};

const row = (patch: Partial<Record<keyof CustomToolRow, unknown>>) => ({ ...ROW, ...patch }) as CustomToolRow;

const param = (patch: Partial<ToolParameter>): ToolParameter => ({ ...newToolParameter(), ...patch });

const form = (patch: Partial<ToolForm>): ToolForm => ({
  ...newToolForm(),
  name: "my_tool",
  description: "Does a thing",
  staticResult: "ok",
  ...patch,
});

describe("loading a stored row", () => {
  it("reads every field the way the spec's loading table says", () => {
    expect(toolFormFromRow(ROW)).toEqual({
      name: "check_weather",
      description: "Looks up the weather.",
      executionType: "webhook",
      webhookUrl: "https://example.com/hook",
      staticResult: "left over",
      parameters: [
        { name: "city", type: "string", description: "City name", required: true, extras: {} },
        { name: "days", type: "number", description: "How many days", required: false, extras: {} },
      ],
      schemaExtras: {},
      enabled: true,
    });
  });

  it("loads missing, null and non-string text as empty", () => {
    const loaded = toolFormFromRow(row({ name: null, description: 5, webhookUrl: null, staticResult: undefined }));
    expect(loaded).toMatchObject({ name: "", description: "", webhookUrl: "", staticResult: "" });
  });

  it("loads script and unknown types as Static Result", () => {
    expect(toolFormFromRow(row({ executionType: "script" })).executionType).toBe("static");
    expect(toolFormFromRow(row({ executionType: "weird" })).executionType).toBe("static");
    expect(toolFormFromRow(row({ executionType: "static" })).executionType).toBe("static");
  });

  it.each([
    [true, true],
    [false, false],
    ["false", false],
    ["true", true],
    [1, true],
    [0, false],
    ["", false],
    [null, false],
    [undefined, false],
  ])("decision 1: enabled %j loads as %s", (enabled, expected) => {
    expect(toolFormFromRow(row({ enabled })).enabled).toBe(expected);
  });

  it("starts a new tool empty, static and on", () => {
    expect(newToolForm()).toEqual({
      name: "",
      description: "",
      executionType: "static",
      webhookUrl: "",
      staticResult: "",
      parameters: [],
      schemaExtras: {},
      enabled: true,
    });
  });
});

describe("parameters from a stored schema", () => {
  it.each([
    [null],
    [undefined],
    ["{}"],
    [[]],
    [{}],
    [{ properties: null }],
    [{ properties: [] }],
    [{ properties: "x" }],
  ])("gives no rows for %j", (schema) => {
    expect(parametersFromSchema(schema)).toEqual([]);
  });

  it("keeps the property order, falls back to string and empty, and ignores non-string required entries", () => {
    expect(
      parametersFromSchema({
        properties: {
          zeta: { type: null, description: null },
          alpha: {},
          odd: "not an object",
          mid: { type: "boolean", description: "Mid" },
        },
        required: ["mid", 5, "gone", "zeta"],
      }),
    ).toEqual([
      { name: "zeta", type: "string", description: "", required: true, extras: {} },
      { name: "alpha", type: "string", description: "", required: false, extras: {} },
      { name: "odd", type: "string", description: "", required: false, extras: {} },
      { name: "mid", type: "boolean", description: "Mid", required: true, extras: {} },
    ]);
  });

  it("decision 5: keeps a non-string type and description as stored", () => {
    expect(
      parametersFromSchema({
        properties: {
          nullable: { type: ["string", "null"], description: 9 },
          numbered: { type: 5, description: { text: "x" } },
          flag: { type: "boolean", description: false },
        },
      }),
    ).toEqual([
      { name: "nullable", type: ["string", "null"], description: 9, required: false, extras: {} },
      { name: "numbered", type: 5, description: { text: "x" }, required: false, extras: {} },
      { name: "flag", type: "boolean", description: false, required: false, extras: {} },
    ]);
  });

  it("treats a required that isn't an array as none required", () => {
    expect(parametersFromSchema({ properties: { q: { type: "string" } }, required: "q" })[0]!.required).toBe(false);
  });

  it("keeps names as stored, spaces and capitals included", () => {
    const names = parametersFromSchema({ properties: { " spaced ": {}, "Caps-Name": {} } }).map((p) => p.name);
    expect(names).toEqual([" spaced ", "Caps-Name"]);
  });

  it("decision 5: keeps each property's other keys and an unknown type", () => {
    const [unit, count] = parametersFromSchema({
      properties: {
        unit: { type: "string", enum: ["c", "f"], description: "Unit", default: "c" },
        count: { type: "integer" },
      },
    });
    expect(unit).toEqual({
      name: "unit",
      type: "string",
      description: "Unit",
      required: false,
      extras: { enum: ["c", "f"], default: "c" },
    });
    expect(count!.type).toBe("integer");
  });

  it("decision 5: keeps the schema's other top-level keys in stored order", () => {
    const loaded = toolFormFromRow(
      row({
        parametersSchema: { additionalProperties: false, type: "object", title: "T", properties: {}, required: [] },
      }),
    );
    expect(Object.keys(loaded.schemaExtras)).toEqual(["additionalProperties", "title"]);
    expect(toolFormFromRow(row({ parametersSchema: "{}" })).schemaExtras).toEqual({});
  });
});

describe("type options", () => {
  it("offers the five types in order", () => {
    expect(parameterTypeOptions("number")).toEqual(["string", "number", "boolean", "array", "object"]);
  });

  it("decision 5: adds a stored type that isn't one of them as a sixth option", () => {
    expect(parameterTypeOptions("integer")).toEqual(["string", "number", "boolean", "array", "object", "integer"]);
  });

  it("decision 5: shows a non-string stored type as JSON", () => {
    expect(parameterTypeOptions(["string", "null"])).toEqual([
      "string",
      "number",
      "boolean",
      "array",
      "object",
      '["string","null"]',
    ]);
    expect(parameterTypeLabel(5)).toBe("5");
    expect(parameterTypeLabel("number")).toBe("number");
  });

  it("decision 5: picking one of the five replaces the stored type; picking its own option keeps it", () => {
    expect(parameterTypeFromOption(["string", "null"], "number")).toBe("number");
    expect(parameterTypeFromOption(["string", "null"], '["string","null"]')).toEqual(["string", "null"]);
    expect(parameterTypeFromOption(5, "5")).toBe(5);
    expect(parameterTypeFromOption("string", "array")).toBe("array");
  });

  it("decision 5: shows a stored description as its text", () => {
    expect(parameterDescriptionText("Unit")).toBe("Unit");
    expect(parameterDescriptionText(9)).toBe("9");
    expect(parameterDescriptionText(false)).toBe("false");
    expect(parameterDescriptionText({ text: "x" })).toBe('{"text":"x"}');
    expect(parameterDescriptionText(["a"])).toBe('["a"]');
  });
});

describe("the save payload", () => {
  it("sends every field in the contract's order", () => {
    const payload = toolSavePayload(toolFormFromRow(ROW));
    expect(JSON.stringify(payload)).toBe(
      JSON.stringify({
        name: "check_weather",
        description: "Looks up the weather.",
        parametersSchema: {
          type: "object",
          properties: {
            city: { type: "string", description: "City name" },
            days: { type: "number", description: "How many days" },
          },
          required: ["city"],
        },
        executionType: "webhook",
        webhookUrl: "https://example.com/hook",
        staticResult: null,
        enabled: true,
      }),
    );
  });

  it("sends only the selected type's box, as typed", () => {
    const both = { webhookUrl: " https://x.example ", staticResult: "  kept  " };
    expect(toolSavePayload(form({ ...both, executionType: "static" }))).toMatchObject({
      executionType: "static",
      webhookUrl: null,
      staticResult: "  kept  ",
    });
    expect(toolSavePayload(form({ ...both, executionType: "webhook" }))).toMatchObject({
      executionType: "webhook",
      webhookUrl: " https://x.example ",
      staticResult: null,
    });
  });

  it("keeps the name and description as typed", () => {
    expect(toolSavePayload(form({ description: "  padded  " })).description).toBe("  padded  ");
  });

  it("leaves out rows with an empty or blank name, required or not", () => {
    const payload = toolSavePayload(
      form({
        parameters: [param({ name: "", required: true }), param({ name: "   ", required: true }), param({ name: "q" })],
      }),
    );
    expect(payload.parametersSchema).toEqual({
      type: "object",
      properties: { q: { type: "string", description: "" } },
      required: [],
    });
  });

  it("keeps names untrimmed and lists required names in row order", () => {
    const payload = toolSavePayload(
      form({
        parameters: [param({ name: "b_second", required: true }), param({ name: " a ", required: true })],
      }),
    );
    expect(Object.keys(payload.parametersSchema.properties)).toEqual(["b_second", " a "]);
    expect(payload.parametersSchema.required).toEqual(["b_second", " a "]);
  });

  it("lets a duplicated name's later row win at the first row's position (decision 7, unchanged)", () => {
    const payload = toolSavePayload(
      form({
        parameters: [
          param({ name: "city", description: "First", required: true }),
          param({ name: "days", type: "number" }),
          param({ name: "city", type: "number", description: "Second", required: true }),
        ],
      }),
    );
    expect(JSON.stringify(payload.parametersSchema)).toBe(
      JSON.stringify({
        type: "object",
        properties: {
          city: { type: "number", description: "Second" },
          days: { type: "number", description: "" },
        },
        required: ["city", "city"],
      }),
    );
  });

  it("decision 5: saves other keys after type and description, and the schema's after required", () => {
    const payload = toolSavePayload(
      form({
        parameters: [param({ name: "renamed", type: "integer", extras: { enum: [1, 2], description2: "x" } })],
        schemaExtras: { additionalProperties: false },
      }),
    );
    expect(JSON.stringify(payload.parametersSchema)).toBe(
      JSON.stringify({
        type: "object",
        properties: { renamed: { type: "integer", description: "", enum: [1, 2], description2: "x" } },
        required: [],
        additionalProperties: false,
      }),
    );
  });

  it("saves a parameter named __proto__ as a real property, and lists it in required", () => {
    const payload = toolSavePayload(form({ parameters: [param({ name: "__proto__", required: true })] }));
    const properties = payload.parametersSchema.properties;
    expect(Object.keys(properties)).toEqual(["__proto__"]);
    expect(Object.getPrototypeOf(properties)).toBe(Object.prototype);
    expect(JSON.stringify(payload.parametersSchema)).toBe(
      JSON.stringify({
        type: "object",
        properties: JSON.parse('{"__proto__":{"type":"string","description":""}}'),
        required: ["__proto__"],
      }),
    );
    expect(JSON.stringify(payload.parametersSchema)).toContain(
      '"properties":{"__proto__":{"type":"string","description":""}}',
    );
  });

  it("decision 5: saves a non-string type and description as stored", () => {
    const payload = toolSavePayload(
      form({ parameters: [param({ name: "q", type: ["string", "null"], description: 9, extras: { default: null } })] }),
    );
    expect(JSON.stringify(payload.parametersSchema.properties)).toBe(
      JSON.stringify({ q: { type: ["string", "null"], description: 9, default: null } }),
    );
  });

  it("decision 1: sends the form's on/off state", () => {
    expect(toolSavePayload(toolFormFromRow(row({ enabled: "false" }))).enabled).toBe(false);
    expect(toolSavePayload(newToolForm()).enabled).toBe(true);
  });
});

describe("checks before sending", () => {
  it.each([
    [{ name: "" }, "Tool name is required."],
    [{ name: "   " }, "Tool name is required."],
    [{ name: "Bad Name" }, "Tool name must be lowercase snake_case (e.g. my_tool)."],
    [{ name: "1abc" }, "Tool name must be lowercase snake_case (e.g. my_tool)."],
    [{ name: "_abc" }, "Tool name must be lowercase snake_case (e.g. my_tool)."],
    [{ name: " abc" }, "Tool name must be lowercase snake_case (e.g. my_tool)."],
    [{ name: "abc " }, "Tool name must be lowercase snake_case (e.g. my_tool)."],
    [{ name: "a".repeat(101) }, "Keep the tool name to 100 characters or fewer."],
    [{ description: "   " }, "Description is required."],
    [{ description: "d".repeat(501) }, "Keep the description to 500 characters or fewer."],
    [{ staticResult: "  " }, "Static result is required for a static custom tool."],
    [{ executionType: "webhook" as const, webhookUrl: " " }, "Webhook URL is required for a webhook custom tool."],
    [
      { executionType: "webhook" as const, webhookUrl: "not a url" },
      "Enter a full webhook URL, like https://api.example.com/my-tool.",
    ],
  ])("%j: %s", (patch, message) => {
    expect(toolFormProblem(form(patch))).toBe(message);
  });

  it("checks in the spec's order, stopping at the first problem", () => {
    expect(toolFormProblem(form({ name: "", description: "", staticResult: "" }))).toBe("Tool name is required.");
    expect(toolFormProblem(form({ name: "A".repeat(101) }))).toBe(
      "Tool name must be lowercase snake_case (e.g. my_tool).",
    );
    expect(toolFormProblem(form({ name: "a".repeat(101), description: "" }))).toBe(
      "Keep the tool name to 100 characters or fewer.",
    );
    expect(toolFormProblem(form({ description: "d".repeat(501), staticResult: "" }))).toBe(
      "Keep the description to 500 characters or fewer.",
    );
  });

  it("accepts the edges and what the schema accepts", () => {
    expect(toolFormProblem(form({ name: "a".repeat(100), description: "d".repeat(500) }))).toBeNull();
    expect(toolFormProblem(form({ name: "a1_b2" }))).toBeNull();
    // Only the selected type's box is checked.
    expect(
      toolFormProblem(form({ staticResult: "", executionType: "webhook", webhookUrl: "https://e.com" })),
    ).toBeNull();
    expect(toolFormProblem(form({ webhookUrl: "not a url" }))).toBeNull();
    // Decision 7: the schema accepts non-https URLs; the server refuses them when the tool is called.
    expect(toolFormProblem(form({ executionType: "webhook", webhookUrl: "ftp://example.com/x" }))).toBeNull();
    expect(toolFormProblem(form({ executionType: "webhook", webhookUrl: " https://example.com/x " }))).toBeNull();
  });
});
