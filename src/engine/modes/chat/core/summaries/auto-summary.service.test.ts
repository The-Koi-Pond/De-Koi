import { describe, expect, it, vi } from "vitest";
import type { LlmGateway } from "../../../../capabilities/llm";
import type { StorageGateway } from "../../../../capabilities/storage";
import { backfillConversationSummaries } from "./auto-summary.service";

function createBackfillHarness(messageCreatedAt: string, metadata: Record<string, unknown> = {}) {
  const patchedSummaries: Array<{
    daySummaries?: Record<string, unknown>;
    weekSummaries?: Record<string, unknown>;
  }> = [];
  const records = new Map<string, unknown>([
    [
      "chats:chat-1",
      {
        id: "chat-1",
        mode: "conversation",
        connectionId: "summary-connection",
        characterIds: [],
        metadata: {
          dayRolloverHour: 0,
          ...metadata,
        },
      },
    ],
    ["connections:summary-connection", { id: "summary-connection", provider: "test", model: "summary-model" }],
    [
      "messages:message-1",
      {
        id: "message-1",
        chatId: "chat-1",
        role: "user",
        content: "Timezone-sensitive message.",
        createdAt: messageCreatedAt,
      },
    ],
  ]);

  return {
    records,
    patchedSummaries,
    capabilities: {
      storage: {
        async get(collection: string, id: string) {
          return records.get(`${collection}:${id}`) ?? null;
        },
        async list(collection: string) {
          return [...records.entries()]
            .filter(([key]) => key.startsWith(`${collection}:`))
            .map(([, value]) => value);
        },
        async listChatMessages(chatId: string) {
          return [...records.entries()]
            .filter(([key, value]) => key.startsWith("messages:") && (value as { chatId?: string }).chatId === chatId)
            .map(([, value]) => value);
        },
        async getChatMessage(_messageId: string) {
          return null;
        },
        async patchChatSummaries(
          _chatId: string,
          summaries: { daySummaries?: Record<string, unknown>; weekSummaries?: Record<string, unknown> },
        ) {
          patchedSummaries.push(summaries);
          const chat = records.get("chats:chat-1") as { metadata?: Record<string, unknown> } | undefined;
          const metadata = { ...chat?.metadata };
          for (const field of ["daySummaries", "weekSummaries"] as const) {
            if (!summaries[field]) continue;
            metadata[field] = { ...(metadata[field] as Record<string, unknown> | undefined), ...summaries[field] };
          }
          records.set("chats:chat-1", { ...chat, metadata });
        },
      } as unknown as StorageGateway,
      llm: {
        async complete() {
          return JSON.stringify({ summary: "Old day summarized.", keyDetails: ["Remember the old day."] });
        },
        async *stream() {
          yield { type: "done" as const };
        },
        async listModels() {
          return [];
        },
      } as LlmGateway,
    },
  };
}

