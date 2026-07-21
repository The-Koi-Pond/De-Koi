import { act } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_DEKI_COMPACTION } from "../../../../engine/deki/deki-history";
import { dekiApi } from "../../../../shared/api/deki-api";
import { DekiSurface } from "./DekiSurface";
import { runDekiEntry } from "../../../../engine/deki/deki-entry";

vi.mock("../../../../engine/deki/deki-entry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../engine/deki/deki-entry")>();
  return {
    ...actual,
    runDekiEntry: vi.fn(),
  };
});

vi.mock("../../../../shared/api/deki-api", () => ({
  dekiApi: {
    history: {
      get: vi.fn(),
      appendMessage: vi.fn(),
      replaceMessages: vi.fn(),
      updateMessage: vi.fn(),
      markActionApplied: vi.fn(),
      reset: vi.fn(),
      saveCompaction: vi.fn(),
    },
    preferences: {
      get: vi.fn(),
      save: vi.fn(),
    },
    sessions: {
      list: vi.fn(),
      create: vi.fn(),
      select: vi.fn(),
      delete: vi.fn(),
    },
    prompt: vi.fn(),
    actions: {
      currentRecord: vi.fn(),
      apply: vi.fn(),
    },
  },
}));

vi.mock("../../../catalog/connections/index", () => ({
  useConnections: () => ({
    data: [{ id: "conn-1", name: "Local Model", provider: "openai", model: "test-model", maxContext: 128000 }],
  }),
}));

vi.mock("../../../catalog/personas/index", () => ({
  PersonaAvatarImage: () => null,
  usePersonaSummaries: () => ({ data: [] }),
}));

const userMessage = {
  id: "deki-user-1",
  role: "user" as const,
  content: "How do I add a connection?",
  createdAt: "2026-06-25T12:00:00.000Z",
};

const assistantMessage = {
  id: "deki-assistant-1",
  role: "assistant" as const,
  content: "Open the Connections panel.",
  createdAt: "2026-06-25T12:00:01.000Z",
};

