import { createCustomToolSchema } from "../../../../../engine/contracts/schemas/custom-tool.schema";
import { boolish } from "../../../../../engine/generation/runtime-records";
import type { CustomToolRow } from "../../hooks/use-custom-tools";

/** The `toolDetailId` that means "a tool that isn't saved yet". */
export const NEW_TOOL_ID = "__new__";

/** The type dropdown's options, in this order. A stored type outside them is shown as a sixth option. */
export const PARAMETER_TYPES = ["string", "number", "boolean", "array", "object"] as const;

export type ExecutionType = "static" | "webhook";

export interface ToolParameter {
  name: string;
  type: string;
  description: string;
  required: boolean;
  /** The stored property's other keys (`enum`, `items`, `default`…), saved after type and description. */
  extras: Record<string, unknown>;
}

/** Every saved field the editor holds. */
export interface ToolForm {
  name: string;
  description: string;
  executionType: ExecutionType;
  /** Kept while Static Result is selected, so switching back shows it again. */
  webhookUrl: string;
  /** Kept while Webhook is selected, so switching back shows it again. */
  staticResult: string;
  parameters: ToolParameter[];
  /** The stored schema's other top-level keys (`additionalProperties`…), saved after `required`. */
  schemaExtras: Record<string, unknown>;
  /** What Save sends as `enabled`: a stored tool keeps its on/off state, a new one is on. */
  enabled: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A missing or non-string value loads as empty. */
function storedText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** The record's own keys other than `keys`, in stored order. */
function otherKeys(record: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)));
}

export function newToolForm(): ToolForm {
  return {
    name: "",
    description: "",
    executionType: "static",
    webhookUrl: "",
    staticResult: "",
    parameters: [],
    schemaExtras: {},
    enabled: true,
  };
}

export function newToolParameter(): ToolParameter {
  return { name: "", type: "string", description: "", required: false, extras: {} };
}

/** One row per entry of `properties`, in the object's order. Anything that isn't a schema gives no rows. */
export function parametersFromSchema(schema: unknown): ToolParameter[] {
  if (!isRecord(schema) || !isRecord(schema.properties)) return [];
  const required = Array.isArray(schema.required)
    ? schema.required.filter((entry): entry is string => typeof entry === "string")
    : [];
  return Object.entries(schema.properties).map(([name, value]) => {
    const property = isRecord(value) ? value : {};
    return {
      name,
      type: typeof property.type === "string" ? property.type : "string",
      description: storedText(property.description),
      required: required.includes(name),
      extras: otherKeys(property, ["type", "description"]),
    };
  });
}

export function toolFormFromRow(row: CustomToolRow): ToolForm {
  const schema: unknown = row.parametersSchema;
  return {
    name: storedText(row.name),
    description: storedText(row.description),
    // Script and unknown types load as Static Result.
    executionType: row.executionType === "webhook" ? "webhook" : "static",
    webhookUrl: storedText(row.webhookUrl),
    staticResult: storedText(row.staticResult),
    parameters: parametersFromSchema(schema),
    schemaExtras: isRecord(schema) ? otherKeys(schema, ["type", "properties", "required"]) : {},
    // Read the way chats and the Functions list read it.
    enabled: boolish(row.enabled, false),
  };
}

/** The dropdown's options for a row: the five types, plus the row's own type when it isn't one of them. */
export function parameterTypeOptions(type: string): string[] {
  return (PARAMETER_TYPES as readonly string[]).includes(type) ? [...PARAMETER_TYPES] : [...PARAMETER_TYPES, type];
}

/**
 * What Save sends, field for field and in this order. Every field is a stored contract: the name,
 * description and schema go to the model as a function.
 */
export function toolSavePayload(form: ToolForm) {
  // A Map keeps a duplicated name at its first position with the later row's value.
  const properties = new Map<string, Record<string, unknown>>();
  const required: string[] = [];
  for (const parameter of form.parameters) {
    if (parameter.name.trim() === "") continue;
    properties.set(parameter.name, { type: parameter.type, description: parameter.description, ...parameter.extras });
    if (parameter.required) required.push(parameter.name);
  }
  const webhook = form.executionType === "webhook";
  return {
    name: form.name,
    description: form.description,
    parametersSchema: {
      type: "object",
      properties: Object.fromEntries(properties),
      required,
      ...form.schemaExtras,
    },
    executionType: form.executionType,
    webhookUrl: webhook ? form.webhookUrl : null,
    staticResult: webhook ? null : form.staticResult,
    enabled: form.enabled,
  };
}

const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
// The storage schema's own field rules, so the editor and the schema can't disagree.
const schemaFields = createCustomToolSchema.shape;

/** The first reason the form can't be sent, in plain words, or null when it can. */
export function toolFormProblem(form: ToolForm): string | null {
  if (form.name.trim() === "") return "Tool name is required.";
  if (!TOOL_NAME_PATTERN.test(form.name)) return "Tool name must be lowercase snake_case (e.g. my_tool).";
  if (!schemaFields.name.safeParse(form.name).success) return "Keep the tool name to 100 characters or fewer.";
  if (form.description.trim() === "") return "Description is required.";
  if (!schemaFields.description.safeParse(form.description).success) {
    return "Keep the description to 500 characters or fewer.";
  }
  if (form.executionType === "static" && form.staticResult.trim() === "") {
    return "Static result is required for a static custom tool.";
  }
  if (form.executionType === "webhook") {
    if (form.webhookUrl.trim() === "") return "Webhook URL is required for a webhook custom tool.";
    if (!schemaFields.webhookUrl.safeParse(form.webhookUrl).success) {
      return "Enter a full webhook URL, like https://api.example.com/my-tool.";
    }
  }
  return null;
}
