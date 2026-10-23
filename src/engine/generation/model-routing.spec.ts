import { describe, expect, it } from "vitest";

import type { StorageGateway } from "../capabilities/storage";
import {
  ModelRouteError,
  assertLocalOnlyConnection,
  isLocalConnection,
  isModelRouteError,
  normalizeModelRoutingSettings,
  resolveModelRoute,
  resolveStoredModelRoute,
} from "./model-routing";
import type { JsonRecord } from "./runtime-records";

const connections: JsonRecord[] = [
  { id: "strong", name: "Strong", provider: "anthropic", model: "big-model" },
  { id: "cheap", name: "Cheap", provider: "openai", model: "small-model" },
  { id: "off", name: "Off", provider: "openai", model: "small-model", enabled: false },
  { id: "images", name: "Pictures", provider: "image_generation", model: "image-model" },
  { id: "blank", name: "Blank", provider: "openai", model: "" },
  { id: "ollama", name: "Ollama", provider: "custom", model: "llama", baseUrl: "http://127.0.0.1:11434/v1" },
];

function routed(routes: Record<string, string>, localOnly?: string[]) {
  return normalizeModelRoutingSettings({ version: 1, routes, localOnly });
}

function routeError(run: () => unknown): ModelRouteError {
  try {
    run();
  } catch (error) {
    if (isModelRouteError(error)) return error;
    throw error;
  }
  throw new Error("expected a ModelRouteError");
}

describe("normalizeModelRoutingSettings", () => {
  it("keeps known tasks with a connection id and drops the rest", () => {
    expect(
      normalizeModelRoutingSettings({
        routes: { memory: " cheap ", summaries: "", habitCheck: "cheap", judge: "strong", replies: "strong", other: 3 },
      }),
    ).toEqual({ version: 1, routes: { memory: "cheap", habitCheck: "cheap", judge: "strong" } });
  });

  it("keeps the newer helper tasks", () => {
    expect(
      normalizeModelRoutingSettings({
        routes: { responder: "cheap", status: "cheap", schedules: "cheap", interpretations: "cheap" },
      }).routes,
    ).toEqual({ responder: "cheap", status: "cheap", schedules: "cheap", interpretations: "cheap" });
  });

  it("keeps known local-only tasks in task order, and leaves the field off when there are none", () => {
    expect(normalizeModelRoutingSettings({ routes: {}, localOnly: ["status", "replies", " memory ", 4] })).toEqual({
      version: 1,
      routes: {},
      localOnly: ["memory", "status"],
    });
    expect(normalizeModelRoutingSettings({ routes: {}, localOnly: [] })).toEqual({ version: 1, routes: {} });
    expect(normalizeModelRoutingSettings({ routes: {}, localOnly: "memory" })).toEqual({ version: 1, routes: {} });
  });

  it("reads nothing routed from a missing or malformed value", () => {
    expect(normalizeModelRoutingSettings(null)).toEqual({ version: 1, routes: {} });
    expect(normalizeModelRoutingSettings("not json")).toEqual({ version: 1, routes: {} });
  });
});

describe("resolveModelRoute", () => {
  it("returns null for a task without a route, so the caller keeps its own choice", () => {
    expect(resolveModelRoute("memory", routed({ summaries: "cheap" }), connections)).toBeNull();
  });

  it("returns the routed connection", () => {
    expect(resolveModelRoute("summaries", routed({ summaries: "cheap" }), connections)).toMatchObject({
      id: "cheap",
      model: "small-model",
    });
  });

  it("routes to the Local Model, which is not a stored connection", () => {
    expect(resolveModelRoute("memory", routed({ memory: "sidecar:local" }), connections)).toMatchObject({
      id: "sidecar:local",
      provider: "sidecar",
    });
  });

  it.each([
    ["gone", "missing", "The Memory helper is set to a connection that no longer exists."],
    ["off", "disabled", 'The Memory helper is set to "Off", which is turned off.'],
    ["images", "not_text", 'The Memory helper is set to "Pictures", which makes images, not text.'],
    ["blank", "no_model", 'The Memory helper is set to "Blank", which has no model picked.'],
  ])("refuses a route to %s connection instead of falling back", (connectionId, problem, message) => {
    const error = routeError(() => resolveModelRoute("memory", routed({ memory: connectionId }), connections));
    expect(error).toMatchObject({ task: "memory", connectionId, problem, code: "route_unavailable" });
    expect(error.message).toBe(
      `${message} Pick another connection, or "Same as today", in Connections → Helper Models.`,
    );
  });
});

describe("resolveStoredModelRoute", () => {
  function storage(value: unknown) {
    const reads: string[] = [];
    const gateway = {
      async get<T>(entity: string, id: string) {
        reads.push(`get:${entity}/${id}`);
        return (entity === "app-settings" && id === "model-routing" && value !== undefined ? { id, value } : null) as T;
      },
      async list<T>(entity: string) {
        reads.push(`list:${entity}`);
        return (entity === "connections" ? connections : []) as T[];
      },
    } as Pick<StorageGateway, "get" | "list">;
    return { gateway, reads };
  }

  it("does not list connections when nothing is routed", async () => {
    const { gateway, reads } = storage(undefined);
    await expect(resolveStoredModelRoute(gateway, "memory")).resolves.toBeNull();
    expect(reads).toEqual(["get:app-settings/model-routing"]);
  });

  it("resolves the stored route against stored connections", async () => {
    const { gateway } = storage({ version: 1, routes: { memory: "cheap" } });
    await expect(resolveStoredModelRoute(gateway, "memory")).resolves.toMatchObject({ id: "cheap" });
  });

  it("checks an unrouted local-only task against stored settings", async () => {
    const { gateway } = storage({ version: 1, routes: {}, localOnly: ["interpretations"] });
    await expect(resolveStoredModelRoute(gateway, "interpretations")).rejects.toMatchObject({
      problem: "no_local_route",
    });
    await expect(resolveStoredModelRoute(gateway, "status")).resolves.toBeNull();
  });

  it("rejects a stored route to a deleted connection", async () => {
    const { gateway } = storage({ version: 1, routes: { summaries: "gone" } });
    await expect(resolveStoredModelRoute(gateway, "summaries")).rejects.toMatchObject({
      name: "ModelRouteError",
      problem: "missing",
    });
  });
});

