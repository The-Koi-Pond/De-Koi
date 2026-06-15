import { beforeEach, describe, expect, it, vi } from "vitest";
import { mariApi } from "./mari-api";
import { invokeTauri } from "./tauri-client";

vi.mock("./tauri-client", () => ({
  invokeTauri: vi.fn(),
}));

const invokeMock = vi.mocked(invokeTauri);

describe("mariApi settings persistence", () => {
  beforeEach(() => {
    const appSettings = new Map<string, Record<string, unknown>>();

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

  it("updates the fixed Assistant settings row after the first save", async () => {
    await mariApi.preferences.save({ selectedConnectionId: "conn-1", selectedPersonaId: null });
    await mariApi.history.appendMessage({ role: "user", content: "Hello, Professor." });

    const createCalls = invokeMock.mock.calls.filter(([command]) => command === "storage_create");
    const updateCalls = invokeMock.mock.calls.filter(([command]) => command === "storage_update");

    expect(createCalls).toHaveLength(1);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.[1]).toMatchObject({
      entity: "app-settings",
      id: "professor-mari",
      patch: {
        value: {
          selectedConnectionId: "conn-1",
          selectedPersonaId: null,
          messages: [
            expect.objectContaining({
              role: "user",
              content: "Hello, Professor.",
            }),
          ],
        },
      },
    });
  });
});
