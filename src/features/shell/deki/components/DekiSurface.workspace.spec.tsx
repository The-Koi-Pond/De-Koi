import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_DEKI_COMPACTION } from "../../../../engine/deki/deki-history";
import {
  runDekiEntry,
  type DekiMessage,
  type DekiWorkspaceHistoryEntry,
  type DekiWorkspacePendingApproval,
} from "../../../../engine/deki/deki-entry";
import { ApiError } from "../../../../shared/api/api-errors";
import { dekiApi } from "../../../../shared/api/deki-api";
import { DekiSurface } from "./DekiSurface";

vi.mock("../../../../engine/deki/deki-entry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../engine/deki/deki-entry")>();
  return { ...actual, runDekiEntry: vi.fn() };
});

vi.mock("../../../../shared/api/deki-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../shared/api/deki-api")>();
  return {
    ...actual,
    dekiApi: {
      history: {
        get: vi.fn(),
        appendMessage: vi.fn(),
        replaceMessages: vi.fn(),
        updateMessage: vi.fn(),
        updateWorkspaceHistoryEntry: vi.fn(),
        markActionApplied: vi.fn(),
        reset: vi.fn(),
        saveCompaction: vi.fn(),
      },
      preferences: { get: vi.fn(), save: vi.fn() },
      sessions: { list: vi.fn(), create: vi.fn(), select: vi.fn(), delete: vi.fn() },
      prompt: vi.fn(),
      promptEvents: vi.fn(),
      workspace: { status: vi.fn(), abort: vi.fn(), approve: vi.fn(), reject: vi.fn() },
      actions: { currentRecord: vi.fn(), apply: vi.fn() },
    },
  };
});

vi.mock("../../../catalog/connections/index", () => ({
  useConnections: () => ({
    data: [{ id: "conn-1", name: "Local Model", provider: "openai", model: "test-model", maxContext: 128000 }],
  }),
}));

vi.mock("../../../catalog/personas/index", () => ({
  PersonaAvatarImage: () => null,
  usePersonaSummaries: () => ({ data: [] }),
}));

const approvalId = "deki-approval-1";

const historyEntry: DekiWorkspaceHistoryEntry = {
  id: approvalId,
  sessionId: "session-1",
  command: "deki data patch lorebook-entries/entry-koi",
  reason: "Fix the time of day",
  status: "dry-run",
  operationHash: "sha256:abc",
  affectedEntities: { "lorebook-entries": 1 },
  affectedRows: 1,
  validationStatus: "passed",
  journalPath: null,
  createdAt: "2026-06-25T12:00:01.000Z",
};

const pendingApproval: DekiWorkspacePendingApproval = {
  id: approvalId,
  sessionId: "session-1",
  command: historyEntry.command,
  reason: historyEntry.reason,
  operationHash: "sha256:abc",
  requestedAt: historyEntry.createdAt,
  expiresAt: new Date(Date.now() + 25 * 60_000).toISOString(),
  affectedEntities: { "lorebook-entries": 1 },
  affectedRows: 1,
  validationStatus: "passed",
  diffPreview: [
    {
      entity: "lorebook-entries",
      id: "entry-koi",
      action: "update",
      before: { content: "Koi circle the lantern at dusk." },
      after: { content: "Koi circle the lantern at dawn." },
    },
  ],
  diffTruncated: false,
};

const userMessage: DekiMessage = {
  id: "deki-user-1",
  role: "user",
  content: "Fix the koi entry",
  createdAt: "2026-06-25T12:00:00.000Z",
};

const assistantMessage: DekiMessage = {
  id: "deki-assistant-1",
  role: "assistant",
  content: "I prepared the edit; approve it below.",
  createdAt: "2026-06-25T12:00:01.000Z",
  workspaceTrace: [
    {
      type: "tool",
      tool: {
        id: "deki_r1_c1",
        name: "deki_data",
        status: "done",
        input: { action: "get", collection: "lorebook-entries", id: "entry-koi" },
      },
    },
  ],
  workspaceHistory: [historyEntry],
};

