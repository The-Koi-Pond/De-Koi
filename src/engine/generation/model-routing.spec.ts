import { describe, expect, it } from "vitest";

import type { StorageGateway } from "../capabilities/storage";
import {
  ModelRouteError,
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
];

function routed(routes: Record<string, string>) {
  return normalizeModelRoutingSettings({ version: 1, routes });
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

  it("rejects a stored route to a deleted connection", async () => {
    const { gateway } = storage({ version: 1, routes: { summaries: "gone" } });
    await expect(resolveStoredModelRoute(gateway, "summaries")).rejects.toMatchObject({
      name: "ModelRouteError",
      problem: "missing",
    });
  });
});
