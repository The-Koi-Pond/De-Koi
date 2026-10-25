import { describe, expect, it, vi } from "vitest";

import type { IntegrationGateway } from "../capabilities/integrations";
import type { LlmChunk, LlmGateway, LlmRequest } from "../capabilities/llm";
import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import type { GenerationEvent } from "./generation-events";
import { startGeneration } from "./start-generation";

type StoredMessage = {
  id: string;
  chatId: string;
  role: string;
  content: string;
  activeSwipeIndex: number;
  swipeCount: number;
  extra: Record<string, unknown>;
  swipes: Array<{ content: string; extra: Record<string, unknown> }>;
};

/** A plain conversation chat: the options must work without any mode knowing about them. */
function conversationStorage() {
  const records: Record<string, Record<string, unknown>> = {
    "chat-1": { id: "chat-1", mode: "conversation", connectionId: "conn-1", characterIds: [], metadata: {} },
    "conn-1": { id: "conn-1", provider: "test-provider", model: "test-model" },
  };
  const messages: StoredMessage[] = [];
  const swipeExtras: Array<Record<string, unknown>> = [];
  const extraPatches: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const storage = {
    async list<T>(entity: StorageEntity): Promise<T[]> {
      return (entity === "connections" ? [records["conn-1"]] : []) as T[];
    },
    async get<T>(entity: StorageEntity, id: string): Promise<T | null> {
      return ((entity === "chats" || entity === "connections") && records[id] ? records[id] : null) as T | null;
    },
    async create<T>(_entity: StorageEntity, value: Record<string, unknown>): Promise<T> {
      return value as T;
    },
    async update<T>(_entity: StorageEntity, id: string, patch: Record<string, unknown>): Promise<T> {
      records[id] = { ...records[id], ...patch };
      return records[id] as T;
    },
    async listChatMessages<T>(chatId: string): Promise<T[]> {
      return messages.filter((message) => message.chatId === chatId) as T[];
    },
    async getChatMessage<T>(messageId: string): Promise<T | null> {
      return (messages.find((message) => message.id === messageId) ?? null) as T | null;
    },
    async createChatMessage<T>(chatId: string, value: Record<string, unknown>): Promise<T> {
      const content = String(value.content ?? "");
      const extra = { ...((value.extra as Record<string, unknown> | undefined) ?? {}) };
      const message: StoredMessage = {
        id: `message-${messages.length + 1}`,
        chatId,
        role: String(value.role ?? ""),
        content,
        activeSwipeIndex: 0,
        swipeCount: 1,
        extra,
        swipes: [{ content, extra: { ...extra } }],
      };
      messages.push(message);
      return message as T;
    },
    async updateChatMessage<T>(messageId: string, patch: Record<string, unknown>): Promise<T> {
      const message = messages.find((item) => item.id === messageId)!;
      Object.assign(message, patch);
      // The runtime writes a patch into the displayed version too.
      const active = message.swipes[message.activeSwipeIndex]!;
      if (typeof patch.content === "string") active.content = patch.content;
      if (patch.extra) active.extra = { ...active.extra, ...(patch.extra as Record<string, unknown>) };
      updates.push(patch);
      return message as T;
    },
    async patchChatMessageExtra<T>(messageId: string, patch: Record<string, unknown>): Promise<T> {
      extraPatches.push(patch);
      const message = messages.find((item) => item.id === messageId)!;
      message.extra = { ...message.extra, ...patch };
      return message as T;
    },
    async addChatMessageSwipe<T>(
      _chatId: string,
      messageId: string,
      content: string,
      options?: { extra?: Record<string, unknown> },
    ): Promise<T> {
      swipeExtras.push(options?.extra ?? {});
      const message = messages.find((item) => item.id === messageId)!;
      message.swipes.push({ content, extra: options?.extra ?? {} });
      message.swipeCount = message.swipes.length;
      message.activeSwipeIndex = message.swipes.length - 1;
      message.content = content;
      return message as T;
    },
    async patchChatMetadata<T>(chatId: string, patch: Record<string, unknown>): Promise<T> {
      records[chatId] = { ...records[chatId], metadata: { ...(records[chatId]?.metadata as object), ...patch } };
      return records[chatId] as T;
    },
    async patchChatSummaries<T>(chatId: string): Promise<T> {
      return records[chatId] as T;
    },
    async listChatMemories<T>(): Promise<T[]> {
      return [];
    },
    async getWorldState<T>(): Promise<T | null> {
      return null;
    },
    async saveTrackerSnapshot<T>(): Promise<T> {
      return {} as T;
    },
    async listLorebookEntries<T>(): Promise<T[]> {
      return [];
    },
    async promptFull<T>(): Promise<T | null> {
      return null;
    },
  } as unknown as StorageGateway;
  return { storage, messages, swipeExtras, extraPatches, updates };
}

