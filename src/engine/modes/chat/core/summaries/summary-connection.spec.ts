import { describe, expect, it } from "vitest";

import type { StorageGateway } from "../../../../capabilities/storage";
import { resolveChatSummaryConnectionId } from "./summary-connection";

function storage(input: { agents?: unknown[]; connections: unknown[]; routes?: Record<string, string> }) {
  return {
    async get(entity: string, id: string) {
      return entity === "app-settings" && id === "model-routing" && input.routes
        ? { id, value: { version: 1, routes: input.routes } }
        : null;
    },
    async list(entity: string) {
      if (entity === "agents") return input.agents ?? [];
      if (entity === "connections") return input.connections;
      return [];
    },
  } as unknown as Pick<StorageGateway, "get" | "list">;
}

const connections = [
  { id: "chat-connection", provider: "openai", model: "big" },
  { id: "agents-default", provider: "openai", model: "agent", defaultForAgents: true },
  { id: "cheap", name: "Cheap", provider: "openai", model: "small" },
];

describe("resolveChatSummaryConnectionId", () => {
  it("keeps today's order when summaries are not routed", async () => {
    await expect(
      resolveChatSummaryConnectionId(storage({ connections }), { connectionId: "chat-connection" }),
    ).resolves.toBe("agents-default");
  });

  it("uses the summaries route over Default for Agents and the chat's connection", async () => {
    await expect(
      resolveChatSummaryConnectionId(storage({ connections, routes: { summaries: "cheap" } }), {
        connectionId: "chat-connection",
      }),
    ).resolves.toBe("cheap");
  });

  it("lets the Chat Summary agent's own connection win over the route", async () => {
    await expect(
      resolveChatSummaryConnectionId(
        storage({
          agents: [{ id: "chat-summary", connectionId: "chat-connection" }],
          connections,
          routes: { summaries: "cheap" },
        }),
        { connectionId: "chat-connection" },
      ),
    ).resolves.toBe("chat-connection");
  });

  it("refuses a broken summaries route instead of using Default for Agents", async () => {
    await expect(
      resolveChatSummaryConnectionId(storage({ connections, routes: { summaries: "gone" } }), {
        connectionId: "chat-connection",
      }),
    ).rejects.toThrow("The Summaries helper is set to a connection that no longer exists.");
  });
});
