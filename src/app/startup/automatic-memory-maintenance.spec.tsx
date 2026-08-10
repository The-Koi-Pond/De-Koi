// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import type { StorageGateway } from "../../engine/capabilities/storage";
import {
  resolveAutomaticMemoryMaintenanceConnectionId,
  seedAutomaticMemoryMaintenanceJobs,
} from "./automatic-memory-maintenance";

function sweepHarness(input: { chats?: Array<Record<string, unknown>>; canonical?: Array<Record<string, unknown>> }) {
  const collections = new Map<string, Map<string, Record<string, unknown>>>([
    ["chats", new Map((input.chats ?? []).map((row) => [String(row.id), row]))],
    ["canonical-memories", new Map((input.canonical ?? []).map((row) => [String(row.id), row]))],
    ["memory-maintenance-jobs", new Map()],
  ]);
  let maxListLimit = 0;
  const storage = {
    list: vi.fn(async (entity: string, options?: { limit?: number; before?: string; orderBy?: string }) => {
      maxListLimit = Math.max(maxListLimit, options?.limit ?? 0);
      let rows = [...(collections.get(entity)?.values() ?? [])].sort((left, right) => {
        const field = options?.orderBy ?? "id";
        const leftKey = `${left[field] ?? ""}|${left.id}`;
        const rightKey = `${right[field] ?? ""}|${right.id}`;
        return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
      });
      if (options?.before) {
        rows = rows.filter((row) => `${row[options.orderBy ?? "id"] ?? ""}|${row.id}` > String(options.before));
      }
      return rows.slice(0, options?.limit);
    }),
    get: vi.fn(async (entity: string, id: string) => collections.get(entity)?.get(id) ?? null),
    create: vi.fn(async (entity: string, row: Record<string, unknown>) => {
      collections.get(entity)?.set(String(row.id), row);
      return row;
    }),
    update: vi.fn(async (entity: string, id: string, patch: Record<string, unknown>) => {
      const row = { ...collections.get(entity)?.get(id), ...patch };
      collections.get(entity)?.set(id, row);
      return row;
    }),
  } as unknown as StorageGateway;
  return {
    storage,
    collections,
    get maxListLimit() {
      return maxListLimit;
    },
  };
}

describe("automatic memory maintenance startup discovery", () => {
  it("prefers the dedicated background connection over the chat connection", async () => {
    const connections = [
      { id: "chat-connection", provider: "nanogpt", model: "foreground", enabled: true },
      {
        id: "background-connection",
        provider: "openai",
        model: "background",
        enabled: true,
        defaultForAgents: true,
      },
    ];
    const storage = {
      get: vi.fn(async (entity: string) =>
        entity === "chats" ? { id: "chat-1", connectionId: "chat-connection" } : null,
      ),
    } as unknown as StorageGateway;

    await expect(
      resolveAutomaticMemoryMaintenanceConnectionId(
        storage,
        {
          store: "chat",
          scope: { kind: "chat", id: "chat-1" },
        },
        async () => connections,
      ),
    ).resolves.toBe("background-connection");
    expect(storage.get).toHaveBeenCalledWith("chats", "chat-1", { fields: ["connectionId"] });
  });

  it("discovers existing targets in bounded resumable pages", async () => {
    const chats = Array.from({ length: 125 }, (_, index) => ({
      id: `chat-${String(index).padStart(3, "0")}`,
      updatedAt: `2026-07-30T10:${String(index).padStart(3, "0")}:00.000Z`,
    }));
    const canonical = Array.from({ length: 205 }, (_, index) => ({
      id: `memory-${String(index).padStart(3, "0")}`,
      updatedAt: `2026-07-30T11:${String(index).padStart(3, "0")}:00.000Z`,
      scope: { kind: "character", id: `character-${index}` },
    }));
    const harness = sweepHarness({ chats, canonical });

    let outcome = await seedAutomaticMemoryMaintenanceJobs(harness.storage, { pageSize: 50 });
    expect(outcome.complete).toBe(false);
    expect(harness.maxListLimit).toBe(50);
    let passes = 1;
    while (!outcome.complete) {
      outcome = await seedAutomaticMemoryMaintenanceJobs(harness.storage, { pageSize: 50 });
      passes += 1;
      expect(passes).toBeLessThan(20);
    }

    const jobs = [...(harness.collections.get("memory-maintenance-jobs")?.values() ?? [])];
    const targetKeys = jobs.map((job) => job.targetKey);
    expect(targetKeys).toContain("chat:chat:chat-124");
    expect(targetKeys).toContain("canonical:character:character-204");
  });

  it("coalesces repeated canonical rows from the same scope", async () => {
    const harness = sweepHarness({
      canonical: [
        {
          id: "memory-1",
          updatedAt: "2026-07-30T10:00:00.000Z",
          scope: { kind: "character", id: "char-1" },
        },
        {
          id: "memory-2",
          updatedAt: "2026-07-30T10:01:00.000Z",
          scope: { kind: "character", id: "char-1" },
        },
      ],
    });

    await seedAutomaticMemoryMaintenanceJobs(harness.storage, { pageSize: 50 });

    const keys = [...(harness.collections.get("memory-maintenance-jobs")?.values() ?? [])].map((job) => job.targetKey);
    expect(keys.filter((key) => key === "canonical:character:char-1")).toHaveLength(1);
  });

  it("pages every row once when timestamps collide or are missing", async () => {
    const harness = sweepHarness({
      chats: [
        { id: "chat-a", updatedAt: "2026-07-30T10:00:00.000Z" },
        { id: "chat-b", updatedAt: "2026-07-30T10:00:00.000Z" },
        { id: "chat-c" },
        { id: "chat-d" },
      ],
      canonical: [
        {
          id: "memory-a",
          updatedAt: "2026-07-30T11:00:00.000Z",
          scope: { kind: "character", id: "char-a" },
        },
        {
          id: "memory-b",
          updatedAt: "2026-07-30T11:00:00.000Z",
          scope: { kind: "character", id: "char-b" },
        },
        { id: "memory-c", scope: { kind: "character", id: "char-c" } },
        { id: "memory-d", scope: { kind: "character", id: "char-d" } },
      ],
    });

    let outcome = await seedAutomaticMemoryMaintenanceJobs(harness.storage, { pageSize: 1 });
    while (!outcome.complete) {
      outcome = await seedAutomaticMemoryMaintenanceJobs(harness.storage, { pageSize: 1 });
    }

    const keys = [...(harness.collections.get("memory-maintenance-jobs")?.values() ?? [])]
      .filter((job) => job.recordType !== "sweep")
      .map((job) => String(job.targetKey))
      .sort();
    expect(keys).toEqual([
      "canonical:character:char-a",
      "canonical:character:char-b",
      "canonical:character:char-c",
      "canonical:character:char-d",
      "chat:chat:chat-a",
      "chat:chat:chat-b",
      "chat:chat:chat-c",
      "chat:chat:chat-d",
    ]);
  });
});
