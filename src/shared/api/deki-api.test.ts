import { beforeEach, describe, expect, it, vi } from "vitest";
import { dekiApi } from "./deki-api";
import { remoteRuntimeTarget } from "./remote-runtime";
import { hasEmbeddedTauriIpc, invokeTauri } from "./tauri-client";

vi.mock("./tauri-client", () => ({
  hasEmbeddedTauriIpc: vi.fn(),
  invokeTauri: vi.fn(),
}));

vi.mock("./remote-runtime", () => ({
  remoteRuntimeTarget: vi.fn(),
}));

const embeddedMock = vi.mocked(hasEmbeddedTauriIpc);
const invokeMock = vi.mocked(invokeTauri);
const remoteRuntimeTargetMock = vi.mocked(remoteRuntimeTarget);

describe("dekiApi settings persistence", () => {
  let appSettings: Map<string, Record<string, unknown>>;

  beforeEach(() => {
    appSettings = new Map<string, Record<string, unknown>>();
    embeddedMock.mockReset();
    invokeMock.mockReset();
    remoteRuntimeTargetMock.mockReset();
    embeddedMock.mockReturnValue(true);
    remoteRuntimeTargetMock.mockReturnValue(null);
    invokeMock.mockImplementation(async (command, args) => {
      const request = args as {
        entity?: string;
        id?: string;
        value?: Record<string, unknown>;
        patch?: Record<string, unknown>;
      };

      if (request.entity !== "app-settings") {
        throw new Error(`Unexpected entity ${request.entity ?? "<missing>"}`);
      }

      if (command === "storage_get") {
        return (request.id ? appSettings.get(request.id) : null) ?? null;
      }

      if (command === "storage_create") {
        const id = request.value?.id;
        if (typeof id !== "string") throw new Error("Missing fixed settings id");
        if (appSettings.has(id)) throw new Error(`Duplicate fixed id ${id}`);
        appSettings.set(id, { ...request.value });
        return appSettings.get(id);
      }

      if (command === "storage_update") {
        const id = request.id;
        if (typeof id !== "string") throw new Error("Missing update id");
        if (!appSettings.has(id)) throw new Error(`Missing fixed id ${id}`);
        const next = { ...appSettings.get(id), ...request.patch };
        appSettings.set(id, next);
        return next;
      }

      throw new Error(`Unexpected command ${command}`);
    });
  });

  it("updates the fixed Deki settings row after the first save", async () => {
    await dekiApi.preferences.save({ selectedConnectionId: "conn-1", selectedPersonaId: null });
    await dekiApi.history.appendMessage({ role: "user", content: "Hello, Deki." });

    const createCalls = invokeMock.mock.calls.filter(([command]) => command === "storage_create");
    const updateCalls = invokeMock.mock.calls.filter(([command]) => command === "storage_update");

    expect(createCalls).toHaveLength(1);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.[1]).toMatchObject({
      entity: "app-settings",
      id: "deki",
      patch: {
        value: {
          selectedConnectionId: "conn-1",
          selectedPersonaId: null,
          messages: [
            expect.objectContaining({
              role: "user",
              content: "Hello, Deki.",
            }),
          ],
        },
      },
    });
  });

  it("reads legacy settings once and writes the next update into the Deki row", async () => {
    appSettings.set("professor-mari", {
      id: "professor-mari",
      value: {
        selectedConnectionId: "legacy-conn",
        selectedPersonaId: null,
        messages: [
          {
            id: "legacy-message",
            role: "user",
            content: "Old hello",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    });

    await expect(dekiApi.preferences.get()).resolves.toEqual({
      selectedConnectionId: "legacy-conn",
      selectedPersonaId: null,
    });

    await dekiApi.history.appendMessage({ role: "assistant", content: "Migrated hello" });

    expect(appSettings.get("deki")).toMatchObject({
      id: "deki",
      value: {
        selectedConnectionId: "legacy-conn",
        selectedPersonaId: null,
        messages: [
          expect.objectContaining({ id: "legacy-message", content: "Old hello" }),
          expect.objectContaining({ role: "assistant", content: "Migrated hello" }),
        ],
      },
    });
  });

  it("preserves Deki workspace trace and history on stored messages", async () => {
    appSettings.set("deki", {
      id: "deki",
      value: {
        messages: [
          {
            id: "message-1",
            role: "assistant",
            content: "Checked the workspace.",
            createdAt: "2026-06-24T00:00:00.000Z",
            workspaceTrace: [
              { type: "status", content: "Reading files" },
              {
                type: "future_event",
                payload: {
                  message: "Runtime added a new trace item",
                },
              },
              {
                type: "tool",
                tool: {
                  id: "tool-1",
                  name: "deki_code",
                  status: "done",
                  input: { command: "grep Deki" },
                  output: "src/engine/deki/deki-entry.ts",
                  updatedAt: 1760000000000,
                },
              },
            ],
            workspaceHistory: [
              {
                kind: "future_history",
                payload: {
                  message: "Runtime added a new history item",
                },
              },
              {
                id: "history-1",
                sessionId: "session-1",
                command: "deki code grep Deki",
                reason: null,
                status: "dry-run",
                operationHash: "hash-1",
                affectedEntities: {},
                affectedRows: 0,
                validationStatus: "passed",
                journalPath: null,
                createdAt: "2026-06-24T00:00:00.000Z",
              },
            ],
          },
        ],
      },
    });

    const result = await dekiApi.history.get();

    expect(result.messages).toEqual([
      expect.objectContaining({
        id: "message-1",
        workspaceTrace: [
          { type: "status", content: "Reading files" },
          {
            type: "unknown",
            raw: {
              type: "future_event",
              payload: {
                message: "Runtime added a new trace item",
              },
            },
          },
          {
            type: "tool",
            tool: expect.objectContaining({
              id: "tool-1",
              name: "deki_code",
              status: "done",
            }),
          },
        ],
        workspaceHistory: [
          {
            status: "unknown",
            raw: {
              kind: "future_history",
              payload: {
                message: "Runtime added a new history item",
              },
            },
          },
          expect.objectContaining({
            id: "history-1",
            command: "deki code grep Deki",
            status: "dry-run",
          }),
        ],
      }),
    ]);
  });

  it("keeps a valid message when workspace metadata contains malformed entries", async () => {
    appSettings.set("deki", {
      id: "deki",
      value: {
        messages: [
          {
            id: "message-1",
            role: "assistant",
            content: "Visible answer survives.",
            createdAt: "2026-06-24T00:00:00.000Z",
            workspaceTrace: [
              {
                type: "tool",
                tool: {
                  id: "",
                  name: "shell",
                  status: "finished",
                },
              },
            ],
            workspaceHistory: [
              {
                id: "history-1",
                command: "",
                status: "future_status",
              },
            ],
          },
        ],
      },
    });

    const result = await dekiApi.history.get();

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      id: "message-1",
      content: "Visible answer survives.",
      workspaceTrace: [
        {
          type: "unknown",
          raw: expect.objectContaining({
            type: "tool",
          }),
        },
      ],
      workspaceHistory: [
        {
          status: "malformed",
          id: "history-1",
          reason: expect.stringContaining("missing required current-contract fields"),
          raw: expect.objectContaining({
            status: "future_status",
          }),
        },
      ],
    });
  });

  it("returns unsupported status but fails approval actions when no runtime is configured", async () => {
    embeddedMock.mockReturnValue(false);
    remoteRuntimeTargetMock.mockReturnValue(null);

    const status = await dekiApi.workspace.status("conn-1");
    const approval = dekiApi.workspace.approve("approval-1");

    expect(status).toMatchObject({
      enabled: false,
      connection: null,
      active: false,
      error: expect.stringContaining("requires the Tauri app shell or a configured remote runtime"),
    });
    await expect(approval).rejects.toMatchObject({
      message: "Deki workspace runtime requires the Tauri app shell or a configured remote runtime.",
      status: 400,
      details: expect.objectContaining({
        code: "deki_workspace_runtime_unavailable",
        command: "deki_workspace_approve",
      }),
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("routes workspace calls through the embedded runtime when Tauri is available", async () => {
    embeddedMock.mockReturnValue(true);
    remoteRuntimeTargetMock.mockReturnValue(null);
    invokeMock.mockResolvedValueOnce({
      enabled: false,
      workspace: "C:\\De-Koi",
      dataDir: "C:\\De-Koi\\data",
      tools: ["read"],
      dataAccess: "server-managed",
      connection: null,
      active: false,
      pendingApprovals: [],
      history: [],
    });

    await dekiApi.workspace.status("conn-1");

    expect(invokeMock).toHaveBeenCalledWith("deki_workspace_status", { connectionId: "conn-1" });
  });

  it("routes workspace approval calls through the remote runtime when configured", async () => {
    embeddedMock.mockReturnValue(false);
    remoteRuntimeTargetMock.mockReturnValue({ baseUrl: "http://127.0.0.1:3080" });
    invokeMock.mockResolvedValueOnce({
      id: "approval-1",
      status: "not_found",
      pendingApprovals: [],
      history: [],
    });

    await dekiApi.workspace.reject("approval-1");

    expect(invokeMock).toHaveBeenCalledWith("deki_workspace_reject", { id: "approval-1" });
  });
});
