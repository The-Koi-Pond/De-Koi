import { describe, expect, it, vi } from "vitest";

import type { LlmGateway, LlmRequest } from "../capabilities/llm";
import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import {
  memorySearchQuery,
  memorySearchWordsWithin,
  parseMemorySearchWords,
  startMemorySearchWords,
} from "./memory-search-words";
import type { JsonRecord } from "./runtime-records";

const CONNECTIONS: JsonRecord[] = [
  { id: "reply", name: "Reply", provider: "anthropic", model: "big-model" },
  { id: "quick", name: "Quick", provider: "openai", model: "small-model" },
  { id: "sub", name: "Subscription", provider: "claude_subscription", model: "haiku" },
  { id: "slow", name: "Slow", provider: "openai", model: "slow-model" },
];

function routingStorage(routes: Record<string, string> = {}): StorageGateway {
  const rows = new Map<string, JsonRecord>([
    ["app-settings:model-routing", { id: "model-routing", value: { version: 1, routes } }],
  ]);
  return {
    get: vi.fn(async (entity: StorageEntity, id: string) =>
      entity === "connections"
        ? (CONNECTIONS.find((connection) => connection.id === id) ?? null)
        : (rows.get(`${entity}:${id}`) ?? null),
    ),
    list: vi.fn(async (entity: StorageEntity) => (entity === "connections" ? CONNECTIONS : [])),
    create: vi.fn(async (_entity: StorageEntity, value: JsonRecord) => value),
    update: vi.fn(async (_entity: StorageEntity, _id: string, patch: JsonRecord) => patch),
    updateAppSettingsIfUnchanged: vi.fn(async (_id: string, _expected: unknown, value: unknown) => ({
      updated: true,
      record: { value },
    })),
  } as unknown as StorageGateway;
}

function helperLlm(answer: (request: LlmRequest, signal?: AbortSignal) => Promise<string>) {
  const requests: LlmRequest[] = [];
  const llm = {
    complete: vi.fn(async (request: LlmRequest, signal?: AbortSignal) => {
      requests.push(request);
      return answer(request, signal);
    }),
  } as unknown as LlmGateway;
  return { llm, requests };
}

function start(
  storage: StorageGateway,
  llm: LlmGateway,
  overrides: { hasMemories?: boolean; signal?: AbortSignal; now?: () => number } = {},
) {
  return startMemorySearchWords({
    storage,
    llm,
    chatId: "chat-1",
    text: "Are you staying dry in what I lent you back at the lock?",
    hasMemories: async () => overrides.hasMemories ?? true,
    replyConnection: async () => CONNECTIONS[0]!,
    signal: overrides.signal,
    now: overrides.now,
  });
}

describe("parseMemorySearchWords", () => {
  it("keeps a comma-separated list from the first line", () => {
    expect(parseMemorySearchWords("Words: oilskin, coat, lock gate\nThese are likely.")).toBe(
      "oilskin, coat, lock gate",
    );
  });

  it("returns null for an answer that is not a word list", () => {
    expect(parseMemorySearchWords("I can't help with that.")).toBeNull();
    expect(parseMemorySearchWords("")).toBeNull();
  });

  it("caps a long list", () => {
    const words = parseMemorySearchWords(Array.from({ length: 80 }, (_, index) => `word${index}`).join(", "));
    expect(words!.length).toBeLessThanOrEqual(240);
    expect(words!.startsWith("word0, word1")).toBe(true);
  });
});

describe("memorySearchQuery", () => {
  it("adds the words on their own line, or leaves the message alone", () => {
    expect(memorySearchQuery("Where's my coat?", "oilskin, coat")).toBe("Where's my coat?\noilskin, coat");
    expect(memorySearchQuery("Where's my coat?", null)).toBe("Where's my coat?");
  });
});

