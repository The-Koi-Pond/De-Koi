import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { LlmGateway, LlmRequest } from "../capabilities/llm";
import { generateStructured } from "./structured-generation";

function llmWithResponses(responses: string[]): LlmGateway & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    requests,
    complete: vi.fn(async (request: LlmRequest) => {
      requests.push(request);
      const response = responses.shift();
      if (response === undefined) throw new Error("No queued LLM response");
      return response;
    }),
    stream: vi.fn(),
    listModels: vi.fn(async () => []),
  } as unknown as LlmGateway & { requests: LlmRequest[] };
}

const nameSchema = z.object({ name: z.string().min(1) });

describe("generateStructured", () => {
  it("returns typed data from valid JSON without repair", async () => {
    const llm = llmWithResponses(['{"name":"Mira"}']);

    const result = await generateStructured(
      { llm },
      {
        taskName: "test.name",
        connectionId: "conn-1",
        messages: [{ role: "user", content: "Return a name" }],
        schema: nameSchema,
        schemaDescription: '{"name":"non-empty string"}',
        maxRepairAttempts: 1,
        failureMessage: "Name generation failed.",
      },
    );

    expect(result).toEqual({ ok: true, data: { name: "Mira" }, raw: '{"name":"Mira"}', attempts: 1 });
    expect(llm.complete).toHaveBeenCalledTimes(1);
  });

  it("repairs invalid JSON with schema, validation errors, and the bad response", async () => {
    const llm = llmWithResponses(["not json", '{"name":"Mira"}']);

    const result = await generateStructured(
      { llm },
      {
        taskName: "test.name",
        connectionId: "conn-1",
        messages: [{ role: "user", content: "Return a name" }],
        schema: nameSchema,
        schemaDescription: '{"name":"non-empty string"}',
        maxRepairAttempts: 1,
        failureMessage: "Name generation failed.",
      },
    );

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    expect(llm.complete).toHaveBeenCalledTimes(2);
    const repairPrompt = llm.requests[1]?.messages.at(-1)?.content ?? "";
    expect(repairPrompt).toContain("test.name");
    expect(repairPrompt).toContain('{"name":"non-empty string"}');
    expect(repairPrompt).toContain("parse");
    expect(repairPrompt).toContain("not json");
  });

  it("returns failure when the repair response is still invalid", async () => {
    const llm = llmWithResponses(["not json", '{"name":""}']);

    const result = await generateStructured(
      { llm },
      {
        taskName: "test.name",
        connectionId: "conn-1",
        messages: [{ role: "user", content: "Return a name" }],
        schema: nameSchema,
        schemaDescription: '{"name":"non-empty string"}',
        maxRepairAttempts: 1,
        failureMessage: "Name generation failed.",
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.taskName).toBe("test.name");
      expect(result.failure.message).toBe("Name generation failed.");
      expect(result.failure.validationErrors.join("\n")).toContain("name");
    }
    expect(result.attempts).toBe(2);
  });

  it("does not pass schema-invalid JSON even when parsing succeeds", async () => {
    const llm = llmWithResponses(['{"name":5}']);

    const result = await generateStructured(
      { llm },
      {
        taskName: "test.name",
        connectionId: "conn-1",
        messages: [{ role: "user", content: "Return a name" }],
        schema: nameSchema,
        schemaDescription: '{"name":"non-empty string"}',
        maxRepairAttempts: 0,
        failureMessage: "Name generation failed.",
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.validationErrors.join("\n")).toContain("name");
    }
  });
});
