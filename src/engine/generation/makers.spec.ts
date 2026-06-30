import { describe, expect, it, vi } from "vitest";
import type { LlmChunk, LlmGateway, LlmRequest } from "../capabilities/llm";
import { generateCharacterMaker, type MakerEvent } from "./makers";

async function collectEvents(generator: AsyncGenerator<MakerEvent>): Promise<MakerEvent[]> {
  const events: MakerEvent[] = [];
  for await (const event of generator) events.push(event);
  return events;
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

function completeLlm(raw: string): LlmGateway {
  return {
    complete: vi.fn(async () => raw),
    stream: vi.fn(),
    listModels: vi.fn(async () => []),
  } as unknown as LlmGateway;
}

function tokenText(events: MakerEvent[]): string {
  return events
    .filter((event): event is Extract<MakerEvent, { type: "token" }> => event.type === "token")
    .map((event) => event.data)
    .join("");
}

describe("generateCharacterMaker", () => {
  it("requests public profile fields for generated character previews", async () => {
    const llm = completeLlm("{}");

    await collectEvents(
      generateCharacterMaker(
        {
          llm,
        },
        { prompt: "Create Mira", connectionId: "conn-1" },
      ),
    );

    const request = (llm.complete as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as LlmRequest | undefined;
    const systemPrompt = request?.messages.map((message) => message.content).join("\n") ?? "";

    expect(systemPrompt).toContain('"publicProfile"');
    expect(systemPrompt).toContain('"bio"');
  });

  it("asks the provider for JSON object output when generating a character", async () => {
    const llm = completeLlm("{}");

    await collectEvents(
      generateCharacterMaker(
        {
          llm,
        },
        { prompt: "Create Mira", connectionId: "conn-1" },
      ),
    );

    const request = (llm.complete as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as LlmRequest | undefined;

    expect(request?.parameters).toMatchObject({
      responseFormat: "json_object",
    });
  });

  it("frames public profile fields as choices the character would make", async () => {
    const llm = completeLlm("{}");

    await collectEvents(
      generateCharacterMaker(
        {
          llm,
        },
        { prompt: "Create Mira", connectionId: "conn-1" },
      ),
    );

    const request = (llm.complete as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as LlmRequest | undefined;
    const systemPrompt = request?.messages.map((message) => message.content).join("\n") ?? "";

    expect(systemPrompt).toContain("chosen by the character as their own public self-presentation");
    expect(systemPrompt).toContain("Write the handle, bio, and public tags in the character's voice");
  });

  it("does not emit leading thinking as streamed token events while still parsing visible JSON", async () => {
    const events = await collectEvents(
      generateCharacterMaker(
        {
          llm: streamLlm([
            { type: "token", text: "<think>hid" },
            { type: "token", text: "den</think>" },
            { type: "token", text: '{"name":"Mira"}' },
          ]),
        },
        { prompt: "Create Mira", connectionId: "conn-1", streaming: true },
      ),
    );
    const done = events.find((event): event is Extract<MakerEvent, { type: "done" }> => event.type === "done");

    expect(tokenText(events)).toBe('{"name":"Mira"}');
    expect(tokenText(events)).not.toContain("hidden");
    expect(JSON.parse(done?.data ?? "{}")).toEqual({ name: "Mira" });
  });

  it("still streams visible JSON promptly when no thinking block is present", async () => {
    const events = await collectEvents(
      generateCharacterMaker(
        {
          llm: streamLlm([
            { type: "token", text: '{"name"' },
            { type: "token", text: ':"Mira"}' },
          ]),
        },
        { prompt: "Create Mira", connectionId: "conn-1", streaming: true },
      ),
    );

    expect(tokenText(events)).toBe('{"name":"Mira"}');
  });

  it("does not emit non-streaming token text for a thinking-only response", async () => {
    const events = await collectEvents(
      generateCharacterMaker(
        {
          llm: completeLlm("<think>hidden</think>"),
        },
        { prompt: "Create Mira", connectionId: "conn-1" },
      ),
    );
    const done = events.find((event): event is Extract<MakerEvent, { type: "done" }> => event.type === "done");

    expect(tokenText(events)).toBe("");
    expect(JSON.stringify(events)).not.toContain("hidden");
    expect(done?.data).toBe("");
  });

  it("emits and parses only visible JSON for a non-streaming response with leading thinking", async () => {
    const events = await collectEvents(
      generateCharacterMaker(
        {
          llm: completeLlm('<think>hidden</think>{"name":"Mira"}'),
        },
        { prompt: "Create Mira", connectionId: "conn-1" },
      ),
    );
    const done = events.find((event): event is Extract<MakerEvent, { type: "done" }> => event.type === "done");

    expect(tokenText(events)).toBe('{"name":"Mira"}');
    expect(tokenText(events)).not.toContain("hidden");
    expect(JSON.parse(done?.data ?? "{}")).toEqual({ name: "Mira" });
  });
});
