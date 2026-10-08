import { describe, expect, it, vi } from "vitest";

import type { StorageGateway } from "../capabilities/storage";
import type { AgentResult } from "../contracts/types/agent";
import {
  applyLorebookKeeperUpdate,
  lorebookKeeperProposalEntryId,
  settleLorebookKeeperResults,
  type LorebookKeeperUpdate,
} from "./lorebook-keeper-updates";

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

/** Lorebook entries with the runtime's create rule: a record whose id already exists is refused. */
function uniqueIdEntries() {
  const entries = new Map<string, Record<string, unknown>>();
  let reads = 0;
  const storage = {
    get: vi.fn(async (_entity: string, id: string) => {
      reads += 1;
      // Both approvals look before either writes, as two tabs clicking at once would.
      await new Promise((resolve) => setTimeout(resolve, 0));
      return entries.get(id) ?? null;
    }),
    list: vi.fn(async () => [...entries.values()]),
    create: vi.fn(async (_entity: string, value: Record<string, unknown>) => {
      const id = String(value.id ?? `entry-${entries.size + 1}`);
      if (entries.has(id)) throw new Error(`lorebook-entries/${id} already exists`);
      entries.set(id, { ...value, id });
      return entries.get(id);
    }),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({ deleted: true })),
  };
  return { storage: storage as unknown as StorageGateway, entries, reads: () => reads };
}

const proposal: LorebookKeeperUpdate = {
  lorebookId: "book-1",
  lorebookName: "Pond lore",
  action: "create",
  entryId: null,
  entryName: "Archivist koi",
  content: "Two hundred years old.",
  newFacts: [],
  keys: ["Archivist"],
  tag: "",
  reason: "",
};

describe("applyLorebookKeeperUpdate for a stored proposal", () => {
  const proposalEntryId = lorebookKeeperProposalEntryId("run-1", 0);

  it("creates the entry once when two approvals of the same proposal race", async () => {
    const { storage, entries } = uniqueIdEntries();

    const results = await Promise.all([
      applyLorebookKeeperUpdate(storage, proposal, undefined, { proposalEntryId }),
      applyLorebookKeeperUpdate(storage, proposal, undefined, { proposalEntryId }),
    ]);

    expect([...entries.keys()]).toEqual([proposalEntryId]);
    expect(results).toEqual([
      { applied: true, lorebookId: "book-1", entryId: proposalEntryId },
      { applied: true, lorebookId: "book-1", entryId: proposalEntryId },
    ]);
  });

  it("does not create it again when the proposal is approved again after its decision failed to save", async () => {
    const { storage, entries } = uniqueIdEntries();

    await applyLorebookKeeperUpdate(storage, proposal, undefined, { proposalEntryId });
    await applyLorebookKeeperUpdate(storage, proposal, undefined, { proposalEntryId });

    expect(entries.size).toBe(1);
    expect(storage.create).toHaveBeenCalledTimes(1);
  });

  it("still surfaces a create that failed for another reason", async () => {
    const { storage } = uniqueIdEntries();
    vi.mocked(storage.create).mockRejectedValueOnce(new Error("disk full"));

    await expect(applyLorebookKeeperUpdate(storage, proposal, undefined, { proposalEntryId })).rejects.toThrow(
      "disk full",
    );
  });
});

describe("settleLorebookKeeperResults when the lorebooks can't be read", () => {
  it("fails instead of marking the proposals skipped for good", async () => {
    const storage = {
      list: vi.fn(async () => {
        throw new Error("runtime unreachable");
      }),
    } as unknown as StorageGateway;

    await expect(
      settleLorebookKeeperResults({ storage }, reviewOff, [
        keeperResult([{ action: "create", entryName: "Archivist koi" }]),
      ]),
    ).rejects.toThrow("runtime unreachable");
  });
});
