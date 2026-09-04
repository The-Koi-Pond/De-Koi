import { describe, expect, it, vi } from "vitest";

import type { LlmGateway } from "../../engine/capabilities/llm";
import type { StorageGateway } from "../../engine/capabilities/storage";
import type { RoleplayContinuityDirectorState } from "../../engine/contracts/types/roleplay-continuity-director";
import { createDefaultContinuityDirectorState } from "../../engine/modes/roleplay/continuity-director/continuity-director-state";
import { ContinuityDirectorApiError, createRoleplayContinuityDirectorApi } from "./roleplay-continuity-director-api";

const NOW = "2026-09-02T12:00:00.000Z";

function state(overrides: Partial<RoleplayContinuityDirectorState> = {}): RoleplayContinuityDirectorState {
  return { ...createDefaultContinuityDirectorState(NOW), enabled: true, ...overrides };
}

function harness(initial = state()) {
  let current = initial;
  let beforeWrite: (() => void | Promise<void>) | null = null;
  const runBeforeWrite = async () => {
    const callback = beforeWrite;
    beforeWrite = null;
    await callback?.();
  };
  const patchChatMetadata = vi.fn(async (_chatId: string, patch: Record<string, unknown>) => {
    await runBeforeWrite();
    current = patch.roleplayContinuityDirector as RoleplayContinuityDirectorState;
    return { id: "chat-1", metadata: { roleplayContinuityDirector: current } };
  });
  const updateChatIfUnchanged = vi.fn(
    async (_chatId: string, expected: Record<string, unknown>, patch: Record<string, unknown>) => {
      await runBeforeWrite();
      const expectedDirector = (expected.metadata as Record<string, unknown>).roleplayContinuityDirector ?? null;
      if (JSON.stringify(expectedDirector) !== JSON.stringify(current)) {
        return {
          updated: false,
          chat: { id: "chat-1", metadata: { roleplayContinuityDirector: current } },
        };
      }
      current = (patch.metadata as Record<string, unknown>)
        .roleplayContinuityDirector as RoleplayContinuityDirectorState;
      return {
        updated: true,
        chat: { id: "chat-1", metadata: { roleplayContinuityDirector: current } },
      };
    },
  );
  const storage = {
    get: vi.fn(async (entity: string) =>
      entity === "chats"
        ? { id: "chat-1", mode: "roleplay", characterIds: [], metadata: { roleplayContinuityDirector: current } }
        : null,
    ),
    patchChatMetadata,
    updateChatIfUnchanged,
  } as unknown as StorageGateway;
  return {
    storage,
    patchChatMetadata,
    updateChatIfUnchanged,
    current: () => current,
    setCurrent(next: RoleplayContinuityDirectorState) {
      current = next;
    },
    beforeNextWrite(callback: () => void | Promise<void>) {
      beforeWrite = callback;
    },
  };
}

