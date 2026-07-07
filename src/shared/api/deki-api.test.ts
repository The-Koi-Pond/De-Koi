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
  let recordsByEntity: Map<string, Map<string, Record<string, unknown>>>;

  const recordsFor = (entity: string) => {
    let records = recordsByEntity.get(entity);
    if (!records) {
      records = new Map<string, Record<string, unknown>>();
      recordsByEntity.set(entity, records);
    }
    return records;
  };

  const listRecords = (
    entity: string,
    options?: { filters?: Record<string, unknown>; orderBy?: string; descending?: boolean },
  ) => {
    let records = [...recordsFor(entity).values()];
    const filters = options?.filters ?? {};
    for (const [key, value] of Object.entries(filters)) {
      records = records.filter((record) => record[key] === value);
    }
    if (options?.orderBy) {
      const key = options.orderBy;
      records = records.sort((left, right) => {
        const leftValue = String(left[key] ?? "");
        const rightValue = String(right[key] ?? "");
        return options.descending ? rightValue.localeCompare(leftValue) : leftValue.localeCompare(rightValue);
      });
    }
    return records.map((record) => ({ ...record }));
  };

  beforeEach(() => {
    recordsByEntity = new Map<string, Map<string, Record<string, unknown>>>();
    appSettings = recordsFor("app-settings");
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
        options?: { filters?: Record<string, unknown>; orderBy?: string; descending?: boolean };
      };

      if (command === "storage_get") {
        return request.entity && request.id ? (recordsFor(request.entity).get(request.id) ?? null) : null;
      }

      if (command === "storage_list") {
        if (!request.entity) throw new Error("Missing list entity");
        return listRecords(request.entity, request.options);
      }

      if (command === "storage_create") {
        const id = request.value?.id;
        if (!request.entity) throw new Error("Missing create entity");
        if (typeof id !== "string") throw new Error("Missing fixed id");
        const records = recordsFor(request.entity);
        if (records.has(id)) throw new Error(`Duplicate fixed id ${id}`);
        records.set(id, { ...request.value });
        return records.get(id);
      }

      if (command === "storage_update") {
        const id = request.id;
        if (!request.entity) throw new Error("Missing update entity");
        if (typeof id !== "string") throw new Error("Missing update id");
        const records = recordsFor(request.entity);
        if (!records.has(id)) throw new Error(`Missing fixed id ${id}`);
        const next = { ...records.get(id), ...request.patch };
        records.set(id, next);
        return next;
      }

      if (command === "storage_delete") {
        const id = request.id;
        if (!request.entity) throw new Error("Missing delete entity");
        if (typeof id !== "string") throw new Error("Missing delete id");
        recordsFor(request.entity).delete(id);
        return null;
      }

      throw new Error(`Unexpected command ${command}`);
    });
  });

  it("updates the fixed Deki settings row after the first save", async () => {
    await dekiApi.preferences.save({ selectedConnectionId: "conn-1", selectedPersonaId: null });
    await dekiApi.history.appendMessage({ role: "user", content: "Hello, Deki." });

    expect(appSettings.get("deki")).toMatchObject({
      id: "deki",
      value: expect.objectContaining({
        selectedConnectionId: "conn-1",
        selectedPersonaId: null,
        activeSessionId: expect.any(String),
      }),
    });
    expect(appSettings.get("deki")?.value).not.toHaveProperty("sessions");
    expect([...recordsFor("deki-sessions").values()]).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        title: "Hello, Deki.",
      }),
    ]);
    expect([...recordsFor("deki-messages").values()]).toEqual([
      expect.objectContaining({
        role: "user",
        content: "Hello, Deki.",
      }),
    ]);
  });

  it("reads legacy settings once and writes the next update into the Deki row", async () => {
    appSettings.set("professor-mari", {
      id: "professor-mari",
      value: {
        selectedConnectionId: "legacy-conn",
        selectedPersonaId: null,
        layoutDensity: "compact",
        compactedSummary: "Earlier Deki summary",
        compactedAt: "2026-01-01T00:05:00.000Z",
        compactedThroughMessageId: "legacy-message",
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
      value: expect.objectContaining({
        selectedConnectionId: "legacy-conn",
        selectedPersonaId: null,
        layoutDensity: "compact",
        activeSessionId: "deki-session-default",
      }),
    });
    expect(appSettings.get("deki")?.value).not.toHaveProperty("messages");
    expect(appSettings.get("deki")?.value).not.toHaveProperty("sessions");
    expect([...recordsFor("deki-sessions").values()]).toEqual([
      expect.objectContaining({
        id: "deki-session-default",
        compaction: {
          compactedSummary: "Earlier Deki summary",
          compactedAt: "2026-01-01T00:05:00.000Z",
          compactedThroughMessageId: "legacy-message",
        },
      }),
    ]);
    expect([...recordsFor("deki-messages").values()]).toEqual([
      expect.objectContaining({ id: "legacy-message", content: "Old hello", sortOrder: 0 }),
      expect.objectContaining({ role: "assistant", content: "Migrated hello", sortOrder: 1 }),
    ]);
    expect(appSettings.has("professor-mari")).toBe(false);
  });

  it("migrates legacy history into durable records with required fields and active settings synced", async () => {
    const action = {
      type: "create_record",
      entity: "personas",
      draft: {
        name: "Sol",
        description: "Sunny traveler",
        personality: "Bright",
        scenario: "Roadside inn",
        backstory: "Raised by caravan cooks.",
        appearance: "Sun-faded cloak and quick hands.",
      },
    };
    appSettings.set("professor-mari", {
      id: "professor-mari",
      value: {
        activeSessionId: "missing-session",
        messages: [
          {
            id: "assistant-action",
            role: "assistant",
            content: "Draft ready.",
            createdAt: "2026-01-01T00:00:00.000Z",
            action,
          },
        ],
      },
    });

    const state = await dekiApi.sessions.list();

    expect(state.activeSessionId).toBe("deki-session-default");
    expect(appSettings.get("deki")).toMatchObject({
      id: "deki",
      value: expect.objectContaining({ activeSessionId: "deki-session-default" }),
    });
    expect(appSettings.get("deki")?.value).not.toHaveProperty("messages");
    expect(appSettings.has("professor-mari")).toBe(false);
    expect(recordsFor("deki-sessions").get("deki-session-default")).toEqual(
      expect.objectContaining({
        id: "deki-session-default",
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      }),
    );
    const durableMessage = recordsFor("deki-messages").get("assistant-action");
    expect(durableMessage).toEqual(
      expect.objectContaining({
        id: "assistant-action",
        sessionId: "deki-session-default",
        createdAt: "2026-01-01T00:00:00.000Z",
        sortOrder: 0,
        action,
        actionApplication: null,
      }),
    );
    expect(durableMessage).toHaveProperty("actionApplication", null);
  });
  it("preserves unrelated settings fields when saving session state", async () => {
    appSettings.set("deki", {
      id: "deki",
      value: {
        selectedConnectionId: "conn-2",
        selectedPersonaId: "persona-2",
        layoutDensity: "comfortable",
        activeSessionId: "session-1",
        sessions: [
          {
            id: "session-1",
            title: "Existing chat",
            createdAt: "2026-01-02T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
            messages: [],
            compaction: {
              compactedSummary: "Existing summary",
              compactedAt: "2026-01-02T00:01:00.000Z",
              compactedThroughMessageId: "message-0",
            },
          },
        ],
      },
    });

    await dekiApi.history.appendMessage({ sessionId: "session-1", role: "user", content: "Keep the rest." });

    expect(appSettings.get("deki")?.value).toEqual(
      expect.objectContaining({
        selectedConnectionId: "conn-2",
        selectedPersonaId: "persona-2",
        layoutDensity: "comfortable",
        activeSessionId: "session-1",
      }),
    );
    expect(appSettings.get("deki")?.value).not.toHaveProperty("sessions");
    expect(recordsFor("deki-sessions").get("session-1")).toEqual(
      expect.objectContaining({
        id: "session-1",
        compaction: {
          compactedSummary: "Existing summary",
          compactedAt: "2026-01-02T00:01:00.000Z",
          compactedThroughMessageId: "message-0",
        },
      }),
    );
    expect([...recordsFor("deki-messages").values()]).toEqual([
      expect.objectContaining({ sessionId: "session-1", role: "user", content: "Keep the rest." }),
    ]);
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

  it("keeps legacy and future history visible while flagging malformed current rows", async () => {
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
                id: "legacy-missing-validation",
                sessionId: "legacy-session",
                command: "legacy command",
                status: "dry-run",
                createdAt: "2026-06-24T00:00:00.000Z",
              },
              {
                id: "legacy-missing-status",
                command: "legacy command",
                validationStatus: "passed",
                createdAt: "2026-06-24T00:01:00.000Z",
              },
              {
                id: "future-history",
                kind: "future_history",
                schemaVersion: "2",
                payload: {
                  command: "future command",
                  status: "archived",
                  validationStatus: "reviewing",
                },
                createdAt: "2026-06-24T00:02:00.000Z",
              },
              {
                id: "invalid-current-status",
                kind: "future_history",
                sessionId: "session-1",
                command: "invalid current status",
                status: "archived",
                validationStatus: "reviewing",
                createdAt: "2026-06-24T00:02:30.000Z",
              },
              {
                id: "malformed-current",
                sessionId: "session-1",
                command: "",
                status: "dry-run",
                validationStatus: "passed",
                createdAt: "2026-06-24T00:03:00.000Z",
              },
              "unrecoverable junk",
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
          status: "unknown",
          id: "legacy-missing-validation",
          createdAt: "2026-06-24T00:00:00.000Z",
          raw: expect.objectContaining({
            command: "legacy command",
          }),
        },
        {
          status: "unknown",
          id: "legacy-missing-status",
          createdAt: "2026-06-24T00:01:00.000Z",
          raw: expect.objectContaining({
            validationStatus: "passed",
          }),
        },
        {
          status: "unknown",
          id: "future-history",
          createdAt: "2026-06-24T00:02:00.000Z",
          raw: expect.objectContaining({
            kind: "future_history",
            schemaVersion: "2",
            payload: expect.objectContaining({
              status: "archived",
              validationStatus: "reviewing",
            }),
          }),
        },
        {
          status: "malformed",
          id: "invalid-current-status",
          createdAt: "2026-06-24T00:02:30.000Z",
          reason: "invalid current history status",
          raw: expect.objectContaining({
            kind: "future_history",
            status: "archived",
            validationStatus: "reviewing",
          }),
        },
        {
          status: "malformed",
          id: "malformed-current",
          createdAt: "2026-06-24T00:03:00.000Z",
          reason: "invalid current history required field",
          raw: expect.objectContaining({
            command: "",
          }),
        },
      ],
    });
  });

  it("fails workspace runtime calls when no runtime is configured", async () => {
    embeddedMock.mockReturnValue(false);
    remoteRuntimeTargetMock.mockReturnValue(null);

    const status = dekiApi.workspace.status("conn-1");
    const abort = dekiApi.workspace.abort();
    const approval = dekiApi.workspace.approve("approval-1");

    await expect(status).rejects.toMatchObject({
      message: "Deki workspace runtime requires the Tauri app shell or a configured remote runtime.",
      status: 400,
      details: expect.objectContaining({
        code: "deki_workspace_runtime_unavailable",
        command: "deki_workspace_status",
      }),
    });
    await expect(abort).rejects.toMatchObject({
      message: "Deki workspace runtime requires the Tauri app shell or a configured remote runtime.",
      status: 400,
      details: expect.objectContaining({
        code: "deki_workspace_runtime_unavailable",
        command: "deki_workspace_abort",
      }),
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

  it("routes workspace abort and preserves the not-running result", async () => {
    embeddedMock.mockReturnValue(true);
    remoteRuntimeTargetMock.mockReturnValue(null);
    invokeMock.mockResolvedValueOnce({
      status: "not_running",
      aborted: false,
      active: false,
      reason: "Deki workspace runtime is not running.",
    });

    await expect(dekiApi.workspace.abort()).resolves.toMatchObject({
      status: "not_running",
      aborted: false,
      active: false,
    });

    expect(invokeMock).toHaveBeenCalledWith("deki_workspace_abort");
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
