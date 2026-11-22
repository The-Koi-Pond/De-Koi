/** One parameter line on a tool card. */
export interface ToolParameterRow {
  name: string;
  /** Empty when the stored type isn't text. */
  type: string;
  description?: string;
  required: boolean;
  enum?: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The parameter lines a tool card shows for a stored schema. Custom tool schemas are stored as written, so they can be
 * null, JSON text or carry odd values. JSON text is parsed, as generation does before sending the schema to the model;
 * anything else that isn't a schema object shows no parameters, and a part of a parameter that can't be shown is left
 * out.
 */
export function toolParameterRows(schema: unknown): ToolParameterRow[] {
  let parsed = schema;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  if (!isRecord(parsed) || !isRecord(parsed.properties)) return [];
  const required = Array.isArray(parsed.required)
    ? parsed.required.filter((name): name is string => typeof name === "string")
    : [];
  return Object.entries(parsed.properties).map(([name, property]) => {
    const row: ToolParameterRow = { name, type: "", required: required.includes(name) };
    if (!isRecord(property)) return row;
    if (typeof property.type === "string") row.type = property.type;
    if (typeof property.description === "string" && property.description) row.description = property.description;
    if (Array.isArray(property.enum)) row.enum = property.enum.map((value) => String(value));
    return row;
  });
}
