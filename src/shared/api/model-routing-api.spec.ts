import { beforeEach, describe, expect, it, vi } from "vitest";

import { modelRoutingApi } from "./model-routing-api";

let stored: unknown = undefined;

vi.mock("./app-settings-api", () => ({
  transformAppSettings: vi.fn(
    async (_id: string, _label: string, transform: (value: unknown, exists: boolean) => unknown) => {
      stored = transform(stored ?? null, stored !== undefined);
      return stored;
    },
  ),
}));

vi.mock("./storage-api", () => ({ storageApi: {} }));

describe("modelRoutingApi writes", () => {
  beforeEach(() => {
    stored = undefined;
  });

  it("keeps the local-only list when a route changes", async () => {
    stored = { version: 1, routes: { memory: "cheap" }, localOnly: ["status"] };
    await expect(modelRoutingApi.setRoute("status", "local")).resolves.toEqual({
      version: 1,
      routes: { memory: "cheap", status: "local" },
      localOnly: ["status"],
    });
    await expect(modelRoutingApi.setRoute("memory", null)).resolves.toEqual({
      version: 1,
      routes: { status: "local" },
      localOnly: ["status"],
    });
  });

  it("keeps routes when a task is marked or unmarked local-only", async () => {
    stored = { version: 1, routes: { responder: "cheap" } };
    await expect(modelRoutingApi.setLocalOnly("schedules", true)).resolves.toEqual({
      version: 1,
      routes: { responder: "cheap" },
      localOnly: ["schedules"],
    });
    await modelRoutingApi.setLocalOnly("memory", true);
    await expect(modelRoutingApi.setLocalOnly("schedules", false)).resolves.toEqual({
      version: 1,
      routes: { responder: "cheap" },
      localOnly: ["memory"],
    });
    await expect(modelRoutingApi.setLocalOnly("memory", false)).resolves.toEqual({
      version: 1,
      routes: { responder: "cheap" },
    });
  });

  it("starts from nothing routed on a fresh install", async () => {
    await expect(modelRoutingApi.setLocalOnly("judge", true)).resolves.toEqual({
      version: 1,
      routes: {},
      localOnly: ["judge"],
    });
  });
});
