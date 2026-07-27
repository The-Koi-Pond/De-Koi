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
            reason: "Overlapping detail",
          },
        ],
      });
    });

    const preview = await analyzeMemoryCleanup({
      scope: { kind: "character", id: "mira" },
      sources: [
        source({ id: "memory-a", content: "Mira has and keeps the brass key." }),
        source({ id: "memory-b", content: "Mira keeps the brass key in her pocket." }),
        source({ id: "unrelated", content: "The ferry leaves before dawn.", messageIds: ["unrelated-chat-message"] }),
      ],
      connectionId: "connection-1",
      llm,
    });

    expect(preview.proposals).toHaveLength(1);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.connectionId).toBe("connection-1");
    expect(requests[0]?.parameters).toEqual({ temperature: 0, maxTokens: 1_200 });
    expect(JSON.stringify(requests)).not.toContain("unrelated-chat-message");
    expect(preview.beforeCount).toBe(3);
    expect(preview.afterCount).toBe(2);
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
});
