import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StorageGateway } from "../capabilities/storage";
import type { MemoryMaintenanceGateway } from "../capabilities/memory-maintenance";
import type {
  MemoryCleanupProposal,
  MemoryCleanupSource,
  MemoryCleanupTarget,
} from "../contracts/types/memory-maintenance";
import { beginForegroundGeneration } from "./background-generation-coordinator";

const analyzeMemoryCleanup = vi.hoisted(() => vi.fn());
const analyzeAutomaticMemoryClarity = vi.hoisted(() => vi.fn());
vi.mock("./memory-cleanup", () => ({ analyzeMemoryCleanup }));
vi.mock("./memory-clarity", () => ({ analyzeAutomaticMemoryClarity }));

import {
  enqueueAutomaticMemoryMaintenanceTarget,
  loadAutomaticMemoryMaintenanceSources,
  processAutomaticMemoryMaintenanceQueue,
} from "./automatic-memory-maintenance-queue";

const target: MemoryCleanupTarget = { store: "chat", scope: { kind: "chat", id: "chat-1" } };

function source(
  id: string,
  content = `Memory ${id}`,
): MemoryCleanupSource & { chatId: string; scopeType: "chat"; scopeId: string } {
  return {
    id,
    chatId: "chat-1",
    scopeType: "chat",
    scopeId: "chat-1",
    scope: target.scope,
    content,
    kind: "manual",
    status: "active",
    origin: "manual",
    confidence: null,
    messageIds: [],
    sourceChatIds: [],
    createdAt: "2026-07-30T10:00:00.000Z",
    updatedAt: "2026-07-30T10:00:00.000Z",
    pinned: false,
    userEdited: true,
    automaticLineage: false,
  };
}

function proposal(id: string, type: MemoryCleanupProposal["type"], sourceIds = ["one"]): MemoryCleanupProposal {
  return {
    id,
    type,
    sourceIds,
    expected: Object.fromEntries(
      sourceIds.map((sourceId) => [
        sourceId,
        {
          content: `Memory ${sourceId}`,
          status: "active",
          updatedAt: "2026-07-30T10:00:00.000Z",
          pinned: false,
          userEdited: true,
        },
      ]),
    ),
    ...(type === "combine" ? { replacement: { content: "Combined", kind: "manual" } } : {}),
    reason:
      type === "discard"
        ? "Low-value memory"
        : type === "conflict"
          ? "Possible conflict"
          : type === "keep_one"
            ? "Repeated fact"
            : "Overlapping memories",
    selected: false,
    estimatedTokensBefore: 4,
    estimatedTokensAfter: type === "discard" ? 0 : 2,
  };
}

function preview(proposals: MemoryCleanupProposal[]) {
  return {
    version: 1 as const,
    scope: target.scope,
    proposals,
    beforeCount: 2,
    afterCount: 1,
    estimatedTokensBefore: 4,
    estimatedTokensAfter: 2,
    deferredCandidateCount: 0,
  };
}

function harness(
  options: {
    sources?: MemoryCleanupSource[][];
    canonicalSources?: Array<Record<string, unknown>>[];
    target?: MemoryCleanupTarget;
    totalPasses?: number;
    applyError?: unknown;
  } = {},
) {
  const jobTarget = options.target ?? target;
  const jobs = new Map<string, Record<string, unknown>>([
    [
      "job-1",
      {
        id: "job-1",
        target: jobTarget,
        targetKey: `${jobTarget.store}:${jobTarget.scope.kind}:${jobTarget.scope.id}`,
        status: "pending",
        attempts: 0,
        maxAttempts: 3,
        totalPasses: options.totalPasses ?? 0,
        recentFingerprints: [],
        nextAttemptAt: "2026-07-30T10:00:00.000Z",
        createdAt: "2026-07-30T10:00:00.000Z",
        updatedAt: "2026-07-30T10:00:00.000Z",
      },
    ],
  ]);
  const sourcePages = options.sources ?? [[source("one"), source("two")], []];
  let sourceIndex = 0;
  const canonicalSourcePages = options.canonicalSources ?? [];
  let canonicalSourceIndex = 0;
  const storage = {
    list: vi.fn(async (entity: string) => (entity === "memory-maintenance-jobs" ? [...jobs.values()] : [])),
    get: vi.fn(async (_entity: string, id: string) => jobs.get(id) ?? null),
    update: vi.fn(async (_entity: string, id: string, patch: Record<string, unknown>) => {
      const updated = { ...jobs.get(id), ...patch };
      jobs.set(id, updated);
      return updated;
    }),
    create: vi.fn(async (_entity: string, value: Record<string, unknown>) => {
      jobs.set(String(value.id), value);
      return value;
    }),
    listChatMemories: vi.fn(async () => sourcePages[Math.min(sourceIndex++, sourcePages.length - 1)]),
    queryMemories: vi.fn(
      async () => canonicalSourcePages[Math.min(canonicalSourceIndex++, canonicalSourcePages.length - 1)] ?? [],
    ),
  } as unknown as StorageGateway;
  const maintenance = {
    apply: options.applyError
      ? vi.fn(async () => {
          throw options.applyError;
        })
      : vi.fn(async () => ({
          batchId: "batch-1",
          combined: 1,
          clarified: 0,
          discarded: 1,
          superseded: 2,
          created: 1,
        })),
    undo: vi.fn(),
  } as unknown as MemoryMaintenanceGateway;
  return {
    jobs,
    storage,
    maintenance,
    dependencies: {
      storage,
      maintenance,
      llm: { generate: vi.fn() } as never,
      resolveConnectionId: vi.fn(async () => "connection-1"),
    },
  };
}