function replyLlm(chunks: LlmChunk[], failure?: Error, requests: LlmRequest[] = []): LlmGateway {
  return {
    complete: vi.fn(async () => ""),
    listModels: vi.fn(async () => []),
    async *stream(request) {
      requests.push(request);
      yield* chunks;
      if (failure) throw failure;
    },
  };
}

async function drain(generator: AsyncGenerator<GenerationEvent>): Promise<void> {
  for await (const _event of generator) {
    // Run the generation to the end.
  }
}

/** Runs the generation and returns its events plus the error it ended with, if any. */
async function run(generator: AsyncGenerator<GenerationEvent>): Promise<{ events: GenerationEvent[]; error: unknown }> {
  const events: GenerationEvent[] = [];
  try {
    for await (const event of generator) events.push(event);
  } catch (error) {
    return { events, error };
  }
  return { events, error: null };
}

const tokens = (...texts: string[]): LlmChunk[] => texts.map((text) => ({ type: "token", text }));

const deps = (storage: StorageGateway, llm: LlmGateway) => ({ storage, llm, integrations: {} as IntegrationGateway });
const VERSION = { models: [{ connectionId: "conn-1", name: "Writer", model: "test-model" }] };

/** Without the volatile prompt snapshot, which records when it was taken. */
function stableExtra(extra: Record<string, unknown>): Record<string, unknown> {
  const { generationPromptSnapshot: _snapshot, ...rest } = extra;
  return rest;
}

