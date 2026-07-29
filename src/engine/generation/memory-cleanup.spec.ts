import { describe, expect, it, vi } from "vitest";

import type { LlmGateway, LlmRequest } from "../capabilities/llm";
import type { MemoryCleanupSource } from "../contracts/types/memory-maintenance";
import { analyzeMemoryCleanup } from "./memory-cleanup";

function source(overrides: Partial<MemoryCleanupSource> = {}): MemoryCleanupSource {
  return {
    id: "memory-1",
    scope: { kind: "character", id: "mira" },
    content: "Mira keeps the brass key.",
    kind: "fact",
    status: "active",
    origin: "automatic",
    confidence: 0.8,
    messageIds: [],
    sourceChatIds: [],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    pinned: false,
    userEdited: false,
    ...overrides,
  };
}

function gateway(complete: LlmGateway["complete"]): LlmGateway {
  return {
    complete,
    async *stream() {
      yield { type: "done" as const };
    },
    async listModels() {
      return [];
    },
  };
}

describe("analyzeMemoryCleanup", () => {
  it("sends only grouped memory records and validates returned source IDs", async () => {
    const requests: LlmRequest[] = [];
    const llm = gateway(async (request) => {
      requests.push(request);
      return JSON.stringify({
        proposals: [
          {
            type: "combine",
            sourceIds: ["memory-a", "memory-b"],
            replacement: { content: "Mira keeps the brass key.", kind: "fact" },
            reason: "Overlapping memories",
          },
        ],
      });
    });

    const preview = await analyzeMemoryCleanup({
      scope: { kind: "character", id: "mira" },
      sources: [
        source({ id: "memory-a", content: "Mira has and keeps the brass key." }),
        source({
          id: "memory-b",
          content: "Mira keeps the brass key in her pocket.",
          status: "pinned",
          origin: "imported",
          pinned: true,
        }),
        source({ id: "unrelated", content: "The ferry leaves before dawn.", messageIds: ["unrelated-chat-message"] }),
      ],
      connectionId: "connection-1",
      llm,
    });

    expect(preview.proposals).toHaveLength(1);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.connectionId).toBe("connection-1");
    expect(requests[0]?.parameters).toEqual({
      temperature: 0,
      maxTokens: 4_096,
      responseFormat: "json_object",
      reasoningEffort: "none",
      reasoning_effort: "none",
      customParameters: {
        reasoning_effort: "none",
        reasoning: { exclude: true },
      },
    });
    expect(JSON.stringify(requests)).not.toContain("unrelated-chat-message");
    expect(JSON.stringify(requests)).toContain("two or more");
    expect(JSON.stringify(requests)).toContain("Length alone");
    expect(JSON.stringify(requests)).toContain("winnerId must name a pinned source");
    const systemPrompt = requests[0]?.messages[0]?.content ?? "";
    expect(systemPrompt).toContain('"sourceIds"');
    expect(systemPrompt).toContain('"replacement":{"content":"combined memory","kind":"fact"}');
    expect(systemPrompt).toContain(
      'Use reason exactly: "Repeated fact", "Overlapping memories", or "Possible conflict"',
    );
    const prompt = JSON.parse(String(requests[0]?.messages[1]?.content)) as {
      allowedTypes: string[];
      sources: Array<{ id: string; pinned: boolean }>;
    };
    expect(prompt.allowedTypes).toEqual(["keep_one", "combine", "conflict"]);
    expect(prompt.sources).toEqual(expect.arrayContaining([expect.objectContaining({ id: "memory-b", pinned: true })]));
    expect(JSON.stringify(requests)).not.toContain("shorten");
    expect(preview.beforeCount).toBe(3);
    expect(preview.afterCount).toBe(2);
  });

  it("accepts valid cleanup JSON from a fenced model response with trailing text", async () => {
    const llm = gateway(async () =>
      [
        "```json",
        JSON.stringify({
          proposals: [
            {
              type: "combine",
              sourceIds: ["memory-a", "memory-b"],
              replacement: {
                content: "Mira keeps the brass key in her pocket.\n```markdown\nPocket inventory\n```",
                kind: "fact",
              },
              reason: "Overlapping memories",
            },
          ],
        }),
        "```",
        "The cleanup proposal is ready.",
      ].join("\n"),
    );

    const preview = await analyzeMemoryCleanup({
      scope: { kind: "character", id: "mira" },
      sources: [
        source({ id: "memory-a", content: "Mira has and keeps the brass key." }),
        source({ id: "memory-b", content: "Mira keeps the brass key in her pocket." }),
      ],
      connectionId: "connection-1",
      llm,
    });

    expect(preview.proposals).toEqual([
      expect.objectContaining({
        type: "combine",
        sourceIds: ["memory-a", "memory-b"],
      }),
    ]);
  });

  it("retries when the first repair response is also malformed", async () => {
    const requests: LlmRequest[] = [];
    const responses = [
      '{"proposals":[{"type":"combine","sourceIds":["memory-a","memory-b"]',
      '```json\n{"proposals":[{"type":"combine","sourceIds":["memory-a","memory-b"]',
      JSON.stringify({
        proposals: [
          {
            type: "combine",
            sourceIds: ["memory-a", "memory-b"],
            replacement: { content: "Mira keeps the brass key in her pocket.", kind: "fact" },
            reason: "Overlapping memories",
          },
        ],
      }),
    ];
    const llm = gateway(async (request) => {
      requests.push(request);
      const response = responses.shift();
      if (response === undefined) throw new Error("No queued cleanup response.");
      return response;
    });

    const preview = await analyzeMemoryCleanup({
      scope: { kind: "character", id: "mira" },
      sources: [
        source({ id: "memory-a", content: "Mira has and keeps the brass key." }),
        source({ id: "memory-b", content: "Mira keeps the brass key in her pocket." }),
      ],
      connectionId: "connection-1",
      llm,
    });

    expect(preview.proposals).toEqual([
      expect.objectContaining({
        type: "combine",
        sourceIds: ["memory-a", "memory-b"],
      }),
    ]);
    expect(requests).toHaveLength(3);
    expect(requests[1]?.messages.at(-1)?.content).toContain("Repair the structured output");
    expect(requests[2]?.messages.at(-1)?.content).toContain("Repair the structured output");
    expect(requests[1]?.messages.at(-1)?.content).toContain("proposals");
  });

  it("rejects a model attempt to merge a conflict", async () => {
    const llm = gateway(async () =>
      JSON.stringify({
        proposals: [
          {
            type: "combine",
            sourceIds: ["alive", "dead"],
            replacement: { content: "The captain is alive.", kind: "fact" },
            reason: "Possible conflict",
          },
        ],
      }),
    );

    await expect(
      analyzeMemoryCleanup({
        scope: { kind: "chat", id: "chat-1" },
        sources: [
          source({
            id: "alive",
            scope: { kind: "chat", id: "chat-1" },
            content: "The captain is alive aboard the ship.",
          }),
          source({
            id: "dead",
            scope: { kind: "chat", id: "chat-1" },
            content: "The captain is dead aboard the ship.",
          }),
        ],
        connectionId: "connection-1",
        llm,
      }),
    ).rejects.toThrow("No valid cleanup proposals");
  });

  it("rejects conflict and actionable proposals that overlap the same sources", async () => {
    const llm = gateway(async () =>
      JSON.stringify({
        proposals: [
          {
            type: "conflict",
            sourceIds: ["alive", "dead"],
            reason: "Possible conflict",
          },
          {
            type: "combine",
            sourceIds: ["alive", "dead"],
            replacement: { content: "The captain's fate is uncertain.", kind: "fact" },
            reason: "Overlapping memories",
          },
        ],
      }),
    );

    await expect(
      analyzeMemoryCleanup({
        scope: { kind: "chat", id: "chat-1" },
        sources: [
          source({
            id: "alive",
            scope: { kind: "chat", id: "chat-1" },
            content: "The captain is alive aboard the ship.",
          }),
          source({
            id: "dead",
            scope: { kind: "chat", id: "chat-1" },
            content: "The captain is dead aboard the ship.",
          }),
        ],
        connectionId: "connection-1",
        llm,
      }),
    ).rejects.toThrow("more than once");
  });

  it("creates exact-duplicate keep-one proposals without an LLM call", async () => {
    const complete = vi.fn<LlmGateway["complete"]>();
    const preview = await analyzeMemoryCleanup({
      scope: { kind: "character", id: "mira" },
      sources: [
        source({ id: "older", confidence: 0.7, updatedAt: "2026-06-01T00:00:00.000Z" }),
        source({ id: "better", confidence: 0.9, updatedAt: "2026-07-01T00:00:00.000Z" }),
      ],
      connectionId: "connection-1",
      llm: gateway(complete),
    });

    expect(complete).not.toHaveBeenCalled();
    expect(preview.proposals).toEqual([
      expect.objectContaining({
        type: "keep_one",
        winnerId: "better",
        sourceIds: ["older"],
        selected: true,
      }),
    ]);
  });

  it("consolidates edited and imported exact duplicates while preserving a pinned winner", async () => {
    const complete = vi.fn<LlmGateway["complete"]>();
    const preview = await analyzeMemoryCleanup({
      scope: { kind: "character", id: "mira" },
      sources: [
        source({ id: "automatic", confidence: 0.99 }),
        source({
          id: "edited",
          createdAt: "2026-06-01T00:00:00.000Z",
          userEdited: true,
        }),
        source({
          id: "pinned",
          status: "pinned",
          pinned: true,
          createdAt: "2026-07-01T00:00:00.000Z",
          origin: "imported",
        }),
      ],
      connectionId: "connection-1",
      llm: gateway(complete),
    });

    expect(complete).not.toHaveBeenCalled();
    expect(preview.proposals).toEqual([
      expect.objectContaining({
        type: "keep_one",
        winnerId: "pinned",
        sourceIds: expect.arrayContaining(["automatic", "edited"]),
      }),
    ]);
  });

  it("counts every eligible origin with the same rules used to prepare candidates", async () => {
    const complete = vi.fn<LlmGateway["complete"]>();
    const preview = await analyzeMemoryCleanup({
      scope: { kind: "character", id: "mira" },
      sources: [
        source({ id: "automatic" }),
        source({ id: "manual", origin: "manual", userEdited: true }),
        source({ id: "imported", origin: "imported" }),
        source({ id: "corrected", origin: "correction" }),
        source({ id: "tool-created", origin: "command" }),
        source({ id: "pinned", status: "pinned", pinned: true }),
        source({ id: "inactive", status: "superseded" }),
      ],
      connectionId: "connection-1",
      llm: gateway(complete),
    });

    expect(complete).not.toHaveBeenCalled();
    expect(preview.beforeCount).toBe(6);
    expect(preview.afterCount).toBe(1);
    expect(preview.proposals).toEqual([
      expect.objectContaining({
        type: "keep_one",
        winnerId: "pinned",
        sourceIds: expect.arrayContaining(["automatic", "manual", "imported", "corrected", "tool-created"]),
      }),
    ]);
  });

  it("rejects a model keep-one proposal that would discard a pinned source", async () => {
    const llm = gateway(async () =>
      JSON.stringify({
        proposals: [
          {
            type: "keep_one",
            sourceIds: ["pinned"],
            winnerId: "automatic",
            reason: "Repeated fact",
          },
        ],
      }),
    );

    await expect(
      analyzeMemoryCleanup({
        scope: { kind: "character", id: "mira" },
        sources: [
          source({ id: "automatic", content: "Mira keeps the old brass key." }),
          source({
            id: "pinned",
            content: "Mira keeps her old brass key.",
            status: "pinned",
            pinned: true,
          }),
        ],
        connectionId: "connection-1",
        llm,
      }),
    ).rejects.toThrow("No valid cleanup proposals");
  });

  it("does not ask the model to rewrite one long memory", async () => {
    const complete = vi.fn<LlmGateway["complete"]>();
    const preview = await analyzeMemoryCleanup({
      scope: { kind: "character", id: "mira" },
      sources: [source({ id: "long", content: "x".repeat(601) })],
      connectionId: "connection-1",
      llm: gateway(complete),
    });

    expect(complete).not.toHaveBeenCalled();
    expect(preview.proposals).toEqual([]);
    expect(preview.beforeCount).toBe(1);
    expect(preview.afterCount).toBe(1);
  });

  it("rejects single-memory shortening proposals", async () => {
    const llm = gateway(async () =>
      JSON.stringify({
        proposals: [
          {
            type: "shorten",
            sourceIds: ["memory-a"],
            replacement: { content: "Mira has the key.", kind: "fact" },
            reason: "Shorter wording",
          },
        ],
      }),
    );

    await expect(
      analyzeMemoryCleanup({
        scope: { kind: "character", id: "mira" },
        sources: [
          source({ id: "memory-a", content: "Mira has and keeps the brass key." }),
          source({ id: "memory-b", content: "Mira keeps the brass key in her pocket." }),
        ],
        connectionId: "connection-1",
        llm,
      }),
    ).rejects.toThrow("No valid cleanup proposals");
  });
});