function tick() {
  return act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("DekiSurface message retry actions", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let queryClient: QueryClient | null = null;

  beforeEach(() => {
    window.localStorage.clear();
    HTMLElement.prototype.scrollIntoView = vi.fn();
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    };
    queryClient = new QueryClient();
    container = document.createElement("div");
    document.body.appendChild(container);
    vi.mocked(dekiApi.history.get).mockResolvedValue({
      session: {
        id: "session-1",
        title: "Help",
        messages: [userMessage, assistantMessage],
        compaction: EMPTY_DEKI_COMPACTION,
        createdAt: "2026-06-25T12:00:00.000Z",
        updatedAt: "2026-06-25T12:00:01.000Z",
      },
      messages: [userMessage, assistantMessage],
      compaction: EMPTY_DEKI_COMPACTION,
    });
    vi.mocked(dekiApi.preferences.get).mockResolvedValue({
      selectedConnectionId: "conn-1",
      selectedPersonaId: null,
    });
    vi.mocked(dekiApi.preferences.save).mockResolvedValue({
      selectedConnectionId: "conn-1",
      selectedPersonaId: null,
    });
    vi.mocked(dekiApi.history.replaceMessages).mockImplementation(async ({ messages, compaction }) => ({
      session: {
        id: "session-1",
        title: "Help",
        messages,
        compaction,
        createdAt: "2026-06-25T12:00:00.000Z",
        updatedAt: messages.at(-1)?.createdAt ?? "2026-06-25T12:00:00.000Z",
      },
      messages,
      compaction,
    }));
    vi.mocked(dekiApi.history.appendMessage).mockResolvedValue({
      id: "deki-assistant-2",
      role: "assistant",
      content: "Use Settings, then Connections.",
      createdAt: "2026-06-25T12:00:02.000Z",
    });
    vi.mocked(runDekiEntry).mockResolvedValue({
      content: "Use Settings, then Connections.",
      createdAt: "2026-06-25T12:00:02.000Z",
      action: {
        type: "none",
        capability: "workspace_agent",
        reason: "Test response.",
      },
    });
    vi.mocked(dekiApi.actions.apply).mockReset();
    vi.mocked(dekiApi.actions.currentRecord).mockReset();
    vi.mocked(dekiApi.actions.currentRecord).mockResolvedValue(null);
    vi.mocked(dekiApi.history.markActionApplied).mockResolvedValue({
      status: "applied",
      appliedAt: "2026-06-25T12:00:02.000Z",
      resultId: "result-1",
    });
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    queryClient?.clear();
    queryClient = null;
    container?.remove();
    container = null;
    vi.restoreAllMocks();
  });

  it("regenerates an assistant reply from the preceding user turn", async () => {
    await act(async () => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <DekiSurface sessionId="session-1" />
        </QueryClientProvider>,
      );
    });
    await tick();

    const regenerateButton = container!.querySelector<HTMLButtonElement>('button[title="Regenerate"]');
    expect(regenerateButton).not.toBeNull();

    await act(async () => {
      regenerateButton!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(dekiApi.history.replaceMessages).toHaveBeenCalledWith({
      sessionId: "session-1",
      messages: [userMessage],
      compaction: EMPTY_DEKI_COMPACTION,
    });
    expect(runDekiEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: userMessage.content,
        messages: [],
        compactedSummary: null,
        connectionId: "conn-1",
      }),
      dekiApi,
    );
    expect(dekiApi.history.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        role: "assistant",
        content: "Use Settings, then Connections.",
      }),
    );
    expect(container!.textContent).toContain("Use Settings, then Connections.");
    expect(container!.textContent).not.toContain("Open the Connections panel.");
  });

  it("resends a user message by rerunning from that turn", async () => {
    await act(async () => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <DekiSurface sessionId="session-1" />
        </QueryClientProvider>,
      );
    });
    await tick();

    const resendButton = container!.querySelector<HTMLButtonElement>('button[title="Resend"]');
    expect(resendButton).not.toBeNull();

    await act(async () => {
      resendButton!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(dekiApi.history.replaceMessages).toHaveBeenCalledWith({
      sessionId: "session-1",
      messages: [userMessage],
      compaction: EMPTY_DEKI_COMPACTION,
    });
    expect(runDekiEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: userMessage.content,
        messages: [],
        compactedSummary: null,
        connectionId: "conn-1",
      }),
      dekiApi,
    );
  });

  it("shows proposed edit actions as a current-record diff", async () => {
    const actionMessage = {
      ...assistantMessage,
      action: {
        type: "edit_record" as const,
        entity: "personas" as const,
        id: "persona-1",
        patch: {
          description: "New notes",
        },
        label: "Update persona notes",
      },
    };
    vi.mocked(dekiApi.history.get).mockResolvedValue({
      session: {
        id: "session-1",
        title: "Help",
        messages: [userMessage, actionMessage],
        compaction: EMPTY_DEKI_COMPACTION,
        createdAt: "2026-06-25T12:00:00.000Z",
        updatedAt: "2026-06-25T12:00:01.000Z",
      },
      messages: [userMessage, actionMessage],
      compaction: EMPTY_DEKI_COMPACTION,
    });
    vi.mocked(dekiApi.actions.currentRecord).mockResolvedValue({
      entity: "personas",
      storageEntity: "personas",
      id: "persona-1",
      record: {
        id: "persona-1",
        description: "Old notes",
      },
    });

    await act(async () => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <DekiSurface sessionId="session-1" />
        </QueryClientProvider>,
      );
    });
    await tick();
    await tick();

    expect(dekiApi.actions.currentRecord).toHaveBeenCalledWith(actionMessage.action);
    expect(container!.textContent).toContain("Diff preview");
    expect(container!.textContent).toContain("Description");
    expect(container!.textContent).toContain("Old");
    expect(container!.textContent).toContain("New notes");
    expect(container!.textContent).toContain("1 changed");
  });

  it("hides the diff preview after an action has been applied", async () => {
    const actionMessage = {
      ...assistantMessage,
      action: {
        type: "edit_record" as const,
        entity: "personas" as const,
        id: "persona-1",
        patch: {
          description: "New notes",
        },
        label: "Update persona notes",
      },
      actionApplication: {
        status: "applied" as const,
        appliedAt: "2026-06-25T12:00:02.000Z",
        resultId: "persona-1",
      },
    };
    vi.mocked(dekiApi.history.get).mockResolvedValue({
      session: {
        id: "session-1",
        title: "Help",
        messages: [userMessage, actionMessage],
        compaction: EMPTY_DEKI_COMPACTION,
        createdAt: "2026-06-25T12:00:00.000Z",
        updatedAt: "2026-06-25T12:00:01.000Z",
      },
      messages: [userMessage, actionMessage],
      compaction: EMPTY_DEKI_COMPACTION,
    });

    await act(async () => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <DekiSurface sessionId="session-1" />
        </QueryClientProvider>,
      );
    });
    await tick();
    await tick();

    expect(dekiApi.actions.currentRecord).not.toHaveBeenCalled();
    expect(container!.textContent).toContain("Applied");
    expect(container!.textContent).toContain("Update persona notes");
    expect(container!.textContent).not.toContain("Diff preview");
    expect(container!.textContent).not.toContain("0 changed");
    expect(container!.textContent).not.toContain("Record");
    expect(container!.textContent).not.toContain("Description");
    expect(container!.textContent).not.toContain("New notes");
  });

  it("refetches the current record when the rendered action identity changes", async () => {
    const firstActionMessage = {
      ...assistantMessage,
      id: "deki-assistant-action",
      action: {
        type: "edit_record" as const,
        entity: "personas" as const,
        id: "persona-1",
        patch: {
          description: "First proposal",
        },
        label: "Update persona notes",
      },
    };
    const secondActionMessage = {
      ...assistantMessage,
      id: "deki-assistant-action",
      action: {
        type: "edit_record" as const,
        entity: "personas" as const,
        id: "persona-1",
        patch: {
          description: "Second proposal",
        },
        label: "Update persona notes",
      },
    };
    vi.mocked(dekiApi.history.get)
      .mockResolvedValueOnce({
        session: {
          id: "session-1",
          title: "Help",
          messages: [userMessage, firstActionMessage],
          compaction: EMPTY_DEKI_COMPACTION,
          createdAt: "2026-06-25T12:00:00.000Z",
          updatedAt: "2026-06-25T12:00:01.000Z",
        },
        messages: [userMessage, firstActionMessage],
        compaction: EMPTY_DEKI_COMPACTION,
      })
      .mockResolvedValueOnce({
        session: {
          id: "session-2",
          title: "Help",
          messages: [userMessage, secondActionMessage],
          compaction: EMPTY_DEKI_COMPACTION,
          createdAt: "2026-06-25T12:00:00.000Z",
          updatedAt: "2026-06-25T12:00:01.000Z",
        },
        messages: [userMessage, secondActionMessage],
        compaction: EMPTY_DEKI_COMPACTION,
      });
    vi.mocked(dekiApi.actions.currentRecord).mockResolvedValue({
      entity: "personas",
      storageEntity: "personas",
      id: "persona-1",
      record: {
        id: "persona-1",
        description: "Old notes",
      },
    });

    await act(async () => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <DekiSurface sessionId="session-1" />
        </QueryClientProvider>,
      );
    });
    await tick();
    await tick();

    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient!}>
          <DekiSurface sessionId="session-2" />
        </QueryClientProvider>,
      );
    });
    await tick();
    await tick();

    expect(dekiApi.actions.currentRecord).toHaveBeenCalledTimes(2);
    expect(dekiApi.actions.currentRecord).toHaveBeenNthCalledWith(1, firstActionMessage.action);
    expect(dekiApi.actions.currentRecord).toHaveBeenNthCalledWith(2, secondActionMessage.action);
    expect(container!.textContent).toContain("Second proposal");
  });

  it("grants chat access and resumes the original user request", async () => {
    const actionMessage = {
      ...assistantMessage,
      id: "deki-assistant-chat-access",
      content: "I need permission to read Makima chats.",
      action: {
        type: "request_chat_access" as const,
        scope: {
          type: "character" as const,
          characterId: "char-makima",
          characterName: "Makima",
        },
        window: {
          messageCount: 50,
        },
        label: "Read Makima chats",
        rationale: "Infer preferences from prior interactions.",
      },
    };
    vi.mocked(dekiApi.history.get).mockResolvedValue({
      session: {
        id: "session-1",
        title: "Help",
        messages: [userMessage, actionMessage],
        compaction: EMPTY_DEKI_COMPACTION,
        createdAt: "2026-06-25T12:00:00.000Z",
        updatedAt: "2026-06-25T12:00:01.000Z",
      },
      messages: [userMessage, actionMessage],
      compaction: EMPTY_DEKI_COMPACTION,
    });
    vi.mocked(runDekiEntry).mockResolvedValue({
      content: "I read the approved chats and drafted the update.",
      createdAt: "2026-06-25T12:00:03.000Z",
      action: {
        type: "none",
        capability: "workspace_agent",
        reason: "Test response.",
      },
    });
    vi.mocked(dekiApi.history.appendMessage).mockResolvedValue({
      id: "deki-assistant-2",
      role: "assistant",
      content: "I read the approved chats and drafted the update.",
      createdAt: "2026-06-25T12:00:03.000Z",
    });

    await act(async () => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <DekiSurface sessionId="session-1" />
        </QueryClientProvider>,
      );
    });
    await tick();

    const grantButton = Array.from(container!.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes("Grant access"),
    );
    const declineButton = container!.querySelector<HTMLButtonElement>('button[aria-label="Decline chat access"]');
    expect(grantButton).not.toBeNull();
    expect(declineButton).not.toBeNull();
    const scopeSelect = container!.querySelector<HTMLSelectElement>('select[aria-label="Chat access scope"]');
    const windowSelect = container!.querySelector<HTMLSelectElement>('select[aria-label="Chat access window"]');
    expect(scopeSelect).not.toBeNull();
    expect(windowSelect).not.toBeNull();
    const scopeOptionLabels = Array.from(scopeSelect!.options).map((option) => option.textContent);
    const windowOptionLabels = Array.from(windowSelect!.options).map((option) => option.textContent);
    expect(scopeOptionLabels).toEqual(["Deki's suggestion: Chats involving Makima", "Latest chat with Makima"]);
    expect(windowOptionLabels).toEqual([
      "10 recent messages per chat",
      "25 recent messages per chat",
      "Deki's suggestion: Up to 50 recent messages per chat",
      "100 recent messages per chat",
      "200 recent messages per chat",
    ]);
    expect(scopeSelect!.value).toBe("suggested");
    expect(windowSelect!.value).toBe("suggested");

    await act(async () => {
      scopeSelect!.value = "latest-character";
      scopeSelect!.dispatchEvent(new Event("change", { bubbles: true }));
      windowSelect!.value = "max";
      windowSelect!.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });

    await act(async () => {
      grantButton!.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(dekiApi.history.markActionApplied).toHaveBeenCalledWith(
      actionMessage.id,
      expect.objectContaining({
        status: "applied",
        resultId: `chat-grant-${actionMessage.id}`,
      }),
      "session-1",
    );
    expect(dekiApi.history.replaceMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        messages: [
          userMessage,
          expect.objectContaining({
            id: actionMessage.id,
            action: expect.objectContaining({
              type: "request_chat_access",
              scope: expect.objectContaining({
                type: "latest_character",
                characterId: "char-makima",
                characterName: "Makima",
              }),
              window: {
                messageCount: 200,
              },
            }),
          }),
        ],
      }),
    );
    const request = vi.mocked(runDekiEntry).mock.calls.at(-1)?.[0];
    expect(request).toEqual(
      expect.objectContaining({
        userMessage: expect.stringContaining("Resume the original task now using the approved chat context."),
        connectionId: "conn-1",
        chatAccessGrants: [
          expect.objectContaining({
            id: `chat-grant-${actionMessage.id}`,
            actionMessageId: actionMessage.id,
            scope: expect.objectContaining({
              type: "latest_character",
              characterId: "char-makima",
              characterName: "Makima",
            }),
            window: {
              messageCount: 200,
            },
          }),
        ],
      }),
    );
    expect(request?.userMessage).toContain(userMessage.content);
    expect(dekiApi.history.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        role: "assistant",
        content: "I read the approved chats and drafted the update.",
      }),
    );
  });

  it("asks before web research and reruns the turn with a scoped grant when approved", async () => {
    const webResearchMessage = {
      id: "deki-assistant-web-1",
      role: "assistant" as const,
      content: "I should check current sources before changing that card.",
      createdAt: "2026-06-28T12:00:01.000Z",
      action: {
        type: "request_web_research" as const,
        scope: {
          type: "query" as const,
          query: "Ghostface Dead by Daylight lore personality",
          allowedDomains: ["deadbydaylight.fandom.com"],
        },
        reason: "Verify whether the current card matches Dead by Daylight sources.",
        sources: ["Dead by Daylight Wiki"],
        label: "Check Ghostface sources",
      },
    };
    vi.mocked(dekiApi.history.get).mockResolvedValueOnce({
      session: {
        id: "session-1",
        title: "Help",
        messages: [userMessage, webResearchMessage],
        compaction: EMPTY_DEKI_COMPACTION,
        createdAt: "2026-06-25T12:00:00.000Z",
        updatedAt: "2026-06-28T12:00:01.000Z",
      },
      messages: [userMessage, webResearchMessage],
      compaction: EMPTY_DEKI_COMPACTION,
    });

    await act(async () => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <DekiSurface sessionId="session-1" />
        </QueryClientProvider>,
      );
    });
    await tick();

    expect(container!.textContent).toContain("Search the web");
    expect(container!.textContent).toContain("read public source pages");
    const searchButton = Array.from(container!.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes("Search web"),
    );
    expect(searchButton).not.toBeNull();

    await act(async () => {
      searchButton!.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container!.textContent).toContain("Approved");
    expect(container!.textContent).not.toContain("Handled");
    expect(dekiApi.history.markActionApplied).toHaveBeenCalledWith(
      webResearchMessage.id,
      expect.objectContaining({
        status: "applied",
        resultId: expect.stringContaining("deki-web-research-grant"),
      }),
      "session-1",
    );
    expect(dekiApi.history.replaceMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        messages: expect.arrayContaining([
          expect.objectContaining({
            id: webResearchMessage.id,
            actionApplication: expect.objectContaining({ status: "applied" }),
          }),
        ]),
      }),
    );
    expect(runDekiEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: userMessage.content,
        webResearchGrants: [
          expect.objectContaining({
            actionMessageId: webResearchMessage.id,
            scope: webResearchMessage.action.scope,
          }),
        ],
      }),
      dekiApi,
    );
  });
  it("restores approved chat grants from history before retrying", async () => {
    const grantedAt = "2026-06-25T12:00:02.000Z";
    const actionMessage = {
      ...assistantMessage,
      id: "deki-assistant-chat-access",
      action: {
        type: "request_chat_access" as const,
        scope: {
          type: "character" as const,
          characterId: "char-makima",
          characterName: "Makima",
        },
        window: {
          messageCount: null,
        },
        label: "Read Makima chats",
      },
      actionApplication: {
        status: "applied" as const,
        appliedAt: grantedAt,
        resultId: "grant-from-history",
      },
    };
    const followUpMessage = {
      ...assistantMessage,
      id: "deki-assistant-follow-up",
      content: "Stale answer.",
      createdAt: "2026-06-25T12:00:03.000Z",
    };
    vi.mocked(dekiApi.history.get).mockResolvedValue({
      session: {
        id: "session-1",
        title: "Help",
        messages: [userMessage, actionMessage, followUpMessage],
        compaction: EMPTY_DEKI_COMPACTION,
        createdAt: "2026-06-25T12:00:00.000Z",
        updatedAt: "2026-06-25T12:00:03.000Z",
      },
      messages: [userMessage, actionMessage, followUpMessage],
      compaction: EMPTY_DEKI_COMPACTION,
    });

    await act(async () => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <DekiSurface sessionId="session-1" />
        </QueryClientProvider>,
      );
    });
    await tick();

    expect(container!.textContent).toContain("Up to 200 recent messages per chat");

    const regenerateButton = container!.querySelector<HTMLButtonElement>('button[title="Regenerate"]');
    expect(regenerateButton).not.toBeNull();

    await act(async () => {
      regenerateButton!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(runDekiEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        chatAccessGrants: [
          expect.objectContaining({
            id: "grant-from-history",
            actionMessageId: actionMessage.id,
            grantedAt,
            scope: actionMessage.action.scope,
            window: {
              messageCount: 200,
            },
          }),
        ],
      }),
      dekiApi,
    );
  });
});