describe("startGeneration savedExtra", () => {
  it("adds the caller's extra to a new reply", async () => {
    const { storage, messages } = conversationStorage();

    await drain(
      startGeneration(deps(storage, replyLlm([{ type: "token", text: "Hello there." }])), {
        chatId: "chat-1",
        userMessage: "Hi.",
        savedExtra: { fanficVersion: VERSION },
      }),
    );

    const reply = messages.find((message) => message.role === "assistant");
    expect(reply?.extra.fanficVersion).toEqual(VERSION);
  });

  it("adds the caller's extra to a regenerated version, on the swipe and the message", async () => {
    const { storage, messages, swipeExtras, extraPatches } = conversationStorage();
    await drain(
      startGeneration(deps(storage, replyLlm([{ type: "token", text: "First." }])), {
        chatId: "chat-1",
        userMessage: "Hi.",
      }),
    );
    const reply = messages.find((message) => message.role === "assistant")!;

    await drain(
      startGeneration(deps(storage, replyLlm([{ type: "token", text: "Second." }])), {
        chatId: "chat-1",
        regenerateMessageId: reply.id,
        savedExtra: { fanficVersion: VERSION },
      }),
    );

    expect(swipeExtras.at(-1)?.fanficVersion).toEqual(VERSION);
    expect(extraPatches.at(-1)?.fanficVersion).toEqual(VERSION);
    expect(reply.swipes[0]!.extra.fanficVersion).toBeUndefined();
  });

  it("keeps the caller's extra on the partial reply saved when the stream breaks", async () => {
    const { storage, messages } = conversationStorage();
    const broken = Object.assign(new Error("LLM provider stream ended before a terminal event."), {
      code: "llm_stream_incomplete",
    });

    await expect(
      drain(
        startGeneration(deps(storage, replyLlm([{ type: "token", text: "The reply began, but" }], broken)), {
          chatId: "chat-1",
          userMessage: "Hi.",
          savedExtra: { fanficVersion: VERSION },
        }),
      ),
    ).rejects.toMatchObject({ code: "llm_stream_incomplete" });

    const reply = messages.find((message) => message.role === "assistant");
    expect(reply?.content).toBe("The reply began, but");
    expect(reply?.extra.fanficVersion).toEqual(VERSION);
  });

  it("saves the same reply as before when no extra is given, and never lets the caller replace a key the engine wrote", async () => {
    const plain = conversationStorage();
    await drain(
      startGeneration(deps(plain.storage, replyLlm([{ type: "token", text: "Hello there." }])), {
        chatId: "chat-1",
        userMessage: "Hi.",
      }),
    );
    const withExtra = conversationStorage();
    await drain(
      startGeneration(deps(withExtra.storage, replyLlm([{ type: "token", text: "Hello there." }])), {
        chatId: "chat-1",
        userMessage: "Hi.",
        savedExtra: { fanficVersion: VERSION, chatSummaryFingerprint: "caller", answersUserVersion: "caller" },
      }),
    );

    const plainReply = plain.messages.find((message) => message.role === "assistant")!;
    const extraReply = withExtra.messages.find((message) => message.role === "assistant")!;
    expect(plainReply.extra).not.toHaveProperty("fanficVersion");
    const { fanficVersion: _version, ...engineKeys } = stableExtra(extraReply.extra);
    expect(engineKeys).toEqual(stableExtra(plainReply.extra));
    expect(extraReply.extra.chatSummaryFingerprint).not.toBe("caller");
    expect(extraReply.extra.answersUserVersion).not.toBe("caller");
  });
});

