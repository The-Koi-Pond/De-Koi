import type { LlmGateway, LlmMessage, LlmRequest } from "../capabilities/llm";
import { extractLeadingThinkingBlocks } from "../generation-core/llm/inline-thinking";
import type { z } from "zod";

export interface StructuredGenerationFailure {
  taskName: string;
  message: string;
  validationErrors: string[];
  raw: string;
}

export type StructuredGenerationResult<T> =
  | { ok: true; data: T; raw: string; attempts: number }
  | { ok: false; failure: StructuredGenerationFailure; raw: string; attempts: number };

export interface StructuredGenerationInput<T> {
  taskName: string;
  connectionId?: string | null;
  messages: LlmMessage[];
  parameters?: Record<string, unknown>;
  schema: z.ZodType<T>;
  schemaDescription: string;
  maxRepairAttempts?: number;
  failureMessage: string;
}

export async function generateStructured<T>(
  capabilities: { llm: LlmGateway },
  input: StructuredGenerationInput<T>,
  signal?: AbortSignal,
): Promise<StructuredGenerationResult<T>> {
  const maxRepairAttempts = Math.max(0, Math.trunc(input.maxRepairAttempts ?? 0));
  let messages = input.messages;
  let lastRaw = "";
  let lastErrors: string[] = [];

  for (let attempt = 1; attempt <= maxRepairAttempts + 1; attempt += 1) {
    const request: LlmRequest = {
      connectionId: input.connectionId,
      messages,
      parameters: input.parameters,
    };
    lastRaw = await capabilities.llm.complete(request, signal);
    const validation = parseAndValidate(lastRaw, input.schema);
    if (validation.ok) return { ok: true, data: validation.data, raw: lastRaw, attempts: attempt };

    lastErrors = validation.errors;
    if (attempt <= maxRepairAttempts) {
      messages = buildRepairMessages(input, lastRaw, lastErrors);
    }
  }

  const failure = {
    taskName: input.taskName,
    message: input.failureMessage,
    validationErrors: lastErrors,
    raw: lastRaw,
  };
  return { ok: false, failure, raw: lastRaw, attempts: maxRepairAttempts + 1 };
}

function parseAndValidate<T>(
  raw: string,
  schema: z.ZodType<T>,
): { ok: true; data: T } | { ok: false; errors: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleanStructuredText(raw));
  } catch (error) {
    return { ok: false, errors: [`parse error: ${errorMessage(error)}`] };
  }

  const result = schema.safeParse(parsed);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, errors: result.error.issues.map(formatIssue) };
}

function buildRepairMessages<T>(
  input: StructuredGenerationInput<T>,
  badResponse: string,
  errors: string[],
): LlmMessage[] {
  return [
    ...input.messages,
    {
      role: "user",
      content: [
        `Repair the structured output for task "${input.taskName}".`,
        "Return only one valid JSON object. Do not include markdown fences or explanation.",
        "",
        "Expected JSON schema/shape:",
        input.schemaDescription,
        "",
        "Parse/validation errors:",
        errors.map((error) => `- ${error}`).join("\n"),
        "",
        "Bad response:",
        badResponse,
      ].join("\n"),
    },
  ];
}

function cleanStructuredText(raw: string): string {
  return stripFences(extractLeadingThinkingBlocks(raw).cleanText.trim()).trim();
}

function stripFences(raw: string): string {
  return raw.replace(/^```(?:json|markdown)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");
}

function formatIssue(issue: z.ZodIssue): string {
  const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
  return `${path}: ${issue.message}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