describe("startMemorySearchWords", () => {
  it("asks the reply's background connection when no Memory route is set", async () => {
    const { llm, requests } = helperLlm(async () => "oilskin, coat, lock, rain");
    const pending = start(routingStorage(), llm);

    await expect(memorySearchWordsWithin(pending, { waitMs: 1_000 })).resolves.toMatchObject({
      words: "oilskin, coat, lock, rain",
      late: false,
    });
    expect(requests[0]).toMatchObject({ connectionId: "reply", model: "big-model" });
    expect(requests[0]!.messages.at(-1)!.content).toContain("what I lent you back at the lock");
  });

  it("uses the Memory route when one is set", async () => {
    const { llm, requests } = helperLlm(async () => "oilskin, coat");
    await memorySearchWordsWithin(start(routingStorage({ memory: "quick" }), llm), { waitMs: 1_000 });
    expect(requests[0]).toMatchObject({ connectionId: "quick", model: "small-model" });
  });

  it("makes no call for a chat with nothing saved yet", async () => {
    const { llm } = helperLlm(async () => "oilskin, coat");
    const result = await memorySearchWordsWithin(start(routingStorage(), llm, { hasMemories: false }), {
      waitMs: 1_000,
    });
    expect(result.words).toBeNull();
    expect(llm.complete).not.toHaveBeenCalled();
  });

  // Claude Subscription starts the Claude app per call (~4-5 s): the words could never beat the wait.
  it("skips Claude Subscription and says why in Helper Models", async () => {
    const storage = routingStorage({ memory: "sub" });
    const { llm } = helperLlm(async () => "oilskin, coat");
    const result = await memorySearchWordsWithin(start(storage, llm), { waitMs: 1_000 });
    expect(result.words).toBeNull();
    expect(llm.complete).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(storage.create).toHaveBeenCalledWith(
        "app-settings",
        expect.objectContaining({
          id: "helper-run.memory",
          value: expect.objectContaining({
            runs: [expect.objectContaining({ job: "memory search", problem: expect.stringContaining("too slow") })],
          }),
        }),
      ),
    );
  });

  it("stops waiting at the deadline and cancels the late call", async () => {
    let aborted = false;
    const { llm } = helperLlm(
      (_request, signal) =>
        new Promise<string>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("aborted"));
          });
        }),
    );
    const pending = start(routingStorage(), llm);
    await vi.waitFor(() => expect(llm.complete).toHaveBeenCalled());

    const result = await memorySearchWordsWithin(pending, { waitMs: 30 });

    expect(result).toMatchObject({ words: null, late: true });
    expect(aborted).toBe(true);
  });

  it("searches with the message alone when the helper fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { llm } = helperLlm(async () => {
      throw new Error("provider down");
    });
    const result = await memorySearchWordsWithin(start(routingStorage(), llm), { waitMs: 1_000 });
    expect(result).toMatchObject({ words: null, late: false });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("stops the call when the reply is stopped", async () => {
    const controller = new AbortController();
    let aborted = false;
    const { llm } = helperLlm(
      (_request, signal) =>
        new Promise<string>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("aborted"));
          });
        }),
    );
    const pending = start(routingStorage(), llm, { signal: controller.signal });
    await vi.waitFor(() => expect(llm.complete).toHaveBeenCalled());
    controller.abort();
    await expect(pending.words).resolves.toBeNull();
    expect(aborted).toBe(true);
  });

  // A Pi on a 3-5 s helper made a cancelled call on every reply.
  it("skips a connection that answered late three replies in a row, then tries it again later", async () => {
    let clock = 1_000_000;
    const now = () => clock;
    const storage = routingStorage({ memory: "slow" });
    const { llm } = helperLlm(
      (_request, signal) =>
        new Promise<string>((_resolve, reject) =>
          signal?.addEventListener("abort", () => reject(new Error("aborted"))),
        ),
    );
    for (let reply = 0; reply < 3; reply += 1) {
      const pending = start(storage, llm, { now });
      await vi.waitFor(() => expect(llm.complete).toHaveBeenCalledTimes(reply + 1));
      clock += 2_500;
      await expect(memorySearchWordsWithin(pending, { waitMs: 2_000, now })).resolves.toMatchObject({ late: true });
    }

    const skipped = await memorySearchWordsWithin(start(storage, llm, { now }), { waitMs: 2_000, now });
    expect(skipped.words).toBeNull();
    expect(llm.complete).toHaveBeenCalledTimes(3);
    await vi.waitFor(() =>
      expect(vi.mocked(storage.create).mock.calls.at(-1)?.[1]).toMatchObject({
        value: {
          runs: [expect.objectContaining({ job: "memory search", problem: expect.stringContaining("too late") })],
        },
      }),
    );

    clock += 31 * 60_000;
    const retry = start(storage, llm, { now });
    await vi.waitFor(() => expect(llm.complete).toHaveBeenCalledTimes(4));
    retry.cancel();
  });

  it("gives thinking models room to finish the list", async () => {
    const { llm, requests } = helperLlm(async () => "oilskin, coat");
    await memorySearchWordsWithin(start(routingStorage({ memory: "quick" }), llm), { waitMs: 1_000 });
    expect(requests[0]!.parameters).toMatchObject({ maxTokens: 600 });
  });
});