describe("startGeneration keepStreamedTextOnFailure", () => {
  const keep = { chatId: "chat-1", userMessage: "Hi.", keepStreamedTextOnFailure: true };
  const reply = (messages: StoredMessage[]) => messages.find((message) => message.role === "assistant");

  it("asks the provider to report restarts only when the option is on", async () => {
    const withOption: LlmRequest[] = [];
    const without: LlmRequest[] = [];

    await drain(
      startGeneration(deps(conversationStorage().storage, replyLlm(tokens("Hi."), undefined, withOption)), keep),
    );
    await drain(
      startGeneration(deps(conversationStorage().storage, replyLlm(tokens("Hi."), undefined, without)), {
        chatId: "chat-1",
        userMessage: "Hi.",
      }),
    );

    expect(withOption[0]?.reportRestarts).toBe(true);
    expect(without[0]).not.toHaveProperty("reportRestarts");
  });

  it("saves exactly the text received before the first restart and fails with the restart code", async () => {
    const { storage, messages } = conversationStorage();
    const stream: LlmChunk[] = [
      ...tokens("The lamp", " flickered,"),
      { type: "text_reset" },
      ...tokens("A different reply."),
      { type: "text_reset" },
      ...tokens("A third."),
    ];

    const { events, error } = await run(startGeneration(deps(storage, replyLlm(stream)), keep));

    expect(error).toMatchObject({ code: "llm_stream_text_reset", message: expect.stringContaining("restarted") });
    expect(reply(messages)?.content).toBe("The lamp flickered,");
    const saved = events.find((event) => event.type === "assistant_message");
    expect(saved?.data).toMatchObject({ content: "The lamp flickered," });
    expect(events.filter((event) => event.type === "token").map((event) => event.data)).toEqual([
      "The lamp",
      " flickered,",
    ]);
  });

  it("keeps only the visible reply when a thinking block came before the restart", async () => {
    const { storage, messages } = conversationStorage();

    const { error } = await run(
      startGeneration(
        deps(storage, replyLlm([...tokens("<think>pondering</think>", "The door"), { type: "text_reset" }])),
        keep,
      ),
    );

    expect(error).toMatchObject({ code: "llm_stream_text_reset" });
    expect(reply(messages)?.content).toBe("The door");
    expect(reply(messages)?.extra.thinking).toBe("pondering");
  });

  it("saves nothing when the provider restarts before any reply text, even after some thinking", async () => {
    for (const before of [[], tokens("<think>still pondering")]) {
      const { storage, messages } = conversationStorage();

      const { error } = await run(startGeneration(deps(storage, replyLlm([...before, { type: "text_reset" }])), keep));

      expect(error).toMatchObject({ code: "llm_stream_text_reset" });
      expect(reply(messages)).toBeUndefined();
    }
  });

  it("saves the partial for any provider failure after text and hands the caller the original error", async () => {
    const { storage, messages } = conversationStorage();
    const failure: LlmChunk = {
      type: "error",
      text: "The provider stopped the reply.",
      data: { code: "llm_provider_error", response: { incomplete_details: { reason: "content_filter" } } },
    };

    const { error } = await run(startGeneration(deps(storage, replyLlm([...tokens("She opened"), failure])), keep));

    expect(error).toMatchObject({
      code: "llm_provider_error",
      message: "The provider stopped the reply.",
      details: { response: { incomplete_details: { reason: "content_filter" } } },
    });
    expect(reply(messages)?.content).toBe("She opened");
  });

  it("keeps the provider's details on a known interruption", async () => {
    const { storage, messages } = conversationStorage();
    const blocked: LlmChunk = {
      type: "error",
      text: "Google/Gemini stopped before completing the response (finishReason: SAFETY).",
      data: { code: "llm_stream_incomplete", finishReason: "SAFETY" },
    };

    const { error } = await run(startGeneration(deps(storage, replyLlm([...tokens("The blade"), blocked])), keep));

    expect(error).toMatchObject({ code: "llm_stream_incomplete", details: { finishReason: "SAFETY" } });
    expect(reply(messages)?.content).toBe("The blade");
  });

  it("saves nothing when the stream fails before any text", async () => {
    const { storage, messages } = conversationStorage();
    const failure = Object.assign(new Error("Network down."), { code: "llm_provider_error" });

    const { error } = await run(startGeneration(deps(storage, replyLlm([], failure)), keep));

    expect(error).toBe(failure);
    expect(reply(messages)).toBeUndefined();
  });

  it("says the received text was lost when saving it fails, and only with the option on", async () => {
    const failing = () => {
      const setup = conversationStorage();
      const create = setup.storage.createChatMessage.bind(setup.storage);
      setup.storage.createChatMessage = async (chatId, value) => {
        if (value.role === "assistant") throw new Error("disk full");
        return create(chatId, value);
      };
      return setup.storage;
    };
    const failure = () => Object.assign(new Error("Socket closed."), { code: "socket_closed" });

    const kept = await run(startGeneration(deps(failing(), replyLlm(tokens("Half"), failure())), keep));
    // A known interruption, so the save is attempted without the option too.
    const plainFailure = Object.assign(failure(), { code: "llm_stream_incomplete" });
    const plain = await run(
      startGeneration(deps(failing(), replyLlm(tokens("Half"), plainFailure)), {
        chatId: "chat-1",
        userMessage: "Hi.",
      }),
    );

    expect(kept.error).toMatchObject({
      code: "generation_partial_not_saved",
      message: "Socket closed. The text received so far could not be saved (disk full).",
      cause: expect.objectContaining({ code: "socket_closed" }),
    });
    expect(plain.error).toBe(plainFailure);
  });

  it("saves the partial of a regenerated reply as a new version and leaves the earlier one alone", async () => {
    const { storage, messages } = conversationStorage();
    await drain(startGeneration(deps(storage, replyLlm(tokens("First."))), { chatId: "chat-1", userMessage: "Hi." }));
    const target = reply(messages)!;
    const failure = Object.assign(new Error("Socket closed."), { code: "socket_closed" });

    const { error } = await run(
      startGeneration(deps(storage, replyLlm(tokens("Second, cut"), failure)), {
        chatId: "chat-1",
        regenerateMessageId: target.id,
        keepStreamedTextOnFailure: true,
      }),
    );

    expect(error).toBe(failure);
    expect(target.swipes.map((swipe) => swipe.content)).toEqual(["First.", "Second, cut"]);
  });

  it("keeps the provider's stop reason on a reply that ended normally", async () => {
    const { storage, messages } = conversationStorage();
    const stream: LlmChunk[] = [
      ...tokens("I can't write that."),
      { type: "provider_metadata", data: { stopReason: "refusal" } },
    ];

    const { events, error } = await run(startGeneration(deps(storage, replyLlm(stream)), keep));

    expect(error).toBeNull();
    expect(reply(messages)?.extra.providerMetadata).toEqual({ stopReason: "refusal" });
    const saved = events.find((event) => event.type === "assistant_message");
    expect(saved?.data).toMatchObject({ extra: { providerMetadata: { stopReason: "refusal" } } });
  });

  it("handles Stop the same way with or without the option", async () => {
    const stopAfterText = async (options: Record<string, unknown>) => {
      const { storage, messages } = conversationStorage();
      const controller = new AbortController();
      const llm: LlmGateway = {
        complete: vi.fn(async () => ""),
        listModels: vi.fn(async () => []),
        async *stream() {
          yield { type: "token", text: "Half a" };
          controller.abort();
          yield { type: "token", text: " sentence" };
        },
      };
      const { error } = await run(
        startGeneration(deps(storage, llm), { chatId: "chat-1", userMessage: "Hi.", ...options }, controller.signal),
      );
      const saved = reply(messages);
      return { error: (error as Error).name, content: saved?.content, interrupted: saved?.extra.generationInterrupted };
    };

    const withOption = await stopAfterText({ keepStreamedTextOnFailure: true });
    expect(withOption).toEqual(await stopAfterText({}));
    expect(withOption.content).toBe("Half a");
  });

  it("without the option, ignores a restart event and keeps today's failure handling", async () => {
    const restarted = conversationStorage();
    await drain(
      startGeneration(
        deps(restarted.storage, replyLlm([...tokens("One"), { type: "text_reset" }, ...tokens(" two")])),
        {
          chatId: "chat-1",
          userMessage: "Hi.",
        },
      ),
    );
    expect(reply(restarted.messages)?.content).toBe("One two");

    const failed = conversationStorage();
    const failure = Object.assign(new Error("Socket closed."), { code: "socket_closed" });
    const { error } = await run(
      startGeneration(deps(failed.storage, replyLlm(tokens("Half"), failure)), {
        chatId: "chat-1",
        userMessage: "Hi.",
      }),
    );
    expect(error).toBe(failure);
    expect(reply(failed.messages)).toBeUndefined();
  });
});

