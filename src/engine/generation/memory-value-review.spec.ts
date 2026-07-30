import { describe, expect, it, vi } from "vitest";

import type { LlmGateway, LlmRequest } from "../capabilities/llm";
import type { MemoryCleanupSource } from "../contracts/types/memory-maintenance";
import { reviewMemoryValues } from "./memory-value-review";

function source(overrides: Partial<MemoryCleanupSource> = {}): MemoryCleanupSource {
  return {
    id: "memory-1",
    scope: { kind: "chat", id: "chat-1" },
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

describe("reviewMemoryValues", () => {
  it("reviews every source with the aggressive shared policy", async () => {
    const requests: LlmRequest[] = [];
    const complete = vi.fn(async (request: LlmRequest) => {
      requests.push(request);
      return JSON.stringify({
        proposals: [{ type: "discard", sourceIds: ["junk"], reason: "Low-value memory" }],
      });
    });
    const result = await reviewMemoryValues({
      scope: { kind: "chat", id: "chat-1" },
      sources: [
        source({ id: "junk", content: "Heat stroke is serious." }),
        source({ id: "durable", content: "Mira carries electrolyte tablets because she once had heat stroke." }),
      ],
      connectionId: "connection-1",
      llm: gateway(complete),
    });

    expect(result.reviewedSourceIds).toEqual(["durable", "junk"]);
    expect(result.proposals.map((proposal) => proposal.sourceIds)).toEqual([["junk"]]);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(requests[0]?.messages[0]?.content).toContain("generic or common knowledge");
    expect(requests[0]?.messages[0]?.content).toContain(
      "manual, edited, imported, corrected, command-created, or pinned",
    );
  });

  it("runs bounded value groups sequentially", async () => {
    let active = 0;
    let maxActive = 0;
    const complete = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return JSON.stringify({ proposals: [] });
    });

    const result = await reviewMemoryValues({
      scope: { kind: "chat", id: "chat-1" },
      sources: Array.from({ length: 33 }, (_, index) =>
        source({ id: `memory-${index}`, content: `isolatedtoken${index}` }),
      ),
      connectionId: "connection-1",
      llm: gateway(complete),
    });

    expect(complete).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
    expect(result.reviewedSourceIds).toHaveLength(33);
  });

  it("rejects a response containing only malformed or cross-group proposals", async () => {
    const llm = gateway(async () =>
      JSON.stringify({
        proposals: [
          { type: "discard", sourceIds: ["unknown"], reason: "Low-value memory" },
          { type: "combine", sourceIds: ["a", "b"], reason: "Overlapping memories" },
        ],
      }),
    );

    await expect(
      reviewMemoryValues({
        scope: { kind: "chat", id: "chat-1" },
        sources: [source({ id: "a" }), source({ id: "b" })],
        connectionId: "connection-1",
        llm,
      }),
    ).rejects.toThrow("No valid value-review proposals");
  });

  it("drops invalid entries when the response also contains a valid discard", async () => {
    const llm = gateway(async () =>
      JSON.stringify({
        proposals: [
          { type: "discard", sourceIds: ["junk"], reason: "Low-value memory" },
          { type: "discard", sourceIds: ["unknown"], reason: "Low-value memory" },
        ],
      }),
    );

    const result = await reviewMemoryValues({
      scope: { kind: "chat", id: "chat-1" },
      sources: [source({ id: "junk" })],
      connectionId: "connection-1",
      llm,
    });

    expect(result.proposals).toEqual([
      expect.objectContaining({
        type: "discard",
        sourceIds: ["junk"],
        reason: "Low-value memory",
      }),
    ]);
  });
});
