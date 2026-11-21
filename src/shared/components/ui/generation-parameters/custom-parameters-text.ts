import { isPlainRecord } from "./parameters";

export type CustomParametersRejection = "invalid-json" | "not-object";

export const CUSTOM_PARAMETERS_ERRORS: Record<CustomParametersRejection, string> = {
  "invalid-json": "Invalid JSON. Check quotes, commas, and boolean casing.",
  "not-object": "Custom parameters must be a JSON object, not an array or scalar.",
};

type ReadResult = { ok: true; value: Record<string, unknown> } | { ok: false; reason: CustomParametersRejection };

const PYTHON_LITERAL = /\b(True|False|None)\b/g;
const JSON_LITERAL: Record<string, string> = { True: "true", False: "false", None: "null" };

function tryParse(text: string): { parsed: true; value: unknown } | { parsed: false } {
  try {
    return { parsed: true, value: JSON.parse(text) };
  } catch {
    return { parsed: false };
  }
}

/** Reads the Custom Parameters text: empty is `{}`, and Python-style `True`/`False`/`None` are forgiven. */
export function readCustomParametersText(text: string): ReadResult {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, value: {} };
  let attempt = tryParse(trimmed);
  if (!attempt.parsed && new RegExp(PYTHON_LITERAL.source).test(trimmed)) {
    attempt = tryParse(trimmed.replace(PYTHON_LITERAL, (word) => JSON_LITERAL[word]!));
  }
  if (!attempt.parsed) return { ok: false, reason: "invalid-json" };
  return isPlainRecord(attempt.value) ? { ok: true, value: attempt.value } : { ok: false, reason: "not-object" };
}

export function formatCustomParameters(customParameters: Record<string, unknown>): string {
  return Object.keys(customParameters).length === 0 ? "" : JSON.stringify(customParameters, null, 2);
}