describe("DekiSurface concurrent sessions", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let queryClient: QueryClient | null = null;

  beforeEach(() => {
    window.localStorage.clear();
    HTMLElement.prototype.scrollIntoView = vi.fn();
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    };
    queryClient = new QueryClient();
    container = document.createElement("div");
    document.body.appendChild(container);
    vi.mocked(dekiApi.history.get).mockImplementation(async (targetSessionId) => {
      const id = targetSessionId ?? "session-1";
      return {
        session: {
          id,
          title: id === "session-2" ? "Second" : "First",
          messages: [],
          compaction: EMPTY_DEKI_COMPACTION,
          createdAt: "2026-06-28T12:00:00.000Z",
          updatedAt: "2026-06-28T12:00:00.000Z",
        },
        messages: [],
        compaction: EMPTY_DEKI_COMPACTION,
      };
    });
    vi.mocked(dekiApi.preferences.get).mockResolvedValue({
      selectedConnectionId: "conn-1",
      selectedPersonaId: null,
    });
    vi.mocked(dekiApi.preferences.save).mockResolvedValue({
      selectedConnectionId: "conn-1",
      selectedPersonaId: null,
    });
    vi.mocked(dekiApi.actions.apply).mockReset();
    vi.mocked(dekiApi.actions.currentRecord).mockReset();
    vi.mocked(dekiApi.actions.currentRecord).mockResolvedValue(null);
    let messageCount = 0;
    vi.mocked(dekiApi.history.appendMessage).mockImplementation(async ({ sessionId, role, content, action }) => {
      messageCount += 1;
      return {
        id: (sessionId ?? "active") + "-" + role + "-" + messageCount,
        role,
        content,
        ...(action && action.type !== "none" ? { action } : {}),
        createdAt: "2026-06-28T12:00:0" + messageCount + ".000Z",
      };
    });
    vi.mocked(dekiApi.history.saveCompaction).mockImplementation(async (_sessionId, compaction) => compaction);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    queryClient?.clear();
    queryClient = null;
    container?.remove();
    container = null;
    vi.restoreAllMocks();
  });

  const renderSurface = (sessionId: string) => {
    root!.render(
      <QueryClientProvider client={queryClient!}>
        <DekiSurface sessionId={sessionId} />
      </QueryClientProvider>,
    );
  };

  const setInputValue = async (value: string) => {
    const input = container!.querySelector<HTMLTextAreaElement>("textarea");
    expect(input).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(input, value);
      input!.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
  };

  const sendButton = () => {
    const button = container!.querySelector<HTMLButtonElement>("button[aria-label= Send]");
    expect(button).not.toBeNull();
    return button!;
  };

  it("allows a new session to send while another session is generating", async () => {
    let resolveFirst:
      | ((value: {
          content: string;
          createdAt: string;
          action: { type: "none"; capability: "workspace_agent"; reason: string };
        }) => void)
      | null = null;
    const firstResponse = new Promise<{
      content: string;
      createdAt: string;
      action: { type: "none"; capability: "workspace_agent"; reason: string };
    }>((resolve) => {
      resolveFirst = resolve;
    });
    vi.mocked(runDekiEntry).mockImplementation(async (request) => {
      if (request.userMessage === "First question") return firstResponse;
      return {
        content: "Reply to " + request.userMessage,
        createdAt: "2026-06-28T12:00:10.000Z",
        action: {
          type: "none",
          capability: "workspace_agent",
          reason: "Test response.",
        },
      };
    });

    await act(async () => {
      root = createRoot(container!);
      renderSurface("session-1");
    });
    await tick();

    await setInputValue("First question");
    expect(sendButton().disabled).toBe(false);
    await act(async () => {
      sendButton().click();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      renderSurface("session-2");
    });
    await tick();
    await setInputValue("Second question");

    expect(sendButton().disabled).toBe(false);

    await act(async () => {
      sendButton().click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(runDekiEntry).toHaveBeenCalledWith(
      expect.objectContaining({ userMessage: "Second question", connectionId: "conn-1" }),
      dekiApi,
    );
    expect(container!.textContent).toContain("Reply to Second question");

    await act(async () => {
      resolveFirst?.({
        content: "Reply to First question",
        createdAt: "2026-06-28T12:00:20.000Z",
        action: {
          type: "none",
          capability: "workspace_agent",
          reason: "Test response.",
        },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container!.textContent).toContain("Reply to Second question");
    expect(container!.textContent).not.toContain("Reply to First question");
  });
  it("notifies when an assistant reply is persisted", async () => {
    const onAssistantMessagePersisted = vi.fn();
    vi.mocked(runDekiEntry).mockResolvedValue({
      content: "Reply with a sidebar ping",
      createdAt: "2026-06-28T12:00:10.000Z",
      action: {
        type: "none",
        capability: "workspace_agent",
        reason: "Test response.",
      },
    });

    await act(async () => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <DekiSurface sessionId="session-1" onAssistantMessagePersisted={onAssistantMessagePersisted} />
        </QueryClientProvider>,
      );
    });
    await tick();

    await setInputValue("Ping the sidebar");
    await act(async () => {
      sendButton().click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onAssistantMessagePersisted).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "assistant",
        content: "Reply with a sidebar ping",
      }),
    );
  });
});

