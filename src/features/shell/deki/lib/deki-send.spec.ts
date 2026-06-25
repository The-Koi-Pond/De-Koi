import { describe, expect, it, vi } from "vitest";

import type { DekiEntryAction, DekiMessage } from "../../../../engine/deki/deki-entry";
import { EMPTY_DEKI_COMPACTION } from "../../../../engine/deki/deki-history";
import { runDetachedDekiSend } from "./deki-send";

describe("detached Deki send", () => {
  it("persists the user and assistant messages even without UI observers", async () => {
    const savedMessages: DekiMessage[] = [];
    const assistantAction = {
      type: "none",
      capability: "workspace_agent",
      reason: "Test response.",
    } satisfies DekiEntryAction;
    const appendMessage = vi.fn(
      async (message: { role: "user" | "assistant"; content: string; action?: DekiEntryAction | null }) => {
        const saved = {
          id: `${message.role}-${savedMessages.length + 1}`,
          role: message.role,
          content: message.content,
          createdAt: `2026-06-25T12:00:0${savedMessages.length}.000Z`,
          action: "action" in message ? message.action : null,
        } satisfies DekiMessage;
        savedMessages.push(saved);
        return saved;
      },
    );
    const prompt = vi.fn(async () => ({
      content: "Still here.",
      createdAt: "2026-06-25T12:00:02.000Z",
      action: assistantAction,
    }));

    const result = await runDetachedDekiSend({
      sessionId: "session-1",
      userMessage: "Are you still there?",
      messages: [],
      compaction: EMPTY_DEKI_COMPACTION,
      connection: { id: "connection-1", model: "model-1", maxContext: 128_000 },
      persona: null,
      attachments: [],
      history: {
        appendMessage,
        saveCompaction: vi.fn(),
      },
      llm: {
        complete: vi.fn(),
        stream: vi.fn(),
        listModels: vi.fn(),
      },
      gateway: {
        prompt,
      },
    });

    expect(result.user.content).toBe("Are you still there?");
    expect(result.assistant.content).toBe("Still here.");
    expect(result.assistant.action).toEqual(assistantAction);
    expect(appendMessage).toHaveBeenCalledTimes(2);
    expect(savedMessages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: "Are you still there?",
        connectionId: "connection-1",
      }),
    );
  });
});