describe("startGeneration provider stop reasons", () => {
  const plainReply = async (chunks: LlmChunk[]) => {
    const setup = conversationStorage();
    await drain(startGeneration(deps(setup.storage, replyLlm(chunks)), { chatId: "chat-1", userMessage: "Hi." }));
    return setup;
  };
  const stopped = (data: Record<string, unknown>): LlmChunk => ({ type: "provider_metadata", data });
  const reply = (messages: StoredMessage[]) => messages.find((message) => message.role === "assistant");

  it("saves a reply without the stop reason, as before, when the caller doesn't keep streamed text", async () => {
    const before = await plainReply(tokens("Hello."));
    const withStopReason = await plainReply([...tokens("Hello."), stopped({ stopReason: "end_turn" })]);
    const finishedBefore = await plainReply([...tokens("Hello."), stopped({ finishReason: "stop" })]);
    const finishedWithStopReason = await plainReply([
      ...tokens("Hello."),
      stopped({ finishReason: "stop", stopReason: "end_turn" }),
    ]);

    const saved = (setup: Awaited<ReturnType<typeof plainReply>>) => stableExtra(reply(setup.messages)!.extra);
    expect(saved(withStopReason)).toEqual(saved(before));
    expect(reply(withStopReason.messages)!.extra).not.toHaveProperty("providerMetadata");
    expect(saved(finishedWithStopReason)).toEqual(saved(finishedBefore));
    expect(reply(finishedWithStopReason.messages)!.extra.providerMetadata).toEqual({ finishReason: "stop" });
  });

  it("doesn't send a stop reason back with earlier replies", async () => {
    const setup = await plainReply([...tokens("Hello."), stopped({ stopReason: "end_turn" })]);
    const requests: LlmRequest[] = [];

    await drain(
      startGeneration(deps(setup.storage, replyLlm(tokens("Again."), undefined, requests)), {
        chatId: "chat-1",
        userMessage: "Next.",
      }),
    );

    expect(requests[0]!.messages.some((message) => message.content.includes("Hello."))).toBe(true);
    expect(JSON.stringify(requests[0]!.messages)).not.toContain("stopReason");
  });
});