describe("roleplay continuity director api", () => {
  it("loads normalized state and derives staleness from the current source fingerprint", async () => {
    const test = harness(
      state({
        sourceSnapshot: {
          storyProjectionIds: [],
          knowledgeEdgeIds: [],
          lastMessageId: null,
          fingerprint: "old",
          generatedAt: NOW,
        },
      }),
    );
    const api = createRoleplayContinuityDirectorApi(
      { storage: test.storage, llm: {} as LlmGateway },
      {
        now: () => NOW,
        loadSource: vi.fn(async () => ({ sourceSnapshot: { fingerprint: "new" } }) as never),
      },
    );

    await expect(api.getState("chat-1")).resolves.toMatchObject({ state: { enabled: true }, isStale: true });
  });

  it("applies a command through an exact raw-state conditional update", async () => {
    const test = harness();
    const api = createRoleplayContinuityDirectorApi(
      { storage: test.storage, llm: {} as LlmGateway },
      { now: () => NOW },
    );

    const result = await api.command("chat-1", { type: "set_enabled", enabled: false }, 0);

    expect(result.state.enabled).toBe(false);
    expect(test.updateChatIfUnchanged).toHaveBeenCalledWith("chat-1", {
      metadata: { roleplayContinuityDirector: expect.objectContaining({ enabled: true, revision: 0 }) },
    }, {
      metadata: {
        roleplayContinuityDirector: expect.objectContaining({ enabled: false, revision: 1 }),
      },
    });
    expect(test.patchChatMetadata).not.toHaveBeenCalled();
  });

  it("returns the committed command state when its follow-up source probe fails", async () => {
    const test = harness(
      state({
        sourceSnapshot: {
          storyProjectionIds: [],
          knowledgeEdgeIds: [],
          lastMessageId: null,
          fingerprint: "saved-source",
          generatedAt: NOW,
        },
      }),
    );
    const loadSource = vi.fn(async () => {
      throw new Error("source probe failed");
    });
    const api = createRoleplayContinuityDirectorApi(
      { storage: test.storage, llm: {} as LlmGateway },
      { now: () => NOW, createId: (prefix) => `${prefix}-saved`, loadSource },
    );

    const command = api.command("chat-1", { type: "edit_arc", text: "Committed arc" }, 0);

    await expect(command).resolves.toMatchObject({
      state: { currentArc: { text: "Committed arc" }, revision: 1 },
      isStale: false,
      sourceUnavailable: true,
    });
    expect(test.current()).toMatchObject({ currentArc: { text: "Committed arc" }, revision: 1 });
    expect(loadSource).toHaveBeenCalledTimes(1);
  });

  it("uses literal null as the CAS expectation when legacy chat metadata has no Director state", async () => {
    const updateChatIfUnchanged = vi.fn(
      async (_chatId: string, _expected: Record<string, unknown>, patch: Record<string, unknown>) => ({
        updated: true,
        chat: { id: "chat-1", metadata: patch.metadata },
      }),
    );
    const storage = {
      get: vi.fn(async () => ({ id: "chat-1", mode: "roleplay", metadata: {} })),
      updateChatIfUnchanged,
    } as unknown as StorageGateway;
    const api = createRoleplayContinuityDirectorApi(
      { storage, llm: {} as LlmGateway },
      { now: () => NOW },
    );

    await api.command("chat-1", { type: "set_enabled", enabled: true }, 0);

    expect(updateChatIfUnchanged).toHaveBeenCalledWith(
      "chat-1",
      { metadata: { roleplayContinuityDirector: null } },
      {
        metadata: {
          roleplayContinuityDirector: expect.objectContaining({ enabled: true, revision: 1 }),
        },
      },
    );
  });

  it("maps command persistence failures to the typed API error", async () => {
    const test = harness();
    test.updateChatIfUnchanged.mockRejectedValueOnce(new Error("disk full"));
    const api = createRoleplayContinuityDirectorApi(
      { storage: test.storage, llm: {} as LlmGateway },
      { now: () => NOW },
    );

    await expect(api.command("chat-1", { type: "set_enabled", enabled: false }, 0)).rejects.toEqual(
      new ContinuityDirectorApiError("persistence_failed", "disk full"),
    );
    expect(test.updateChatIfUnchanged).toHaveBeenCalledTimes(1);
  });

  it("rejects a stale revision before patching", async () => {
    const test = harness(state({ revision: 4 }));
    const api = createRoleplayContinuityDirectorApi(
      { storage: test.storage, llm: {} as LlmGateway },
      { now: () => NOW },
    );

    await expect(api.command("chat-1", { type: "set_enabled", enabled: false }, 3)).rejects.toMatchObject({
      code: "stale_revision",
    });
    expect(test.patchChatMetadata).not.toHaveBeenCalled();
    expect(test.updateChatIfUnchanged).not.toHaveBeenCalled();
  });

  it("lets the winning command survive when two commands race from the same revision", async () => {
    const test = harness();
    const api = createRoleplayContinuityDirectorApi(
      { storage: test.storage, llm: {} as LlmGateway },
      { now: () => NOW },
    );
    let releaseFirst!: () => void;
    let markFirstEntered!: () => void;
    const firstEntered = new Promise<void>((resolve) => {
      markFirstEntered = resolve;
    });
    const holdFirst = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    test.beforeNextWrite(async () => {
      markFirstEntered();
      await holdFirst;
    });

    const stale = api.command("chat-1", { type: "set_enabled", enabled: false }, 0);
    await firstEntered;
    const winner = await api.command("chat-1", { type: "set_connection", connectionId: "winner" }, 0);
    releaseFirst();

    await expect(stale).rejects.toMatchObject({ code: "stale_revision" });
    expect(winner.state).toMatchObject({ enabled: true, connectionId: "winner", revision: 1 });
    expect(test.current()).toMatchObject({ enabled: true, connectionId: "winner", revision: 1 });
  });

  it("cannot resurrect Director state when workflow revert wins before command persistence", async () => {
    const test = harness();
    const api = createRoleplayContinuityDirectorApi(
      { storage: test.storage, llm: {} as LlmGateway },
      { now: () => NOW },
    );
    let releaseCommand!: () => void;
    let markCommandEntered!: () => void;
    const commandEntered = new Promise<void>((resolve) => {
      markCommandEntered = resolve;
    });
    const holdCommand = new Promise<void>((resolve) => {
      releaseCommand = resolve;
    });
    test.beforeNextWrite(async () => {
      markCommandEntered();
      await holdCommand;
    });

    const stale = api.command("chat-1", { type: "edit_arc", text: "Stale edit" }, 0);
    await commandEntered;
    test.setCurrent({ ...createDefaultContinuityDirectorState(NOW), revision: 1 });
    releaseCommand();

    await expect(stale).rejects.toMatchObject({ code: "stale_revision" });
    expect(test.current()).toMatchObject({ enabled: false, currentArc: null, beats: [], revision: 1 });
  });

  it("turns typed planner failures into typed API errors without patching", async () => {
    const test = harness();
    const api = createRoleplayContinuityDirectorApi(
      { storage: test.storage, llm: {} as LlmGateway },
      {
        now: () => NOW,
        refreshPlan: vi.fn(async () => ({ ok: false as const, code: "timeout" as const, message: "Timed out" })),
      },
    );

    await expect(api.refresh("chat-1")).rejects.toEqual(new ContinuityDirectorApiError("timeout", "Timed out"));
    expect(test.patchChatMetadata).not.toHaveBeenCalled();
  });

  it("forwards the exact initial-plan authorization to the planner", async () => {
    const test = harness();
    const exactPostApplyState = test.current();
    const refreshPlan = vi.fn(async () => ({
      ok: true as const,
      state: exactPostApplyState,
      rejectedUnsafeBeats: 0,
    }));
    const api = createRoleplayContinuityDirectorApi(
      { storage: test.storage, llm: {} as LlmGateway },
      { now: () => NOW, refreshPlan },
    );

    await api.refresh("chat-1", { initialExpectedDirectorState: exactPostApplyState });

    expect(refreshPlan).toHaveBeenCalledWith(
      { storage: test.storage, llm: expect.anything() },
      expect.objectContaining({
        chatId: "chat-1",
        initialExpectedDirectorState: exactPostApplyState,
      }),
    );
  });

  it("surfaces hard source-load failures as typed errors instead of stale success", async () => {
    const test = harness(
      state({
        sourceSnapshot: {
          storyProjectionIds: [],
          knowledgeEdgeIds: [],
          lastMessageId: null,
          fingerprint: "old",
          generatedAt: NOW,
        },
      }),
    );
    const api = createRoleplayContinuityDirectorApi(
      { storage: test.storage, llm: {} as LlmGateway },
      {
        now: () => NOW,
        loadSource: vi.fn(async () => {
          throw new Error("corrupt story source");
        }),
      },
    );

    await expect(api.getState("chat-1")).rejects.toEqual(
      new ContinuityDirectorApiError("source_unavailable", "corrupt story source"),
    );
  });

  it("forwards a per-beat reroll to the guarded planner", async () => {
    const test = harness();
    const refreshPlan = vi.fn(async () => ({ ok: true as const, state: test.current(), rejectedUnsafeBeats: 0 }));
    const api = createRoleplayContinuityDirectorApi(
      { storage: test.storage, llm: {} as LlmGateway },
      { now: () => NOW, refreshPlan },
    );

    await api.reroll("chat-1", "beat-1");

    expect(refreshPlan).toHaveBeenCalledWith(
      expect.objectContaining({ storage: test.storage }),
      expect.objectContaining({ chatId: "chat-1", rerollBeatId: "beat-1" }),
    );
  });
});
