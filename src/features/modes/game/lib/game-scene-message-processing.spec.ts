import { beforeEach, describe, expect, it, vi } from "vitest";
import { processLatestSceneAssistantMessage, scheduleSceneAssistantProcessing } from "./game-scene-message-processing";

type TestMessage = {
  id: string;
  content?: string | null;
};

describe("game scene assistant message processing", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("processes a new assistant message once and marks it processed first", () => {
    const markProcessed = vi.fn();
    const processMessage = vi.fn();
    const message: TestMessage = { id: "msg-1", content: "The gate opens." };

    const outcome = processLatestSceneAssistantMessage({
      isRestored: false,
      lastProcessedMessageId: null,
      latestMessage: message,
      markProcessed,
      processMessage,
    });

    expect(outcome).toMatchObject({ messageId: "msg-1", status: "processed" });
    expect(outcome.messageToProcess).toBe(message);
    expect(markProcessed).toHaveBeenCalledWith("msg-1");
    expect(processMessage).toHaveBeenCalledWith(message);
    expect(markProcessed.mock.invocationCallOrder[0]).toBeLessThan(processMessage.mock.invocationCallOrder[0]);
  });

  it("marks restored chat messages as processed without replaying scene side effects", () => {
    const markProcessed = vi.fn();
    const processMessage = vi.fn();
    const message: TestMessage = { id: "restored-msg", content: "Previously loaded narration." };

    const outcome = processLatestSceneAssistantMessage({
      isRestored: true,
      lastProcessedMessageId: null,
      latestMessage: message,
      markProcessed,
      processMessage,
    });

    expect(outcome).toMatchObject({ messageId: "restored-msg", messageToProcess: null, status: "restored-skip" });
    expect(markProcessed).toHaveBeenCalledWith("restored-msg");
    expect(processMessage).not.toHaveBeenCalled();
  });

  it("waits for delayed assistant message content after generation completes", async () => {
    vi.useFakeTimers();
    let latestMessage: TestMessage | null = null;
    let lastProcessedMessageId: string | null = null;
    const processLatestMessage = vi.fn(() => {
      lastProcessedMessageId = latestMessage?.id ?? null;
    });
    const onTimeout = vi.fn();

    scheduleSceneAssistantProcessing({
      getLastProcessedMessageId: () => lastProcessedMessageId,
      getLatestMessage: () => latestMessage,
      maxAttempts: 10,
      onTimeout,
      processLatestMessage,
      requestFrame: (callback) => setTimeout(callback, 0),
      retryDelayMs: 200,
      setDelay: (callback, delayMs) => setTimeout(callback, delayMs),
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(200);
    latestMessage = { id: "late-msg", content: "A delayed turn arrives." };
    await vi.advanceTimersByTimeAsync(200);

    expect(processLatestMessage).toHaveBeenCalledTimes(1);
    expect(lastProcessedMessageId).toBe("late-msg");
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("does not retry or process duplicate assistant messages", async () => {
    vi.useFakeTimers();
    const latestMessage: TestMessage = { id: "processed-msg", content: "Already handled." };
    const processLatestMessage = vi.fn();
    const onTimeout = vi.fn();

    scheduleSceneAssistantProcessing({
      getLastProcessedMessageId: () => "processed-msg",
      getLatestMessage: () => latestMessage,
      onTimeout,
      processLatestMessage,
      requestFrame: (callback) => setTimeout(callback, 0),
      retryDelayMs: 200,
      setDelay: (callback, delayMs) => setTimeout(callback, delayMs),
    });

    await vi.advanceTimersByTimeAsync(2_500);

    expect(processLatestMessage).not.toHaveBeenCalled();
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("can wait past the previous processed message for generation-complete delivery", async () => {
    vi.useFakeTimers();
    let latestMessage: TestMessage = { id: "old-msg", content: "Already handled." };
    let lastProcessedMessageId: string | null = "old-msg";
    const processLatestMessage = vi.fn(() => {
      lastProcessedMessageId = latestMessage.id;
    });
    const onTimeout = vi.fn();

    scheduleSceneAssistantProcessing({
      getLastProcessedMessageId: () => lastProcessedMessageId,
      getLatestMessage: () => latestMessage,
      maxAttempts: 10,
      onTimeout,
      processLatestMessage,
      requestFrame: (callback) => setTimeout(callback, 0),
      retryAlreadyProcessed: true,
      retryDelayMs: 200,
      setDelay: (callback, delayMs) => setTimeout(callback, delayMs),
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(200);
    latestMessage = { id: "new-msg", content: "The next turn arrives." };
    await vi.advanceTimersByTimeAsync(200);

    expect(processLatestMessage).toHaveBeenCalledTimes(1);
    expect(lastProcessedMessageId).toBe("new-msg");
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("reports timeout when assistant message content never arrives", async () => {
    vi.useFakeTimers();
    let latestMessage: TestMessage | null = { id: "empty-msg", content: "" };
    const processLatestMessage = vi.fn();
    const onTimeout = vi.fn();

    scheduleSceneAssistantProcessing({
      getLastProcessedMessageId: () => null,
      getLatestMessage: () => latestMessage,
      maxAttempts: 2,
      onTimeout,
      processLatestMessage,
      requestFrame: (callback) => setTimeout(callback, 0),
      retryDelayMs: 200,
      setDelay: (callback, delayMs) => setTimeout(callback, delayMs),
    });

    await vi.advanceTimersByTimeAsync(0);
    latestMessage = { id: "still-empty-msg", content: null };
    await vi.advanceTimersByTimeAsync(400);

    expect(processLatestMessage).not.toHaveBeenCalled();
    expect(onTimeout).toHaveBeenCalledWith({
      attempts: 3,
      latestMessageHadContent: false,
      latestMessageId: "still-empty-msg",
    });
  });
});
