import { describe, expect, it, vi } from "vitest";

import type { StorageGateway } from "../capabilities/storage";
import type { AgentResult } from "../contracts/types/agent";
import { settleLorebookKeeperResults } from "./lorebook-keeper-updates";

function keeperResult(updates: Array<Record<string, unknown>>): AgentResult {
  return {
    agentId: "lorebook-keeper",
    agentType: "lorebook-keeper",
    type: "lorebook_update",
    data: { updates },
    success: true,
    error: null,
    tokensUsed: 0,
    durationMs: 1,
  } as AgentResult;
}

function lorebookStorage(entries: Array<Record<string, unknown>> = []) {
  const writes: string[] = [];
  const storage = {
    list: vi.fn(async (entity: string) => {
      if (entity === "lorebooks") return [{ id: "book-1", name: "Pond lore", enabled: true }];
      if (entity === "lorebook-entries") return entries;
      return [];
    }),
    get: vi.fn(async () => null),
    create: vi.fn(async (_entity: string, value: Record<string, unknown>) => {
      writes.push(`create ${String(value.name)}`);
      return { id: `entry-${writes.length}`, ...value };
    }),
    update: vi.fn(async (_entity: string, id: string) => {
      writes.push(`update ${id}`);
      return {};
    }),
    delete: vi.fn(async (_entity: string, id: string) => {
      writes.push(`delete ${id}`);
      return { deleted: true };
    }),
  };
  return { storage: storage as unknown as StorageGateway, writes };
}

const reviewOff = {
  id: "chat-1",
  characterIds: [],
  metadata: { lorebookKeeperReviewRequired: false, lorebookKeeperTargetLorebookId: "book-1" },
};

describe("settleLorebookKeeperResults", () => {
  it("applies the other proposals when one targets a locked entry, and records why that one failed", async () => {
    const { storage, writes } = lorebookStorage([
      { id: "locked-1", lorebookId: "book-1", name: "Mirelle", locked: true, content: "", keys: [] },
    ]);

    const { results, settlement } = await settleLorebookKeeperResults({ storage }, reviewOff, [
      keeperResult([
        { action: "update", entryName: "Mirelle", newFacts: ["Mirelle keeps the ledger."] },
        { action: "create", entryName: "Archivist koi", content: "Two hundred years old." },
      ]),
    ]);

    expect(writes).toEqual(["create Archivist koi"]);
    expect((results[0]!.data as { updates: unknown[] }).updates).toEqual([
      expect.objectContaining({
        entryName: "Mirelle",
        reviewStatus: "failed",
        reviewError: expect.stringContaining("locked"),
      }),
      expect.objectContaining({ entryName: "Archivist koi", reviewStatus: "applied", appliedEntryId: "entry-1" }),
    ]);
    expect(settlement).toEqual({ chatId: "chat-1", applied: 1, pending: 0, lorebookIds: ["book-1"] });
  });

  it("skips proposals with no lorebook to go to and leaves already-decided ones alone", async () => {
    const { storage, writes } = lorebookStorage();
    const chat = { id: "chat-1", characterIds: [], metadata: { lorebookKeeperReviewRequired: false } };
    const noLorebooks = {
      ...storage,
      list: vi.fn(async () => []),
    } as unknown as StorageGateway;

    const { results, settlement } = await settleLorebookKeeperResults({ storage: noLorebooks }, chat, [
      keeperResult([
        { action: "create", entryName: "Archivist koi", content: "Two hundred years old." },
        { action: "create", entryName: "Lantern", reviewStatus: "rejected" },
      ]),
    ]);

    expect(writes).toEqual([]);
    expect((results[0]!.data as { updates: unknown[] }).updates).toEqual([
      expect.objectContaining({ entryName: "Archivist koi", reviewStatus: "skipped" }),
      expect.objectContaining({ entryName: "Lantern", reviewStatus: "rejected" }),
    ]);
    expect(settlement).toBeNull();
  });

  it("leaves failed and non-Keeper results untouched", async () => {
    const { storage } = lorebookStorage();
    const failed = { ...keeperResult([{ action: "create", entryName: "Archivist koi" }]), success: false };
    const other = { ...keeperResult([]), agentType: "world-state", type: "game_state_update" } as AgentResult;

    const { results, settlement } = await settleLorebookKeeperResults({ storage }, reviewOff, [failed, other]);

    expect(results).toEqual([failed, other]);
    expect(settlement).toBeNull();
    expect(storage.list).not.toHaveBeenCalled();
  });
});
