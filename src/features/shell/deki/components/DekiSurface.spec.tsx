import { act } from "react";
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
});
