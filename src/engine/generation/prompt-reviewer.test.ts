import { describe, expect, it, vi } from "vitest";
import type { LlmGateway, LlmRequest } from "../capabilities/llm";
import type { StorageGateway } from "../capabilities/storage";
import { reviewPromptPreset, type PromptReviewEvent } from "./prompt-reviewer";

function createStorage(): StorageGateway {
  const storage = {
    async get<T = unknown>(entity: Parameters<StorageGateway["get"]>[0], id: string): Promise<T | null> {
      if (entity === "prompts" && id === "preset-1") {
        return {
          id,
          name: "Streaming preset",
          wrapFormat: "xml",
          description: "Used by the prompt reviewer regression test.",
        } as T;
      }
      return null;
    },
    async list<T = unknown>(): Promise<T[]> {
      return [];
    },
    async getChatMessage<T = unknown>(): Promise<T | null> {
      return null;
    },
    async promptFull<T = unknown>(): Promise<T | null> {
      return {
        preset: { sectionOrder: ["section-1"] },
        groups: [],
        choiceBlocks: [],
        sections: [
          {
            id: "section-1",
            enabled: true,
            name: "System",
            role: "system",
            content: "Stay in character.",
          },
        ],
      } as T;
    },
  };
  return storage as unknown as StorageGateway;
}

async function collect(events: AsyncGenerator<PromptReviewEvent>): Promise<PromptReviewEvent[]> {
  const output: PromptReviewEvent[] = [];
  for await (const event of events) output.push(event);
  return output;
}

describe("reviewPromptPreset", () => {
  it("streams review tokens when streaming is enabled", async () => {
    const complete = vi.fn<LlmGateway["complete"]>(async () => '{"summary":"completed"}');
    const stream = vi.fn<LlmGateway["stream"]>(async function* (_request: LlmRequest) {
      yield { type: "token", text: '{"summary":' };
      yield { type: "token", text: '"streamed"}' };
    });
    const llm: LlmGateway = { complete, stream, listModels: vi.fn(async () => []) };

    const events = await collect(
      reviewPromptPreset(
        { storage: createStorage(), llm },
        { presetId: "preset-1", connectionId: "conn-1", streaming: true },
      ),
    );

    expect(stream).toHaveBeenCalledTimes(1);
    expect(complete).not.toHaveBeenCalled();
    expect(events).toEqual([
      { type: "token", data: '{"summary":' },
      { type: "token", data: '"streamed"}' },
      { type: "done", data: '{\n  "summary": "streamed"\n}' },
    ]);
  });

  it("falls back to raw review text when the model returns non-JSON output", async () => {
    const rawReview = "Useful plain-text review with actionable feedback.";
    const llm: LlmGateway = {
      complete: vi.fn(async () => rawReview),
      stream: vi.fn(async function* () {}),
      listModels: vi.fn(async () => []),
    };

    const events = await collect(
      reviewPromptPreset({ storage: createStorage(), llm }, { presetId: "preset-1", connectionId: "conn-1" }),
    );

    expect(events).toEqual([
      { type: "token", data: rawReview },
      { type: "done", data: rawReview },
    ]);
  });
});