describe("backfillConversationSummaries", () => {
  it("uses the runtime timezone when assigning conversation day buckets", async () => {
    const { capabilities, patchedSummaries } = createBackfillHarness("2020-01-01T15:30:00.000Z");

    const result = await backfillConversationSummaries(capabilities, {
      chatId: "chat-1",
      connectionId: "summary-connection",
      maxMissingDays: 14,
      timeZone: "Asia/Tokyo",
    });

    expect(result.generatedDays).toEqual(["02.01.2020"]);
    expect(patchedSummaries[0]?.daySummaries).toHaveProperty("02.01.2020");
  });

  it("uses the stored prompt timezone before the runtime timezone", async () => {
    const { capabilities, patchedSummaries } = createBackfillHarness("2020-01-01T03:30:00.000Z", {
      promptTimeZone: "America/New_York",
    });

    const result = await backfillConversationSummaries(capabilities, {
      chatId: "chat-1",
      connectionId: "summary-connection",
      maxMissingDays: 14,
      timeZone: "Asia/Tokyo",
    });

    expect(result.generatedDays).toEqual(["31.12.2019"]);
    expect(patchedSummaries[0]?.daySummaries).toHaveProperty("31.12.2019");
  });

  it("propagates aborts from summary completion instead of recording a failed summary", async () => {
    const controller = new AbortController();
    let completionSignal: AbortSignal | undefined;
    const { capabilities, patchedSummaries } = createBackfillHarness("2020-01-01T15:30:00.000Z");
    capabilities.llm.complete = vi.fn(async (_request, signal) => {
      completionSignal = signal;
      controller.abort();
      throw Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
    });

    await expect(
      backfillConversationSummaries(capabilities, {
        chatId: "chat-1",
        connectionId: "summary-connection",
        maxMissingDays: 14,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(completionSignal).toBe(controller.signal);
    expect(patchedSummaries).toEqual([]);
  });

  it("resolves Random to a concrete NanoGPT connection before summarizing", async () => {
    const { capabilities, records } = createBackfillHarness("2020-01-01T15:30:00.000Z");
    records.set("chats:chat-1", {
      ...(records.get("chats:chat-1") as Record<string, unknown>),
      connectionId: "random",
    });
    records.delete("connections:summary-connection");
    records.set("connections:nanogpt-1", {
      id: "nanogpt-1",
      provider: "nanogpt",
      model: "summary-model",
      enabled: true,
      useForRandom: true,
    });
    const requests: Array<{ connectionId?: string }> = [];
    capabilities.llm.complete = vi.fn(async (request) => {
      requests.push(request);
      return JSON.stringify({ summary: "Random summary.", keyDetails: [] });
    });

    await backfillConversationSummaries(capabilities, {
      chatId: "chat-1",
      connectionId: "random",
      maxMissingDays: 14,
    });

    expect(requests[0]?.connectionId).toBe("nanogpt-1");
  });

  it("checkpoints a completed day before an aborted weekly consolidation and does not regenerate it", async () => {
    const controller = new AbortController();
    const existingDaySummaries = Object.fromEntries(
      ["07.07.2025", "08.07.2025", "09.07.2025", "10.07.2025", "11.07.2025", "12.07.2025"].map((date) => [
        date,
        { summary: `Stored summary for ${date}.`, keyDetails: [] },
      ]),
    );
    const { capabilities, patchedSummaries, records } = createBackfillHarness("2025-07-07T12:00:00.000Z", {
      daySummaries: existingDaySummaries,
    });
    for (let day = 8; day <= 13; day += 1) {
      records.set(`messages:message-${day}`, {
        id: `message-${day}`,
        chatId: "chat-1",
        role: "user",
        content: `Message for 2025-07-${String(day).padStart(2, "0")}.`,
        createdAt: `2025-07-${String(day).padStart(2, "0")}T12:00:00.000Z`,
      });
    }
    let summaryCallCount = 0;
    capabilities.llm.complete = vi.fn(async (_request, signal) => {
      summaryCallCount += 1;
      if (summaryCallCount === 1) {
        return JSON.stringify({ summary: "Sunday summary.", keyDetails: ["Sunday detail."] });
      }

      expect(signal).toBe(controller.signal);
      expect(patchedSummaries).toEqual([
        {
          daySummaries: {
            "13.07.2025": { summary: "Sunday summary.", keyDetails: ["Sunday detail."] },
          },
        },
      ]);
      controller.abort();
      throw Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
    });

    await expect(
      backfillConversationSummaries(capabilities, {
        chatId: "chat-1",
        connectionId: "summary-connection",
        maxMissingDays: 14,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });

    const replayComplete = vi.fn(async () => JSON.stringify({ summary: "Week summary.", keyDetails: [] }));
    capabilities.llm.complete = replayComplete;
    await backfillConversationSummaries(capabilities, {
      chatId: "chat-1",
      connectionId: "summary-connection",
      maxMissingDays: 14,
    });

    expect(replayComplete).toHaveBeenCalledTimes(1);
  });

  it("patches a generated day once when that week is already consolidated", async () => {
    const { capabilities, patchedSummaries } = createBackfillHarness("2020-01-01T15:30:00.000Z", {
      weekSummaries: {
        "30.12.2019": { summary: "Existing week summary.", keyDetails: [] },
      },
    });

    await backfillConversationSummaries(capabilities, {
      chatId: "chat-1",
      connectionId: "summary-connection",
      maxMissingDays: 14,
    });

    expect(patchedSummaries).toHaveLength(1);
    expect(patchedSummaries[0]).toEqual({
      daySummaries: {
        "01.01.2020": { summary: "Old day summarized.", keyDetails: ["Remember the old day."] },
      },
    });
  });

  it("records a failed day checkpoint without consolidating that unpersisted day", async () => {
    const existingDaySummaries = Object.fromEntries(
      ["07.07.2025", "08.07.2025", "09.07.2025", "10.07.2025", "11.07.2025", "12.07.2025"].map((date) => [
        date,
        { summary: `Stored summary for ${date}.`, keyDetails: [] },
      ]),
    );
    const { capabilities, records } = createBackfillHarness("2025-07-07T12:00:00.000Z", {
      daySummaries: existingDaySummaries,
    });
    for (let day = 8; day <= 13; day += 1) {
      records.set(`messages:message-${day}`, {
        id: `message-${day}`,
        chatId: "chat-1",
        role: "user",
        content: `Message for 2025-07-${String(day).padStart(2, "0")}.`,
        createdAt: `2025-07-${String(day).padStart(2, "0")}T12:00:00.000Z`,
      });
    }
    const checkpointFailure = vi.fn(async () => {
      throw new Error("Summary checkpoint unavailable.");
    });
    capabilities.storage.patchChatSummaries = checkpointFailure as StorageGateway["patchChatSummaries"];
    const complete = vi.fn(async () => JSON.stringify({ summary: "Sunday summary.", keyDetails: ["Sunday detail."] }));
    capabilities.llm.complete = complete;

    const result = await backfillConversationSummaries(capabilities, {
      chatId: "chat-1",
      connectionId: "summary-connection",
      maxMissingDays: 14,
    });

    expect(result.generatedDays).toEqual([]);
    expect(result.failedDays).toEqual([
      { date: "13.07.2025", error: "Summary checkpoint unavailable." },
    ]);
    expect(checkpointFailure).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("patches generated days and consolidated weeks separately", async () => {
    const { capabilities, patchedSummaries } = createBackfillHarness("2020-01-01T15:30:00.000Z");

    await backfillConversationSummaries(capabilities, {
      chatId: "chat-1",
      connectionId: "summary-connection",
      maxMissingDays: 14,
    });

    expect(patchedSummaries).toHaveLength(2);
    expect(patchedSummaries[0]?.daySummaries).toHaveProperty("01.01.2020");
    expect(patchedSummaries[0]?.weekSummaries).toBeUndefined();
    expect(patchedSummaries[1]?.daySummaries).toBeUndefined();
    expect(patchedSummaries[1]?.weekSummaries).toHaveProperty("30.12.2019");
  });
});