describe("DekiSurface hero state", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let queryClient: QueryClient | null = null;

  beforeEach(() => {
    window.localStorage.clear();
    HTMLElement.prototype.scrollIntoView = vi.fn();
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    };
    queryClient = new QueryClient();
    container = document.createElement("div");
    document.body.appendChild(container);
    vi.mocked(dekiApi.preferences.get).mockResolvedValue({
      selectedConnectionId: "conn-1",
      selectedPersonaId: null,
    });
    vi.mocked(dekiApi.preferences.save).mockResolvedValue({
      selectedConnectionId: "conn-1",
      selectedPersonaId: null,
    });
    vi.mocked(dekiApi.actions.currentRecord).mockResolvedValue(null);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    queryClient?.clear();
    queryClient = null;
    container?.remove();
    container = null;
    vi.restoreAllMocks();
  });

  const renderSurface = async (sessionId = "session-1") => {
    await act(async () => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <DekiSurface sessionId={sessionId} />
        </QueryClientProvider>,
      );
    });
  };

  const heroState = () => container!.querySelector<HTMLElement>(".deki-hero")?.dataset.state;

  it("keeps the hero unsettled until history resolves, then uses the full welcome for an empty history", async () => {
    let resolveHistory: ((value: Awaited<ReturnType<typeof dekiApi.history.get>>) => void) | null = null;
    vi.mocked(dekiApi.history.get).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveHistory = resolve;
        }),
    );

    await renderSurface();
    expect(heroState()).toBe("loading");

    await act(async () => {
      resolveHistory?.({
        session: {
          id: "session-1",
          title: "Help",
          messages: [],
          compaction: EMPTY_DEKI_COMPACTION,
          createdAt: "2026-06-25T12:00:00.000Z",
          updatedAt: "2026-06-25T12:00:00.000Z",
        },
        messages: [],
        compaction: EMPTY_DEKI_COMPACTION,
      });
      await Promise.resolve();
    });

    expect(heroState()).toBe("welcome");
  });

  it("uses the compact hero when loaded history contains persisted messages", async () => {
    vi.mocked(dekiApi.history.get).mockResolvedValue({
      session: {
        id: "session-1",
        title: "Help",
        messages: [userMessage],
        compaction: EMPTY_DEKI_COMPACTION,
        createdAt: "2026-06-25T12:00:00.000Z",
        updatedAt: "2026-06-25T12:00:00.000Z",
      },
      messages: [userMessage],
      compaction: EMPTY_DEKI_COMPACTION,
    });

    await renderSurface();
    await tick();

    expect(heroState()).toBe("compact");
  });

  it("settles rejected current-session history into a recoverable welcome state", async () => {
    vi.mocked(dekiApi.history.get).mockRejectedValue(new Error("Deki history unavailable"));

    await renderSurface();
    await tick();
    await tick();

    expect(heroState()).toBe("welcome");
    expect(container!.querySelector("section")?.getAttribute("aria-busy")).toBe("false");
    expect(container!.textContent).toContain("Howdy, welcome to De-Koi!");

    const input = container!.querySelector<HTMLTextAreaElement>("textarea");
    expect(input).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(input, "Can you still help me?");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });

    expect(container!.querySelector<HTMLButtonElement>('button[aria-label="Send"]')?.disabled).toBe(false);
  });

  it("does not show prior-session history after the replacement session rejects", async () => {
    vi.mocked(dekiApi.history.get).mockImplementation((sessionId) => {
      if (sessionId === "session-1") {
        return Promise.resolve({
          session: {
            id: "session-1",
            title: "Help",
            messages: [userMessage],
            compaction: EMPTY_DEKI_COMPACTION,
            createdAt: "2026-06-25T12:00:00.000Z",
            updatedAt: "2026-06-25T12:00:00.000Z",
          },
          messages: [userMessage],
          compaction: EMPTY_DEKI_COMPACTION,
        });
      }
      return Promise.reject(new Error("Deki history unavailable"));
    });

    await renderSurface();
    await tick();
    expect(heroState()).toBe("compact");
    expect(container!.textContent).toContain(userMessage.content);

    flushSync(() => {
      root!.render(
        <QueryClientProvider client={queryClient!}>
          <DekiSurface sessionId="session-2" />
        </QueryClientProvider>,
      );
    });
    expect(heroState()).toBe("loading");

    await tick();
    await tick();

    expect(heroState()).toBe("welcome");
    expect(container!.querySelector("section")?.getAttribute("aria-busy")).toBe("false");
    expect(container!.textContent).not.toContain(userMessage.content);
  });

  it("keeps a returning session loading until its replacement history request settles", async () => {
    const returnedMessage = {
      ...userMessage,
      id: "deki-user-returned",
      content: "The final A history response.",
      createdAt: "2026-06-25T12:00:02.000Z",
    };
    let firstSessionALoad = true;
    let resolveReturningHistory: ((value: Awaited<ReturnType<typeof dekiApi.history.get>>) => void) | null = null;
    vi.mocked(dekiApi.history.get).mockImplementation((sessionId) => {
      if (sessionId !== "session-1") return new Promise(() => undefined);
      if (firstSessionALoad) {
        firstSessionALoad = false;
        return Promise.resolve({
          session: {
            id: "session-1",
            title: "Help",
            messages: [userMessage],
            compaction: EMPTY_DEKI_COMPACTION,
            createdAt: "2026-06-25T12:00:00.000Z",
            updatedAt: "2026-06-25T12:00:00.000Z",
          },
          messages: [userMessage],
          compaction: EMPTY_DEKI_COMPACTION,
        });
      }
      return new Promise((resolve) => {
        resolveReturningHistory = resolve;
      });
    });

    await renderSurface();
    await tick();
    expect(heroState()).toBe("compact");

    const input = container!.querySelector<HTMLTextAreaElement>("textarea");
    expect(input).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(input, "Keep this draft while switching sessions");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    const sendButton = () => container!.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!;
    expect(sendButton().disabled).toBe(false);

    flushSync(() => {
      root!.render(
        <QueryClientProvider client={queryClient!}>
          <DekiSurface sessionId="session-2" />
        </QueryClientProvider>,
      );
    });
    expect(heroState()).toBe("loading");

    flushSync(() => {
      root!.render(
        <QueryClientProvider client={queryClient!}>
          <DekiSurface sessionId="session-1" />
        </QueryClientProvider>,
      );
    });

    expect(heroState()).toBe("loading");
    expect(container!.querySelector("section")?.getAttribute("aria-busy")).toBe("true");
    expect(sendButton().disabled).toBe(true);
    expect(container!.textContent).not.toContain(userMessage.content);

    await act(async () => {
      resolveReturningHistory?.({
        session: {
          id: "session-1",
          title: "Help again",
          messages: [returnedMessage],
          compaction: EMPTY_DEKI_COMPACTION,
          createdAt: "2026-06-25T12:00:00.000Z",
          updatedAt: "2026-06-25T12:00:02.000Z",
        },
        messages: [returnedMessage],
        compaction: EMPTY_DEKI_COMPACTION,
      });
      await Promise.resolve();
    });

    expect(heroState()).toBe("compact");
    expect(container!.textContent).toContain(returnedMessage.content);
    expect(container!.textContent).not.toContain(userMessage.content);
  });

  it("shows loading synchronously when switching from populated history to a pending session", async () => {
    vi.mocked(dekiApi.history.get).mockImplementation((sessionId) => {
      if (sessionId === "session-1") {
        return Promise.resolve({
          session: {
            id: "session-1",
            title: "Help",
            messages: [userMessage],
            compaction: EMPTY_DEKI_COMPACTION,
            createdAt: "2026-06-25T12:00:00.000Z",
            updatedAt: "2026-06-25T12:00:00.000Z",
          },
          messages: [userMessage],
          compaction: EMPTY_DEKI_COMPACTION,
        });
      }
      return new Promise(() => undefined);
    });

    await renderSurface();
    await tick();
    expect(heroState()).toBe("compact");

    flushSync(() => {
      root!.render(
        <QueryClientProvider client={queryClient!}>
          <DekiSurface sessionId="session-2" />
        </QueryClientProvider>,
      );
    });

    expect(heroState()).toBe("loading");
  });
});
