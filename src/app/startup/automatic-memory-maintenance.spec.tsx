// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import type { StorageGateway } from "../../engine/capabilities/storage";
import { seedAutomaticMemoryMaintenanceJobs } from "./automatic-memory-maintenance";

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
        return `${left[field] ?? ""}|${left.id}`.localeCompare(`${right[field] ?? ""}|${right.id}`);
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
});
