import { describe, expect, it } from "vitest";
import type { LlmGateway } from "../../../../capabilities/llm";
import type { StorageGateway } from "../../../../capabilities/storage";
import { backfillConversationSummaries } from "./auto-summary.service";

function createBackfillHarness(messageCreatedAt: string, metadata: Record<string, unknown> = {}) {
  const patchedSummaries: Array<{ daySummaries?: Record<string, unknown> }> = [];
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
        async patchChatSummaries(_chatId: string, summaries: { daySummaries?: Record<string, unknown> }) {
          patchedSummaries.push(summaries);
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
});