describe("startGeneration continueMessageId", () => {
  /** A chat whose last reply ("The lamp") is the message to continue. */
  async function chatWithReply() {
    const setup = conversationStorage();
    await drain(
      startGeneration(deps(setup.storage, replyLlm(tokens("The lamp"))), { chatId: "chat-1", userMessage: "Hi." }),
    );
    const target = setup.messages.find((message) => message.role === "assistant")!;
    return { ...setup, target };
  }
  const continueInput = (targetId: string, extra: Record<string, unknown> = {}) => ({
    chatId: "chat-1",
    continueMessageId: targetId,
    generationGuide: "Carry on from where the reply stops.",
    ...extra,
  });

  it("appends the reply to the displayed version of the message it continues", async () => {
    const { storage, messages, target } = await chatWithReply();
    const requests: LlmRequest[] = [];

    const { events, error } = await run(
      startGeneration(
        deps(storage, replyLlm(tokens(" flickered."), undefined, requests)),
        continueInput(target.id, { savedExtra: { fanficVersion: VERSION } }),
      ),
    );

    expect(error).toBeNull();
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(target.content).toBe("The lamp flickered.");
    expect(target.swipes).toHaveLength(1);
    expect(target.swipes[0]).toMatchObject({ content: "The lamp flickered.", extra: { fanficVersion: VERSION } });
    expect(events.find((event) => event.type === "assistant_message")?.data).toMatchObject({
      id: target.id,
      content: "The lamp flickered.",
    });
    // The text being continued is not sent again as an earlier reply.
    expect(requests[0]!.messages.some((message) => message.content.includes("The lamp"))).toBe(false);
  });

  it("replaces the continued version's stop reason with the new reply's", async () => {
    const { storage, target } = await chatWithReply();
    target.extra.providerMetadata = { stopReason: "max_tokens" };

    await drain(startGeneration(deps(storage, replyLlm(tokens(" flickered."))), continueInput(target.id)));

    expect(target.extra).not.toHaveProperty("providerMetadata");
  });

  it("keeps the earlier text plus the new partial when the continuation is cut off", async () => {
    const { storage, target } = await chatWithReply();
    const failure = Object.assign(new Error("Socket closed."), { code: "socket_closed" });

    const { error } = await run(
      startGeneration(
        deps(storage, replyLlm(tokens(" flick"), failure)),
        continueInput(target.id, { keepStreamedTextOnFailure: true }),
      ),
    );

    expect(error).toBe(failure);
    expect(target.content).toBe("The lamp flick");
    expect(target.swipes).toHaveLength(1);
  });

  it("leaves the message as it was when the continuation fails before any text", async () => {
    const { storage, target, updates } = await chatWithReply();
    const before = structuredClone(target);
    const failure = Object.assign(new Error("Socket closed."), { code: "socket_closed" });

    const { error } = await run(
      startGeneration(
        deps(storage, replyLlm([], failure)),
        continueInput(target.id, { keepStreamedTextOnFailure: true }),
      ),
    );

    expect(error).toBe(failure);
    expect(target).toEqual(before);
    expect(updates).toEqual([]);
  });
});
