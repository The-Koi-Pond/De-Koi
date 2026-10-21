import { describe, expect, it, vi } from "vitest";

import type { LlmGateway } from "../capabilities/llm";
import {
  groundHabitScan,
  readHabitScan,
  habitScanDue,
  habitScanGuidance,
  runHabitScan,
  runHabitScanIfDue,
  scheduleHabitScan,
  type HabitScan,
  type ScheduleHabitScanInput,
} from "./habit-scan";

const replies = [
  'Kaul taps her pen on the clipboard. "Twenty minutes." The fan rattles.',
  "Pell laughs, thin. Kaul taps her pen on the clipboard again. The fan rattles.",
  'Mags locks the door. "Nineteen." Kaul taps her pen on the clipboard.',
  "The generator coughs. Kaul taps her pen on the clipboard. The fan rattles.",
];

function chatMessages(contents: string[]) {
  return contents.flatMap((content, index) => [
    { id: `u${index}`, role: "user", content: `I keep going (${index}).` },
    { id: `a${index}`, role: "assistant", content },
  ]);
}

function llmReturning(raw: string): LlmGateway {
  return { complete: vi.fn(async () => raw) } as unknown as LlmGateway;
}

describe("habit scan", () => {
  it("keeps only habits whose quotes are in the replies and that span two replies", () => {
    const habits = groundHabitScan(
      [
        { habit: "Kaul's pen on the clipboard", replies: [1, 2, 3, 4], quotes: ["Kaul taps her pen on the clipboard"] },
        { habit: "Invented quote", replies: [1, 2, 3], quotes: ["She smooths her skirt"] },
        { habit: "Twice", replies: [1, 2], quotes: ["The fan rattles."] },
        { habit: "Only once", replies: [3], quotes: ["Mags locks the door."] },
        { habit: "Out of range replies", replies: [1, 9, 12], quotes: ["The fan rattles."] },
      ],
      replies,
    );

    expect(habits).toEqual([
      { habit: "Kaul's pen on the clipboard", replies: 4, quotes: ["Kaul taps her pen on the clipboard"] },
      { habit: "Twice", replies: 2, quotes: ["The fan rattles."] },
    ]);
  });

  it("reads the latest replies, grounds the answer, and records where it stopped", async () => {
    const llm = llmReturning(
      JSON.stringify({
        habits: [{ habit: "Fan noise as a pause", replies: [1, 2, 4], quotes: ["The fan rattles.", "made up"] }],
      }),
    );
    const scan = await runHabitScan(
      { llm },
      { messages: chatMessages(replies), mode: "roleplay", now: () => new Date("2026-10-19T12:00:00.000Z") },
    );

    expect(scan).toEqual({
      version: 2,
      throughMessageId: "a3",
      scannedReplies: 4,
      habits: [{ habit: "Fan noise as a pause", replies: 3, quotes: ["The fan rattles."] }],
      scannedAt: "2026-10-19T12:00:00.000Z",
    });
    const request = vi.mocked(llm.complete).mock.calls[0]![0];
    expect(request.messages.at(-1)?.content).toContain("Reply 4:\nThe generator coughs.");
  });

  it("waits for two replies, then rescans after every new one or when its last reply is gone", () => {
    const scan = { throughMessageId: "a3" } as HabitScan;

    expect(habitScanDue(chatMessages(replies.slice(0, 1)), null)).toBe(false);
    expect(habitScanDue(chatMessages(replies.slice(0, 2)), null)).toBe(true);
    expect(habitScanDue(chatMessages(replies), scan)).toBe(false);
    expect(habitScanDue(chatMessages([...replies, "Five."]), scan)).toBe(true);
    expect(habitScanDue(chatMessages(replies), { throughMessageId: "deleted" } as HabitScan)).toBe(true);
  });

  it("asks about texting habits in Conversation mode", async () => {
    const llm = llmReturning(JSON.stringify({ habits: [] }));
    const scan = await runHabitScan(
      { llm },
      { messages: chatMessages(["ok. bed.", "ok. eat."]), mode: "conversation" },
    );

    expect(scan?.habits).toEqual([]);
    const request = vi.mocked(llm.complete).mock.calls[0]![0];
    expect(request.messages[0]?.content).toContain("texts a character sent in a chat");
    expect(request.messages[0]?.content).toContain("running joke or callback");
  });

  it("runs a due scan once per chat in the background and stores it on the chat", async () => {
    vi.useFakeTimers();
    try {
      const messages = chatMessages(replies);
      const storage = {
        get: vi.fn(async () => ({ id: "chat-1", metadata: {} })),
        listChatMessages: vi.fn(async () => [...messages].reverse()),
        patchChatMetadata: vi.fn(async () => ({})),
      };
      const llm = llmReturning(
        JSON.stringify({
          habits: [{ habit: "Fan noise as a pause", replies: [1, 2, 4], quotes: ["The fan rattles."] }],
        }),
      );

      scheduleHabitScan({
        storage: storage as unknown as ScheduleHabitScanInput["storage"],
        llm,
        chatId: "chat-1",
        mode: "roleplay",
      });
      scheduleHabitScan({
        storage: storage as unknown as ScheduleHabitScanInput["storage"],
        llm,
        chatId: "chat-1",
        mode: "roleplay",
      });
      await vi.runAllTimersAsync();

      expect(llm.complete).toHaveBeenCalledTimes(1);
      expect(storage.patchChatMetadata).toHaveBeenCalledWith("chat-1", {
        habitScan: expect.objectContaining({
          throughMessageId: "a3",
          habits: [{ habit: "Fan noise as a pause", replies: 3, quotes: ["The fan rattles."] }],
        }),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  function routedStorage(routes: Record<string, string>) {
    const messages = chatMessages(replies);
    return {
      get: vi.fn(async (entity: string, id: string) =>
        entity === "app-settings" && id === "model-routing"
          ? { id, value: { version: 1, routes } }
          : { id: "chat-1", metadata: {} },
      ),
      list: vi.fn(async (entity: string) =>
        entity === "connections" ? [{ id: "cheap", name: "Cheap", provider: "openai", model: "cheap-model" }] : [],
      ),
      listChatMessages: vi.fn(async () => [...messages].reverse()),
      patchChatMetadata: vi.fn(async () => ({})),
    };
  }

  it("keeps the reply's connection when the habit check is not routed", async () => {
    const storage = routedStorage({ memory: "cheap" });
    const llm = llmReturning(JSON.stringify({ habits: [] }));

    await runHabitScanIfDue({
      storage: storage as unknown as ScheduleHabitScanInput["storage"],
      llm,
      chatId: "chat-1",
      mode: "roleplay",
      connectionId: "chat-connection",
    });

    expect(llm.complete).toHaveBeenCalledWith(expect.objectContaining({ connectionId: "chat-connection" }), undefined);
  });

  it("scans on the habit check route instead of the reply's connection", async () => {
    const storage = routedStorage({ habitCheck: "cheap" });
    const llm = llmReturning(JSON.stringify({ habits: [] }));

    await runHabitScanIfDue({
      storage: storage as unknown as ScheduleHabitScanInput["storage"],
      llm,
      chatId: "chat-1",
      mode: "roleplay",
      connectionId: "chat-connection",
    });

    expect(llm.complete).toHaveBeenCalledWith(expect.objectContaining({ connectionId: "cheap" }), undefined);
  });

  it("does not scan on another connection when the habit check route is broken", async () => {
    const storage = routedStorage({ habitCheck: "gone" });
    const llm = llmReturning(JSON.stringify({ habits: [] }));

    await expect(
      runHabitScanIfDue({
        storage: storage as unknown as ScheduleHabitScanInput["storage"],
        llm,
        chatId: "chat-1",
        mode: "roleplay",
        connectionId: "chat-connection",
      }),
    ).rejects.toThrow("The Habit check helper is set to a connection that no longer exists.");
    expect(llm.complete).not.toHaveBeenCalled();
    expect(storage.patchChatMetadata).not.toHaveBeenCalled();
  });

  it("turns a stored scan into one steering line per habit", () => {
    const scan = readHabitScan({
      habitScan: {
        version: 2,
        throughMessageId: "a3",
        scannedReplies: 4,
        habits: [{ habit: "Kaul's pen on the clipboard", replies: 4, quotes: ["Kaul taps her pen on the clipboard"] }],
        scannedAt: "2026-10-19T12:00:00.000Z",
      },
    });

    expect(habitScanGuidance(scan)).toEqual([
      "- Kaul's pen on the clipboard (in 4 of the last 4 replies, e.g. \"Kaul taps her pen on the clipboard\"). Leave it out of this reply, and don't swap in a new recurring move.",
    ]);
    expect(readHabitScan({ habitScan: { version: 99, habits: [] } })).toBeNull();
  });
});
