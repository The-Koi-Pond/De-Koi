import { describe, expect, it } from "vitest";

import type { StorageGateway } from "../../../../capabilities/storage";
import { readHelperRuns } from "../../../../generation/helper-runs";
import { pickChatSummaryConnection, resolveChatSummaryRunConnectionId } from "./summary-connection";

async function resolveChatSummaryConnectionId(
  gateway: Pick<StorageGateway, "get" | "list">,
  chat: { connectionId?: unknown },
): Promise<string> {
  return (await pickChatSummaryConnection(gateway, chat)).connectionId;
}

function storage(input: {
  agents?: unknown[];
  connections: unknown[];
  routes?: Record<string, string>;
  localOnly?: string[];
}) {
  return {
    async get(entity: string, id: string) {
      return entity === "app-settings" && id === "model-routing" && input.routes
        ? { id, value: { version: 1, routes: input.routes, localOnly: input.localOnly } }
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

  it("keeps a local-only Summaries helper off the agent's own remote connection", async () => {
    const withLocal = [
      ...connections,
      { id: "ollama", provider: "custom", model: "m", baseUrl: "http://ollama:11434" },
    ];
    const ask = (agentConnectionId: string) =>
      resolveChatSummaryConnectionId(
        storage({
          agents: [{ id: "chat-summary", connectionId: agentConnectionId }],
          connections: withLocal,
          routes: { summaries: "ollama" },
          localOnly: ["summaries"],
        }),
        { connectionId: "chat-connection" },
      );
    await expect(ask("chat-connection")).rejects.toMatchObject({ name: "ModelRouteError", problem: "not_local" });
    await expect(ask("ollama")).resolves.toBe("ollama");
  });

  it("refuses a broken summaries route instead of using Default for Agents", async () => {
    await expect(
      resolveChatSummaryConnectionId(storage({ connections, routes: { summaries: "gone" } }), {
        connectionId: "chat-connection",
      }),
    ).rejects.toThrow("The Summaries helper is set to a connection that no longer exists.");
  });
  it("says which step picked the connection", async () => {
    const pick = (input: Parameters<typeof storage>[0], chat: { connectionId?: unknown }) =>
      pickChatSummaryConnection(storage(input), chat).then((picked) => picked.rule);
    await expect(pick({ connections, agents: [{ id: "chat-summary", connectionId: "cheap" }] }, {})).resolves.toBe(
      "agent",
    );
    await expect(pick({ connections, routes: { summaries: "cheap" } }, {})).resolves.toBe("route");
    await expect(pick({ connections }, { connectionId: "chat-connection" })).resolves.toBe("agentDefault");
    const plain = connections.filter((connection) => !connection.defaultForAgents);
    await expect(pick({ connections: plain }, { connectionId: "chat-connection" })).resolves.toBe("chat");
    await expect(pick({ connections: plain }, {})).resolves.toBe("first");
  });

  it("notes a Summarize chat run, and a broken route as the reason it stopped", async () => {
    const rows = new Map<string, unknown>();
    const writable = (routes?: Record<string, string>) => {
      const base = storage({ connections, routes });
      return {
        get: async (entity: string, id: string) =>
          entity === "app-settings" && id !== "model-routing" ? (rows.get(id) ?? null) : base.get(entity as never, id),
        list: base.list,
        create: async (_entity: string, value: { id: string }) => rows.set(value.id, value),
        update: async (_entity: string, id: string, patch: object) => rows.set(id, { id, ...patch }),
      } as unknown as Pick<StorageGateway, "get" | "list" | "create" | "update">;
    };

    await expect(
      resolveChatSummaryRunConnectionId(writable({ summaries: "cheap" }), {
        id: "chat-1",
        connectionId: "chat-connection",
      }),
    ).resolves.toBe("cheap");
    expect((await readHelperRuns(writable()))?.summaries?.[0]).toMatchObject({
      job: "Summarize chat",
      chatId: "chat-1",
      connectionId: "cheap",
      rule: "route",
      problem: null,
    });

    await expect(
      resolveChatSummaryRunConnectionId(writable({ summaries: "gone" }), {
        id: "chat-1",
        connectionId: "chat-connection",
      }),
    ).rejects.toMatchObject({ code: "route_unavailable" });
    expect((await readHelperRuns(writable()))?.summaries?.[0]?.problem).toContain("no longer exists");
  });
});