describe("isLocalConnection", () => {
  it.each([
    ["the Local Model", { id: "sidecar:local", provider: "sidecar" }],
    ["localhost", { provider: "custom", baseUrl: "http://localhost:11434/v1" }],
    ["loopback", { provider: "openai", baseUrl: "http://127.0.0.1:8080/v1" }],
    ["a 10.x LAN address", { provider: "custom", baseUrl: "http://10.0.0.5:5000" }],
    ["a 172.16-31 LAN address", { provider: "custom", baseUrl: "http://172.20.1.1/v1" }],
    ["a 192.168 LAN address", { provider: "custom", baseUrl: "192.168.1.20:1234/v1" }],
    ["a .local name", { provider: "custom", baseUrl: "http://gpu-box.local:8000/v1" }],
    ["a one-word host", { provider: "custom", baseUrl: "http://ollama:11434" }],
    ["IPv6 loopback", { provider: "custom", baseUrl: "http://[::1]:8080" }],
    ["an IPv6 unique-local address", { provider: "custom", baseUrl: "http://[fd12:3456::1]:8080" }],
  ])("counts %s as local", (_label, connection) => {
    expect(isLocalConnection(connection)).toBe(true);
  });

  it.each([
    ["a blank base URL (the provider's cloud API)", { provider: "openai", baseUrl: "" }],
    ["a cloud API", { provider: "openai", baseUrl: "https://api.openai.com/v1" }],
    ["OpenRouter", { provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1" }],
    ["a public address", { provider: "custom", baseUrl: "http://8.8.8.8/v1" }],
    ["an address just outside 172.16-31", { provider: "custom", baseUrl: "http://172.32.0.1/v1" }],
    ["a look-alike name", { provider: "custom", baseUrl: "https://localhost.example.com/v1" }],
    ["ChatGPT sign-in, whatever its base URL", { provider: "openai_chatgpt", baseUrl: "http://localhost:1" }],
    ["Claude subscription, whatever its base URL", { provider: "claude_subscription", baseUrl: "http://localhost:1" }],
    ["an unreadable base URL", { provider: "custom", baseUrl: "http://[nope" }],
  ])("does not count %s as local", (_label, connection) => {
    expect(isLocalConnection(connection)).toBe(false);
  });
});

describe("local-only helpers", () => {
  it("stops an unrouted local-only task, since its old pick may not be local", () => {
    const error = routeError(() => resolveModelRoute("status", routed({}, ["status"]), connections));
    expect(error).toMatchObject({ task: "status", problem: "no_local_route", code: "route_unavailable" });
    expect(error.message).toBe(
      'The Status blurbs helper must stay on your device, but has no connection on your device picked. Pick a connection on this device or network, or turn off "Keep on my device", in Connections → Helper Models.',
    );
  });

  it("refuses a local-only route to a remote connection instead of sending it there", () => {
    const error = routeError(() =>
      resolveModelRoute("responder", routed({ responder: "cheap" }, ["responder"]), connections),
    );
    expect(error).toMatchObject({ task: "responder", connectionId: "cheap", problem: "not_local" });
    expect(error.message).toContain('"Cheap" sends work off it.');
  });

  it("runs a local-only route on a local connection or the Local Model", () => {
    expect(resolveModelRoute("memory", routed({ memory: "ollama" }, ["memory"]), connections)).toMatchObject({
      id: "ollama",
    });
    expect(resolveModelRoute("memory", routed({ memory: "sidecar:local" }, ["memory"]), connections)).toMatchObject({
      id: "sidecar:local",
    });
  });

  it("leaves other tasks alone", () => {
    expect(resolveModelRoute("schedules", routed({ schedules: "cheap" }, ["memory"]), connections)).toMatchObject({
      id: "cheap",
    });
    expect(resolveModelRoute("summaries", routed({}, ["memory"]), connections)).toBeNull();
  });

  it("checks picks that outrank the route", () => {
    const settings = routed({}, ["summaries"]);
    expect(() => assertLocalOnlyConnection("summaries", settings, "ollama", connections[5])).not.toThrow();
    expect(() => assertLocalOnlyConnection("summaries", settings, "sidecar:local", null)).not.toThrow();
    expect(routeError(() => assertLocalOnlyConnection("summaries", settings, "cheap", connections[1]))).toMatchObject({
      problem: "not_local",
    });
    expect(routeError(() => assertLocalOnlyConnection("summaries", settings, "gone", null))).toMatchObject({
      problem: "not_local",
    });
    expect(() => assertLocalOnlyConnection("judge", settings, "cheap", connections[1])).not.toThrow();
  });
});
