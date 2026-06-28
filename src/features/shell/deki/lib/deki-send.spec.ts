import { describe, expect, it, vi } from "vitest";

import type { DekiEntryAction, DekiMessage, DekiWebResearchGrant } from "../../../../engine/deki/deki-entry";
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

  it("forwards approved chat access grants to the Deki prompt gateway", async () => {
    const prompt = vi.fn(async () => ({
      content: "I can read the approved chat now.",
      createdAt: "2026-06-25T12:00:02.000Z",
      action: {
        type: "none",
        capability: "workspace_agent",
        reason: "Test response.",
      } satisfies DekiEntryAction,
    }));
    const grant = {
      id: "grant-1",
      actionMessageId: "assistant-1",
      scope: {
        type: "character",
        characterId: "char-rina",
        characterName: "Rina",
      },
      window: { messageCount: 25 },
      grantedAt: "2026-06-25T12:00:00.000Z",
      expiresAt: null,
    } as const;

    await runDetachedDekiSend({
      sessionId: "session-1",
      userMessage: "Continue with the approved chat history.",
      messages: [],
      compaction: EMPTY_DEKI_COMPACTION,
      connection: { id: "connection-1", model: "model-1", maxContext: 128_000 },
      persona: null,
      attachments: [],
      chatAccessGrants: [grant],
      history: {
        appendMessage: vi.fn(async (message: { role: "user" | "assistant"; content: string; action?: DekiEntryAction | null }) => ({
          id: `${message.role}-1`,
          role: message.role,
          content: message.content,
          createdAt: "2026-06-25T12:00:00.000Z",
          action: "action" in message ? message.action : null,
        })),
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

    expect(prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        chatAccessGrants: [grant],
      }),
    );
  });
  it("passes approved web research grants into the Deki entry request", async () => {
    const grant: DekiWebResearchGrant = {
      id: "grant-1",
      actionMessageId: "assistant-1",
      grantedAt: "2026-06-28T12:00:00.000Z",
      scope: {
        type: "query",
        query: "Ghostface Dead by Daylight lore personality",
        allowedDomains: ["deadbydaylight.fandom.com"],
      },
    };
    const prompt = vi.fn(async () => ({
      content: "I checked the sources.",
      createdAt: "2026-06-28T12:00:01.000Z",
      action: {
        type: "none",
        capability: "workspace_agent",
        reason: "Test response.",
      } satisfies DekiEntryAction,
    }));

    await runDetachedDekiSend({
      sessionId: "session-1",
      userMessage: "Can you check Ghostface?",
      existingUser: {
        id: "user-1",
        role: "user",
        content: "Can you check Ghostface?",
        createdAt: "2026-06-28T11:59:59.000Z",
      },
      messages: [
        {
          id: "user-1",
          role: "user",
          content: "Can you check Ghostface?",
          createdAt: "2026-06-28T11:59:59.000Z",
        },
      ],
      compaction: EMPTY_DEKI_COMPACTION,
      connection: { id: "connection-1", model: "model-1", maxContext: 128_000 },
      persona: null,
      attachments: [],
      webResearchGrants: [grant],
      history: {
        appendMessage: vi.fn(async (message: { role: "user" | "assistant"; content: string; action?: DekiEntryAction | null }) => ({
          id: `${message.role}-2`,
          role: message.role,
          content: message.content,
          createdAt: "2026-06-28T12:00:02.000Z",
          action: "action" in message ? message.action : null,
        })),
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

    expect(prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        webResearchGrants: [grant],
      }),
    );
  });
});