function tick() {
  return act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function buttonByText(container: HTMLElement, text: string) {
  return [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === text) ?? null;
}

describe("DekiSurface workspace activity and data approvals", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let queryClient: QueryClient | null = null;

  const render = async (messages: DekiMessage[]) => {
    vi.mocked(dekiApi.history.get).mockResolvedValue({
      session: {
        id: "session-1",
        title: "Koi",
        messages,
        compaction: EMPTY_DEKI_COMPACTION,
        createdAt: "2026-06-25T12:00:00.000Z",
        updatedAt: "2026-06-25T12:00:01.000Z",
      },
      messages,
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
  };

  beforeEach(() => {
    vi.clearAllMocks();
    HTMLElement.prototype.scrollIntoView = vi.fn();
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    };
    queryClient = new QueryClient();
    container = document.createElement("div");
    document.body.appendChild(container);
    vi.mocked(dekiApi.preferences.get).mockResolvedValue({ selectedConnectionId: "conn-1", selectedPersonaId: null });
    vi.mocked(dekiApi.preferences.save).mockResolvedValue({ selectedConnectionId: "conn-1", selectedPersonaId: null });
    vi.mocked(dekiApi.workspace.status).mockResolvedValue({
      enabled: true,
      workspace: null,
      dataDir: null,
      tools: [],
      dataAccess: "server-managed",
      connection: null,
      active: false,
      pendingApprovals: [pendingApproval],
      history: [historyEntry],
    });
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    root = null;
    queryClient?.clear();
    container?.remove();
    vi.restoreAllMocks();
  });

  it("shows a pending data change with its diff and records an approved outcome", async () => {
    vi.mocked(dekiApi.workspace.approve).mockResolvedValue({
      id: approvalId,
      status: "approved",
      pendingApprovals: [],
      history: [{ ...historyEntry, status: "approved" }],
      applied: { entity: "lorebook-entries", id: "entry-koi", command: historyEntry.command },
    });
    vi.mocked(dekiApi.history.updateWorkspaceHistoryEntry).mockImplementation(async ({ entry }) => [
      userMessage,
      { ...assistantMessage, workspaceHistory: [entry] },
    ]);
    await render([userMessage, assistantMessage]);

    expect(dekiApi.workspace.status).toHaveBeenCalledWith("session-1");
    expect(container!.textContent).toContain("Edit a lorebook entry");
    expect(container!.textContent).toContain("Waiting for your approval");
    expect(container!.textContent).toContain("Change preview");
    expect(container!.querySelector(".deki-data-approval")!.textContent).toContain("Content");
    expect(container!.textContent).toContain("Checked 1 thing");

    vi.mocked(dekiApi.workspace.status).mockResolvedValue({
      enabled: true,
      workspace: null,
      dataDir: null,
      tools: [],
      dataAccess: "server-managed",
      connection: null,
      active: false,
      pendingApprovals: [],
      history: [{ ...historyEntry, status: "approved" }],
    });
    await act(async () => {
      buttonByText(container!, "Approve")!.click();
    });
    await tick();

    expect(dekiApi.workspace.approve).toHaveBeenCalledWith("session-1", approvalId);
    expect(dekiApi.history.updateWorkspaceHistoryEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        messageId: assistantMessage.id,
        entry: expect.objectContaining({ id: approvalId, status: "approved" }),
      }),
    );
    expect(container!.textContent).toContain("Applied");
    expect(buttonByText(container!, "Approve")).toBeNull();
  });

  it("reports a changed record instead of applying a stale preview", async () => {
    vi.mocked(dekiApi.workspace.approve).mockRejectedValue(
      new ApiError("changed", 500, { code: "deki_workspace_state_changed" }),
    );
    vi.mocked(dekiApi.history.updateWorkspaceHistoryEntry).mockImplementation(async ({ entry }) => [
      userMessage,
      { ...assistantMessage, workspaceHistory: [entry] },
    ]);
    await render([userMessage, assistantMessage]);
    vi.mocked(dekiApi.workspace.status).mockResolvedValue({
      enabled: true,
      workspace: null,
      dataDir: null,
      tools: [],
      dataAccess: "server-managed",
      connection: null,
      active: false,
      pendingApprovals: [],
      history: [{ ...historyEntry, status: "state_changed" }],
    });

    await act(async () => {
      buttonByText(container!, "Approve")!.click();
    });
    await tick();

    expect(container!.textContent).toContain("changed after Deki-senpai previewed it");
    expect(container!.textContent).toContain("Not applied: data changed");
    expect(dekiApi.history.updateWorkspaceHistoryEntry).toHaveBeenCalledWith(
      expect.objectContaining({ entry: expect.objectContaining({ status: "state_changed" }) }),
    );
  });

  it("keeps an approval actionable after a failed write that saved nothing", async () => {
    vi.mocked(dekiApi.workspace.approve).mockRejectedValue(
      new ApiError("failed", 500, { code: "deki_workspace_apply_failed" }),
    );
    await render([userMessage, assistantMessage]);
    vi.mocked(dekiApi.workspace.status).mockResolvedValue({
      enabled: true,
      workspace: null,
      dataDir: null,
      tools: [],
      dataAccess: "server-managed",
      connection: null,
      active: false,
      pendingApprovals: [pendingApproval],
      history: [historyEntry],
    });

    await act(async () => {
      buttonByText(container!, "Approve")!.click();
    });
    await tick();

    expect(container!.textContent).toContain("still waiting for your approval");
    expect(buttonByText(container!, "Approve")).not.toBeNull();
    expect(dekiApi.history.updateWorkspaceHistoryEntry).not.toHaveBeenCalled();
  });

  it("shows a pending approval past its expiry as expired, not actionable", async () => {
    vi.mocked(dekiApi.workspace.status).mockResolvedValue({
      enabled: true,
      workspace: null,
      dataDir: null,
      tools: [],
      dataAccess: "server-managed",
      connection: null,
      active: false,
      pendingApprovals: [{ ...pendingApproval, expiresAt: new Date(Date.now() - 1_000).toISOString() }],
      history: [historyEntry],
    });
    await render([userMessage, assistantMessage]);

    expect(container!.textContent).toContain("Expired");
    expect(buttonByText(container!, "Approve")).toBeNull();
  });

  it("marks a change the runtime no longer holds as expired", async () => {
    vi.mocked(dekiApi.workspace.status).mockResolvedValue({
      enabled: true,
      workspace: null,
      dataDir: null,
      tools: [],
      dataAccess: "server-managed",
      connection: null,
      active: false,
      pendingApprovals: [],
      history: [],
    });
    await render([userMessage, assistantMessage]);

    expect(container!.textContent).toContain("Expired");
    expect(buttonByText(container!, "Approve")).toBeNull();
  });

  it("keeps an approval reachable when no saved message carries it", async () => {
    vi.mocked(dekiApi.workspace.reject).mockResolvedValue({
      id: approvalId,
      status: "rejected",
      pendingApprovals: [],
      history: [{ ...historyEntry, status: "rejected" }],
    });
    await render([userMessage]);

    expect(container!.textContent).toContain("Edit a lorebook entry");
    expect(buttonByText(container!, "Approve")).not.toBeNull();

    vi.mocked(dekiApi.workspace.status).mockResolvedValue({
      enabled: true,
      workspace: null,
      dataDir: null,
      tools: [],
      dataAccess: "server-managed",
      connection: null,
      active: false,
      pendingApprovals: [],
      history: [{ ...historyEntry, status: "rejected" }],
    });
    await act(async () => {
      buttonByText(container!, "Reject")!.click();
    });
    await tick();

    expect(dekiApi.workspace.reject).toHaveBeenCalledWith("session-1", approvalId);
    expect(dekiApi.history.updateWorkspaceHistoryEntry).not.toHaveBeenCalled();
    expect(buttonByText(container!, "Approve")).toBeNull();
  });

  it("streams live steps while Deki works and can stop the run", async () => {
    let finish: (() => void) | null = null;
    vi.mocked(runDekiEntry).mockImplementation(async (_input, _gateway, options) => {
      options?.onEvent?.({ type: "status", data: { content: "Looking for the shell owner.", kind: "info" } });
      options?.onEvent?.({
        type: "tool_start",
        data: { id: "deki_r1_c1", name: "grep", input: { query: "AppShell" } },
      });
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return {
        content: "Found it.",
        createdAt: "2026-06-25T12:00:03.000Z",
        action: { type: "none", capability: "workspace_agent", reason: "Test response." },
      };
    });
    vi.mocked(dekiApi.history.appendMessage).mockImplementation(async (message) => ({
      id: `deki-${message.role}-${Date.now()}`,
      role: message.role,
      content: message.content,
      createdAt: "2026-06-25T12:00:03.000Z",
    }));
    vi.mocked(dekiApi.workspace.abort).mockResolvedValue({ status: "aborted", aborted: true, active: true });
    await render([]);

    const input = container!.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(input, "Where is the shell?");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container!.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!.click();
    });
    await tick();
    await tick();

    expect(container!.textContent).toContain("Looking for the shell owner.");
    expect(container!.textContent).toContain('Searched code for "AppShell"');

    await act(async () => {
      container!.querySelector<HTMLButtonElement>('button[aria-label="Stop Deki-senpai"]')!.click();
    });
    expect(dekiApi.workspace.abort).toHaveBeenCalledWith("session-1");
    expect(container!.textContent).toContain("Stopping...");

    await act(async () => {
      finish?.();
    });
    await tick();
    await tick();

    expect(container!.querySelector('button[aria-label="Stop Deki-senpai"]')).toBeNull();
    expect(container!.textContent).toContain("Found it.");
  });
});
