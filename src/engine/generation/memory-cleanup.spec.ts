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
  it("flags isolated conversational residue as an unchecked discard", async () => {
    const requests: LlmRequest[] = [];
    const llm = gateway(async (request) => {
      requests.push(request);
      return JSON.stringify({
        proposals: [
          {
            type: "discard",
            sourceIds: ["junk"],
            reason: "Low-value memory",
          },
        ],
      });
    });

    const preview = await analyzeMemoryCleanup({
      scope: { kind: "chat", id: "chat-1" },
      sources: [
        source({
          id: "junk",
          scope: { kind: "chat", id: "chat-1" },
          content: "Chai says heat stroke is serious.",
        }),
      ],
      connectionId: "connection-1",
      llm,
    });

    expect(preview.proposals).toEqual([
      expect.objectContaining({
        type: "discard",
        sourceIds: ["junk"],
        reason: "Low-value memory",
        selected: false,
        estimatedTokensAfter: 0,
      }),
    ]);
    expect(preview.beforeCount).toBe(1);
    expect(preview.afterCount).toBe(1);
    expect(requests).toHaveLength(1);
  });

  it("asks for future contextual value without treating ordinary or pinned memories as junk", async () => {
    const requests: LlmRequest[] = [];
    const llm = gateway(async (request) => {
      requests.push(request);
      return JSON.stringify({ proposals: [] });
    });
    const preview = await analyzeMemoryCleanup({
      scope: { kind: "character", id: "mira" },
      sources: [
        source({
          id: "preference",
          content: "Mira prefers tea without sugar.",
          origin: "manual",
        }),
        source({
          id: "belief",
          content: "Mira believes heat stroke is serious because she lost a friend to it.",
          status: "pinned",
          pinned: true,
        }),
      ],
      connectionId: "connection-1",
      llm,
    });

    const system = requests[0]?.messages[0]?.content ?? "";
    expect(system).toContain("future contextual value");
    expect(system).toContain("generic or common knowledge");
    expect(system).toContain("manual, edited, imported, corrected, command-created, or pinned");
    expect(preview.proposals).toEqual([]);
  });

  it("keeps discard ahead of exact cleanup for the same memory", async () => {
    const llm = gateway(async () =>
      JSON.stringify({
        proposals: [{ type: "discard", sourceIds: ["duplicate-a"], reason: "Low-value memory" }],
      }),
    );
    const preview = await analyzeMemoryCleanup({
      scope: { kind: "character", id: "mira" },
      sources: [
        source({ id: "duplicate-a", content: "Chai says heat stroke is serious." }),
        source({ id: "duplicate-b", content: "Chai says heat stroke is serious." }),
      ],
      connectionId: "connection-1",
      llm,
    });

    expect(preview.proposals).toEqual([
      expect.objectContaining({ type: "discard", sourceIds: ["duplicate-a"], selected: false }),
    ]);
  });

  it("runs value groups sequentially", async () => {
    const requests: LlmRequest[] = [];
    let active = 0;
    let maxActive = 0;
    const llm = gateway(async (request) => {
      requests.push(request);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return JSON.stringify({ proposals: [] });
    });

    await analyzeMemoryCleanup({
      scope: { kind: "character", id: "mira" },
      sources: Array.from({ length: 9 }, (_, index) =>
        source({ id: `memory-${index}`, content: `isolatedtoken${index}` }),
      ),
      connectionId: "connection-1",
      llm,
    });

    expect(requests).toHaveLength(2);
    expect(maxActive).toBe(1);
  });

  it("rejects invented discard IDs and coalesces repeated discard suggestions", async () => {
    const llm = gateway(async () =>
      JSON.stringify({
        proposals: [
          { type: "discard", sourceIds: ["junk"], reason: "Low-value memory" },
          { type: "discard", sourceIds: ["junk"], reason: "Low-value memory" },
          { type: "discard", sourceIds: ["invented"], reason: "Low-value memory" },
        ],
      }),
    );

    const preview = await analyzeMemoryCleanup({
      scope: { kind: "character", id: "mira" },
      sources: [source({ id: "junk", content: "Chai says heat stroke is serious." })],
      connectionId: "connection-1",
      llm,
    });

    expect(preview.proposals).toEqual([
      expect.objectContaining({ type: "discard", sourceIds: ["junk"], selected: false }),
    ]);
  });

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
    expect(requests).toHaveLength(2);
    expect(requests[1]?.connectionId).toBe("connection-1");
    expect(requests[1]?.parameters).toEqual({
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
    expect(JSON.stringify(requests[1])).not.toContain("unrelated-chat-message");
    expect(JSON.stringify(requests[1])).toContain("two or more");
    expect(JSON.stringify(requests[1])).toContain("Length alone");
    expect(JSON.stringify(requests[1])).toContain("winnerId must name a pinned source");
    const systemPrompt = requests[1]?.messages[0]?.content ?? "";
    expect(systemPrompt).toContain("Compare every supplied source");
    expect(systemPrompt).toContain("different wording");
    expect(systemPrompt).toContain("Preserve distinct events");
    expect(systemPrompt).toContain("return no proposal");
    expect(systemPrompt).toContain('"sourceIds"');
    expect(systemPrompt).toContain('"replacement":{"content":"combined memory","kind":"fact"}');
    expect(systemPrompt).toContain(
      'Use reason exactly: "Repeated fact", "Overlapping memories", or "Possible conflict"',
    );
    const prompt = JSON.parse(String(requests[1]?.messages[1]?.content)) as {
      allowedTypes: string[];
      sources: Array<{ id: string; pinned: boolean }>;
    };
    expect(prompt.allowedTypes).toEqual(["keep_one", "combine", "conflict"]);
    expect(prompt.sources).toEqual(expect.arrayContaining([expect.objectContaining({ id: "memory-b", pinned: true })]));
    expect(JSON.stringify(requests[1])).not.toContain("shorten");
    expect(preview.beforeCount).toBe(3);
    expect(preview.afterCount).toBe(2);
  });

  it("analyzes more than twenty candidate groups sequentially without deferral", async () => {
    const requests: LlmRequest[] = [];
    let active = 0;
    let maxActive = 0;
    const llm = gateway(async (request) => {
      requests.push(request);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return JSON.stringify({ proposals: [] });
    });
    const sources = Array.from({ length: 22 }, (_, index) => [
      source({
        id: `pair-${index}-a`,
        content: `Alpha${index}.`,
        messageIds: [`pair-message-${index}`],
      }),
      source({
        id: `pair-${index}-b`,
        content: `Beta${index}.`,
        messageIds: [`pair-message-${index}`],
      }),
    ]).flat();

    const preview = await analyzeMemoryCleanup({
      scope: { kind: "character", id: "mira" },
      sources,
      connectionId: "connection-1",
      llm,
    });

    expect(requests).toHaveLength(28);
    expect(requests.filter((request) => request.messages[0]?.content.includes("future contextual value"))).toHaveLength(
      6,
    );
    expect(requests.filter((request) => request.messages[0]?.content.includes("reversible cleanup"))).toHaveLength(22);
    expect(maxActive).toBe(1);
    expect(preview.deferredCandidateCount).toBe(0);
    expect(preview.proposals).toEqual([]);
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
      JSON.stringify({ proposals: [] }),
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
    expect(requests).toHaveLength(4);
    expect(requests[2]?.messages.at(-1)?.content).toContain("Repair the structured output");
    expect(requests[3]?.messages.at(-1)?.content).toContain("Repair the structured output");
    expect(requests[2]?.messages.at(-1)?.content).toContain("proposals");
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

  it("keeps a visible conflict instead of an overlapping actionable proposal", async () => {
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

    const preview = await analyzeMemoryCleanup({
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
    });

    expect(preview.proposals).toEqual([
      expect.objectContaining({
        type: "conflict",
        sourceIds: ["alive", "dead"],
        selected: false,
      }),
    ]);
  });

  it("keeps a global exact-duplicate proposal ahead of an overlapping semantic proposal", async () => {
    const llm = gateway(async () =>
      JSON.stringify({
        proposals: [
          {
            type: "combine",
            sourceIds: ["duplicate-a", "related"],
            replacement: { content: "Mira keeps the brass key in her coat.", kind: "fact" },
            reason: "Overlapping memories",
          },
        ],
      }),
    );
    const preview = await analyzeMemoryCleanup({
      scope: { kind: "character", id: "mira" },
      sources: [
        source({ id: "duplicate-a", content: "Mira keeps the brass key.", confidence: 0.7 }),
        source({ id: "duplicate-b", content: "Mira keeps the brass key.", confidence: 0.9 }),
        source({ id: "related", content: "Mira stores the brass key in her coat." }),
      ],
      connectionId: "connection-1",
      llm,
    });

    expect(preview.proposals).toEqual([
      expect.objectContaining({
        type: "keep_one",
        sourceIds: expect.arrayContaining(["duplicate-a"]),
        winnerId: "duplicate-b",
      }),
    ]);
  });

  it("keeps the non-overlapping actionable set with the greatest memory-count reduction", async () => {
    const llm = gateway(async () =>
      JSON.stringify({
        proposals: [
          {
            type: "combine",
            sourceIds: ["memory-a", "memory-b"],
            replacement: { content: "Two-source replacement.", kind: "fact" },
            reason: "Overlapping memories",
          },
          {
            type: "combine",
            sourceIds: ["memory-a", "memory-b", "memory-c"],
            replacement: { content: "Three-source replacement preserving every detail.", kind: "fact" },
            reason: "Overlapping memories",
          },
        ],
      }),
    );
    const preview = await analyzeMemoryCleanup({
      scope: { kind: "character", id: "mira" },
      sources: [
        source({ id: "memory-a", content: "Mira keeps the brass key." }),
        source({ id: "memory-b", content: "The brass key remains with Mira." }),
        source({ id: "memory-c", content: "Mira stores the brass key in her coat." }),
      ],
      connectionId: "connection-1",
      llm,
    });

    expect(preview.proposals).toEqual([
      expect.objectContaining({
        type: "combine",
        sourceIds: ["memory-a", "memory-b", "memory-c"],
      }),
    ]);
    expect(preview.afterCount).toBe(1);
  });

  it("coalesces duplicate model proposals for the same referenced source set", async () => {
    const llm = gateway(async () =>
      JSON.stringify({
        proposals: [
          {
            type: "combine",
            sourceIds: ["memory-a", "memory-b"],
            replacement: { content: "First valid replacement.", kind: "fact" },
            reason: "Overlapping memories",
          },
          {
            type: "combine",
            sourceIds: ["memory-b", "memory-a"],
            replacement: { content: "Second valid replacement.", kind: "fact" },
            reason: "Overlapping memories",
          },
        ],
      }),
    );
    const preview = await analyzeMemoryCleanup({
      scope: { kind: "character", id: "mira" },
      sources: [
        source({ id: "memory-a", content: "Mira keeps the brass key." }),
        source({ id: "memory-b", content: "The brass key remains with Mira." }),
      ],
      connectionId: "connection-1",
      llm,
    });

    expect(preview.proposals).toHaveLength(1);
    expect(preview.proposals[0]).toEqual(
      expect.objectContaining({
        type: "combine",
        sourceIds: expect.arrayContaining(["memory-a", "memory-b"]),
      }),
    );
  });

  it("creates exact-duplicate keep-one proposals without a consolidation LLM call", async () => {
    const complete = vi.fn<LlmGateway["complete"]>(async () => JSON.stringify({ proposals: [] }));
    const preview = await analyzeMemoryCleanup({
      scope: { kind: "character", id: "mira" },
      sources: [
        source({ id: "older", confidence: 0.7, updatedAt: "2026-06-01T00:00:00.000Z" }),
        source({ id: "better", confidence: 0.9, updatedAt: "2026-07-01T00:00:00.000Z" }),
      ],
      connectionId: "connection-1",
      llm: gateway(complete),
    });

    expect(complete).toHaveBeenCalledOnce();
    expect(complete.mock.calls[0]?.[0].messages[0]?.content).toContain("future contextual value");
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
    const complete = vi.fn<LlmGateway["complete"]>(async () => JSON.stringify({ proposals: [] }));
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

    expect(complete).toHaveBeenCalledOnce();
    expect(preview.proposals).toEqual([
      expect.objectContaining({
        type: "keep_one",
        winnerId: "pinned",
        sourceIds: expect.arrayContaining(["automatic", "edited"]),
      }),
    ]);
  });

  it("counts every eligible origin with the same rules used to prepare candidates", async () => {
    const complete = vi.fn<LlmGateway["complete"]>(async () => JSON.stringify({ proposals: [] }));
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

    expect(complete).toHaveBeenCalledOnce();
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

  it("reviews one long memory for value without asking the model to rewrite it", async () => {
    const complete = vi.fn<LlmGateway["complete"]>(async () => JSON.stringify({ proposals: [] }));
    const preview = await analyzeMemoryCleanup({
      scope: { kind: "character", id: "mira" },
      sources: [source({ id: "long", content: "x".repeat(601) })],
      connectionId: "connection-1",
      llm: gateway(complete),
    });

    expect(complete).toHaveBeenCalledOnce();
    expect(JSON.stringify(complete.mock.calls[0]?.[0])).not.toContain("shorten");
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
