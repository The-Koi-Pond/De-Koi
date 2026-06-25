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
        value: expect.objectContaining({
          selectedConnectionId: "conn-1",
          selectedPersonaId: null,
          activeSessionId: expect.any(String),
          sessions: [
            expect.objectContaining({
              messages: [
                expect.objectContaining({
                  role: "user",
                  content: "Hello, Deki.",
                }),
              ],
            }),
          ],
        }),
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
      value: expect.objectContaining({
        selectedConnectionId: "legacy-conn",
        selectedPersonaId: null,
        activeSessionId: "deki-session-default",
        sessions: [
          expect.objectContaining({
            id: "deki-session-default",
            messages: [
              expect.objectContaining({ id: "legacy-message", content: "Old hello" }),
              expect.objectContaining({ role: "assistant", content: "Migrated hello" }),
            ],
          }),
        ],
      }),
    });
  });
});
