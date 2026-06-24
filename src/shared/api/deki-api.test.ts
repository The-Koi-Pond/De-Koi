import { beforeEach, describe, expect, it, vi } from "vitest";
import { dekiApi } from "./deki-api";
import { invokeTauri } from "./tauri-client";

vi.mock("./tauri-client", () => ({
  invokeTauri: vi.fn(),
}));

const invokeMock = vi.mocked(invokeTauri);

describe("dekiApi settings persistence", () => {
  let appSettings: Map<string, Record<string, unknown>>;

  beforeEach(() => {
    appSettings = new Map<string, Record<string, unknown>>();
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
            type: "tool",
            tool: expect.objectContaining({
              id: "tool-1",
              name: "deki_code",
              status: "done",
            }),
          },
        ],
        workspaceHistory: [
          expect.objectContaining({
            id: "history-1",
            command: "deki code grep Deki",
            status: "dry-run",
          }),
        ],
      }),
    ]);
  });
});