describe("automatic memory maintenance queue", () => {
  beforeEach(() => {
    analyzeMemoryCleanup.mockReset();
    analyzeAutomaticMemoryClarity.mockReset();
    analyzeAutomaticMemoryClarity.mockResolvedValue({ proposals: [], reviewedFingerprints: [] });
  });

  it("automatically applies every actionable proposal but never a conflict", async () => {
    const test = harness();
    analyzeMemoryCleanup.mockResolvedValue(
      preview([
        proposal("discard", "discard"),
        proposal("keep", "keep_one", ["two"]),
        proposal("combine", "combine", ["one", "two"]),
        proposal("conflict", "conflict", ["one", "two"]),
      ]),
    );

    const result = await processAutomaticMemoryMaintenanceQueue(test.dependencies, {
      now: "2026-07-30T10:01:00.000Z",
    });

    expect(result.applied).toBe(1);
    const request = vi.mocked(test.maintenance.apply).mock.calls[0]?.[0];
    expect(request?.version).toBe(2);
    expect(request?.proposals.map((entry) => [entry.id, entry.selected])).toEqual([
      ["discard", true],
      ["keep", true],
      ["combine", true],
    ]);
  });

  it("analyzes manual pinned edited imported corrected and command sources", async () => {
    const origins: MemoryCleanupSource["origin"][] = [
      "manual",
      "manual",
      "automatic",
      "imported",
      "correction",
      "command",
    ];
    const sources = origins.map((origin, index) => ({
      ...source(String(index)),
      memoryKind:
        origin === "imported" || origin === "correction" || origin === "command"
          ? origin
          : origin === "manual"
            ? "manual"
            : "transcript",
      source:
        origin === "command"
          ? "connected_command"
          : origin === "correction"
            ? "correction"
            : origin === "manual"
              ? "manual"
              : "automatic",
      messageIds: origin === "automatic" ? ["message-1"] : [],
      pinned: index === 1,
      status: index === 1 ? ("pinned" as const) : ("active" as const),
      userEdited: index === 2,
    }));
    const test = harness({ sources: [sources] });
    analyzeMemoryCleanup.mockResolvedValue(preview([]));

    await processAutomaticMemoryMaintenanceQueue(test.dependencies);

    const analyzed = analyzeMemoryCleanup.mock.calls[0]?.[0].sources as MemoryCleanupSource[];
    expect(analyzed.map((entry) => entry.id)).toEqual(sources.map((entry) => entry.id));
    expect(analyzed.map((entry) => entry.origin)).toEqual(origins);
    expect(analyzed[1]).toMatchObject({ pinned: true, status: "pinned" });
    expect(analyzed[2]).toMatchObject({ userEdited: true });
    expect(test.jobs.get("job-1")?.status).toBe("completed");
  });

  it("retries stale target-aware apply without changing through a fallback", async () => {
    const error = Object.assign(new Error("Some memories changed after this cleanup preview was created"), {
      code: "invalid_input",
    });
    const test = harness({ applyError: error });
    analyzeMemoryCleanup.mockResolvedValue(preview([proposal("discard", "discard")]));

    const result = await processAutomaticMemoryMaintenanceQueue(test.dependencies);

    expect(result.retryable).toBe(1);
    expect(test.maintenance.apply).toHaveBeenCalledOnce();
    expect(test.jobs.get("job-1")).toMatchObject({ status: "retryable", lastErrorCode: "stale_state" });
  });

  it("fails a repeated source fingerprint instead of looping", async () => {
    const repeated = [source("one"), source("two")];
    const test = harness({ sources: [repeated, repeated] });
    analyzeMemoryCleanup.mockResolvedValue(preview([proposal("combine", "combine", ["one", "two"])]));

    await processAutomaticMemoryMaintenanceQueue(test.dependencies);

    expect(test.maintenance.apply).toHaveBeenCalledOnce();
    expect(test.jobs.get("job-1")).toMatchObject({
      status: "failed",
      lastErrorCode: "maintenance_oscillation",
    });
  });

  it("does not start unattended work while foreground generation is active", async () => {
    const test = harness();
    beginForegroundGeneration(test.storage);
    analyzeMemoryCleanup.mockResolvedValue(preview([]));

    const result = await processAutomaticMemoryMaintenanceQueue(test.dependencies);
    expect(result.processed).toBe(0);
    expect(analyzeMemoryCleanup).not.toHaveBeenCalled();
  });

  it("retries malformed analysis without applying anything", async () => {
    const test = harness();
    analyzeMemoryCleanup.mockResolvedValue({});

    const result = await processAutomaticMemoryMaintenanceQueue(test.dependencies);

    expect(result.retryable).toBe(1);
    expect(test.maintenance.apply).not.toHaveBeenCalled();
    expect(test.jobs.get("job-1")?.status).toBe("retryable");
  });

  it("does not undo user suppression during startup discovery", async () => {
    const test = harness();
    test.jobs.clear();
    test.jobs.set("memory-maintenance-a12701b1", {
      id: "memory-maintenance-a12701b1",
      target,
      targetKey: "chat:chat:chat-1",
      status: "suppressed",
      trigger: "undo",
    });

    const job = await enqueueAutomaticMemoryMaintenanceTarget(test.storage, target);

    expect(job.status).toBe("suppressed");
    expect(test.storage.update).not.toHaveBeenCalled();
  });

  it("keeps chat and scene sources separate while discovering the scene target", async () => {
    const chatSource = source("chat-memory");
    const sceneSource = {
      ...source("scene-memory"),
      scope: { kind: "scene" as const, id: "scene-1" },
      scopeType: "scene" as const,
      scopeId: "scene-1",
    };
    const test = harness({ sources: [[chatSource, sceneSource]] });

    const loaded = await loadAutomaticMemoryMaintenanceSources(test.storage, target);

    expect(loaded.map((entry) => entry.id)).toEqual(["chat-memory"]);
    expect([...test.jobs.values()].map((job) => job.targetKey)).toContain("chat:scene:chat-1");
  });

  it("loads and applies canonical targets without mixing in chat storage", async () => {
    const canonicalTarget: MemoryCleanupTarget = {
      store: "canonical",
      scope: { kind: "character", id: "char-1" },
    };
    const canonicalRow = {
      id: "canonical-1",
      kind: "fact",
      status: "active",
      scope: canonicalTarget.scope,
      content: "Mira owns a brass key.",
      confidence: 0.9,
      provenance: { messageIds: ["message-1"], characterId: "char-1" },
      tags: ["automatic"],
      payload: { automatic: true },
      createdAt: "2026-07-30T10:00:00.000Z",
      updatedAt: "2026-07-30T10:00:00.000Z",
    };
    const test = harness({
      target: canonicalTarget,
      canonicalSources: [[canonicalRow], []],
    });
    analyzeMemoryCleanup.mockResolvedValue(
      preview([
        {
          ...proposal("discard-canonical", "discard", ["canonical-1"]),
          expected: {
            "canonical-1": {
              content: canonicalRow.content,
              status: "active",
              updatedAt: canonicalRow.updatedAt,
              pinned: false,
              userEdited: false,
            },
          },
        },
      ]),
    );

    await processAutomaticMemoryMaintenanceQueue(test.dependencies);

    expect(test.storage.queryMemories).toHaveBeenCalled();
    expect(test.storage.listChatMemories).not.toHaveBeenCalled();
    expect(test.maintenance.apply).toHaveBeenCalledWith(
      expect.objectContaining({ version: 2, target: canonicalTarget }),
    );
  });

  it("applies canonical clarity before ordinary cleanup and never consolidates the clarified source in that pass", async () => {
    const canonicalTarget: MemoryCleanupTarget = {
      store: "canonical",
      scope: { kind: "character", id: "char-1" },
    };
    const vague = {
      id: "vague",
      kind: "fact",
      status: "active",
      scope: canonicalTarget.scope,
      content: "He does not want to talk about it.",
      confidence: 0.9,
      provenance: { sourceChatId: "chat-1", messageIds: ["message-1"], characterId: "char-1" },
      tags: ["automatic"],
      payload: { automatic: true },
      createdAt: "2026-07-30T10:00:00.000Z",
      updatedAt: "2026-07-30T10:00:00.000Z",
    };
    const clear = { ...vague, id: "clear", content: "Pierrot keeps the brass key." };
    const test = harness({
      target: canonicalTarget,
      canonicalSources: [[vague, clear], [clear]],
    });
    const clarify = {
      ...proposal("clarify-vague", "combine", ["vague"]),
      type: "clarify" as const,
      expected: {
        vague: {
          content: vague.content,
          status: "active" as const,
          updatedAt: vague.updatedAt,
          pinned: false,
          userEdited: false,
        },
      },
      replacement: { content: "Pierrot avoids discussing the circus accident.", kind: "fact" },
      reason: "Context clarification" as const,
      selected: true,
    };
    analyzeAutomaticMemoryClarity
      .mockResolvedValueOnce({ proposals: [clarify], reviewedFingerprints: ["clarity-vague"] })
      .mockResolvedValue({ proposals: [], reviewedFingerprints: [] });
    analyzeMemoryCleanup.mockResolvedValue(preview([]));

    await processAutomaticMemoryMaintenanceQueue(test.dependencies);

    expect(test.maintenance.apply).toHaveBeenCalledTimes(1);
    expect(vi.mocked(test.maintenance.apply).mock.calls[0]?.[0].proposals).toEqual([clarify]);
    expect(analyzeMemoryCleanup).toHaveBeenCalledTimes(1);
    expect(analyzeMemoryCleanup.mock.calls[0]?.[0].sources.map((entry: MemoryCleanupSource) => entry.id)).toEqual([
      "clear",
    ]);
  });

  it("keeps bounded clarity fingerprints through completion and unchanged re-enqueue", async () => {
    const canonicalTarget: MemoryCleanupTarget = {
      store: "canonical",
      scope: { kind: "character", id: "char-1" },
    };
    const canonicalRow = {
      id: "vague",
      kind: "fact",
      status: "active",
      scope: canonicalTarget.scope,
      content: "He does not want to talk about it.",
      confidence: 0.9,
      provenance: { sourceChatId: "chat-1", messageIds: ["message-1"], characterId: "char-1" },
      tags: ["automatic"],
      payload: { automatic: true },
      createdAt: "2026-07-30T10:00:00.000Z",
      updatedAt: "2026-07-30T10:00:00.000Z",
    };
    const test = harness({ target: canonicalTarget, canonicalSources: [[canonicalRow]] });
    const returned = Array.from({ length: 520 }, (_, index) => `clarity-${index}`);
    analyzeAutomaticMemoryClarity.mockResolvedValue({ proposals: [], reviewedFingerprints: returned });
    analyzeMemoryCleanup.mockResolvedValue(preview([]));

    await processAutomaticMemoryMaintenanceQueue(test.dependencies);
    const completed = test.jobs.get("job-1");
    expect(completed?.status).toBe("completed");
    expect(completed?.clarityReviewedFingerprints).toEqual(returned.slice(-512));

    test.jobs.clear();
    const seeded = await enqueueAutomaticMemoryMaintenanceTarget(test.storage, canonicalTarget);
    test.jobs.set(String(seeded.id), {
      ...seeded,
      status: "completed",
      clarityReviewedFingerprints: returned.slice(-512),
    });
    await enqueueAutomaticMemoryMaintenanceTarget(test.storage, canonicalTarget);
    expect(test.jobs.get(String(seeded.id))?.clarityReviewedFingerprints).toEqual(returned.slice(-512));
  });

  it("passes existing clarity fingerprints back to analysis and retries provider failures", async () => {
    const canonicalTarget: MemoryCleanupTarget = {
      store: "canonical",
      scope: { kind: "character", id: "char-1" },
    };
    const canonicalRow = {
      id: "vague",
      kind: "fact",
      status: "active",
      scope: canonicalTarget.scope,
      content: "He does not want to talk about it.",
      confidence: 0.9,
      provenance: { sourceChatId: "chat-1", messageIds: ["message-1"], characterId: "char-1" },
      tags: ["automatic"],
      payload: { automatic: true },
      createdAt: "2026-07-30T10:00:00.000Z",
      updatedAt: "2026-07-30T10:00:00.000Z",
    };
    const test = harness({ target: canonicalTarget, canonicalSources: [[canonicalRow]] });
    test.jobs.get("job-1")!.clarityReviewedFingerprints = ["existing"];
    analyzeAutomaticMemoryClarity.mockRejectedValue(new Error("clarity provider unavailable"));

    const result = await processAutomaticMemoryMaintenanceQueue(test.dependencies);

    expect(analyzeAutomaticMemoryClarity.mock.calls[0]?.[0].alreadyReviewed).toEqual(new Set(["existing"]));
    expect(result.retryable).toBe(1);
    expect(test.maintenance.apply).not.toHaveBeenCalled();
    expect(test.jobs.get("job-1")?.status).toBe("retryable");
  });
});
