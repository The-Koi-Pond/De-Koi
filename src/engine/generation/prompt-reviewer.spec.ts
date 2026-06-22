import { describe, expect, it, vi } from "vitest";
import type { LlmChunk, LlmGateway, LlmRequest } from "../capabilities/llm";
import type { StorageGateway } from "../capabilities/storage";
import { reviewPromptPreset, type PromptReviewEvent } from "./prompt-reviewer";

async function collectEvents(generator: AsyncGenerator<PromptReviewEvent>): Promise<PromptReviewEvent[]> {
  const events: PromptReviewEvent[] = [];
  for await (const event of generator) events.push(event);
  return events;
}

function promptReviewStorage(): StorageGateway {
  return {
    get: vi.fn(async (entity: string, id: string) =>
      entity === "prompts" && id === "preset-1"
        ? { id, name: "Preset", wrapFormat: "xml", description: "Test preset" }
        : null,
    ),
    promptFull: vi.fn(async () => ({
      preset: { id: "preset-1", sectionOrder: ["section-1"] },
      groups: [],
      choiceBlocks: [],
      sections: [
        {
          id: "section-1",
          name: "Main",
          role: "system",
          content: "Stay concise.",
          enabled: true,
          order: 0,
        },
      ],
    })),
    list: vi.fn(async () => []),
  } as unknown as StorageGateway;
}

function streamLlm(chunks: LlmChunk[]): LlmGateway {
  return {
    complete: vi.fn(),
    async *stream(_request: LlmRequest) {
      for (const chunk of chunks) yield chunk;
    },
    listModels: vi.fn(async () => []),
  } as unknown as LlmGateway;
}

function tokenText(events: PromptReviewEvent[]): string {
  return events
    .filter((event): event is Extract<PromptReviewEvent, { type: "token" }> => event.type === "token")
    .map((event) => event.data)
    .join("");
}

describe("reviewPromptPreset", () => {
  it("does not emit leading thinking as streamed token events", async () => {
    const events = await collectEvents(
      reviewPromptPreset(
        {
          storage: promptReviewStorage(),
          llm: streamLlm([
            { type: "token", text: "<thi" },
            { type: "token", text: "nk>hidden" },
            { type: "token", text: "</think>" },
            { type: "token", text: '{"summary":"ok"}' },
          ]),
        },
        { presetId: "preset-1", connectionId: "conn-1", streaming: true },
      ),
    );

    expect(tokenText(events)).toBe('{"summary":"ok"}');
    expect(tokenText(events)).not.toContain("hidden");
    expect(events.at(-1)).toEqual({ type: "done", data: JSON.stringify({ summary: "ok" }, null, 2) });
  });

  it("still emits normal streamed review tokens", async () => {
    const events = await collectEvents(
      reviewPromptPreset(
        {
          storage: promptReviewStorage(),
          llm: streamLlm([
            { type: "token", text: '{"summary"' },
            { type: "token", text: ':"ok"}' },
          ]),
        },
        { presetId: "preset-1", connectionId: "conn-1", streaming: true },
      ),
    );

    expect(tokenText(events)).toBe('{"summary":"ok"}');
    expect(events.at(-1)).toEqual({ type: "done", data: JSON.stringify({ summary: "ok" }, null, 2) });
  });
});
