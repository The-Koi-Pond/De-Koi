import { describe, expect, it, vi } from "vitest";

import type { LlmGateway } from "../../../capabilities/llm";
import type { StorageGateway } from "../../../capabilities/storage";
import type {
  ContinuityDirectorSourceSnapshot,
  RoleplayContinuityDirectorState,
} from "../../../contracts/types/roleplay-continuity-director";
import { createDefaultContinuityDirectorState } from "./continuity-director-state";
import {
  subscribeContinuityDirectorRefreshCompletions,
} from "./continuity-director-refresh-events";
import { createContinuityDirectorRefreshScheduler } from "./continuity-director-scheduler";

const NOW = "2026-09-02T12:00:00.000Z";

function snapshot(fingerprint: string, visibleAssistantTurnCount: number): ContinuityDirectorSourceSnapshot {
  return {
    storyProjectionIds: [],
    knowledgeEdgeIds: [],
    lastMessageId: `message-${visibleAssistantTurnCount}`,
    visibleAssistantTurnCount,
    fingerprint,
    generatedAt: NOW,
  };
}

function state(overrides: Partial<RoleplayContinuityDirectorState> = {}): RoleplayContinuityDirectorState {
  return {
    ...createDefaultContinuityDirectorState(NOW),
    enabled: true,
    refreshMode: "cadence",
    refreshEveryAssistantTurns: 5,
    sourceSnapshot: snapshot("old", 4),
    ...overrides,
  };
}

function source(chatId: string, director: RoleplayContinuityDirectorState, current: ContinuityDirectorSourceSnapshot) {
  return {
    chat: { id: chatId, mode: "roleplay", metadata: { roleplayContinuityDirector: director } },
    writerConnectionId: "writer",
    characterNames: [],
    personaNames: [],
    transcript: [],
    story: [],
    knowledge: [],
    sourceSnapshot: current,
  };
}

function storageFor(
  director: RoleplayContinuityDirectorState | ((chatId: string) => RoleplayContinuityDirectorState),
): StorageGateway {
  return {
    get: vi.fn(async (entity: string, id: string) => {
      if (entity !== "chats") return null;
      const state = typeof director === "function" ? director(id) : director;
      return { id, mode: "roleplay", metadata: { roleplayContinuityDirector: state } };
    }),
  } as unknown as StorageGateway;
}

function deferredRunner() {
  const queued: Array<() => void> = [];
  return {
    defer: (run: () => void) => queued.push(run),
    flush: async () => {
      for (const run of queued.splice(0)) run();
      await vi.waitFor(() => expect(queued).toHaveLength(0));
      await Promise.resolve();
    },
  };
}

describe("continuity director refresh scheduler", () => {
  it("rechecks policy in the queued job and skips disabled or manual state", async () => {
    const runner = deferredRunner();
    const refreshPlan = vi.fn();
    const diagnostics = vi.fn();
    const director = state({ refreshMode: "manual" });
    const loadSource = vi.fn(async (_storage, chatId) => source(chatId, director, snapshot("new", 20)));
    const storage = storageFor(director);
    const scheduler = createContinuityDirectorRefreshScheduler({
      defer: runner.defer,
      loadSource,
      refreshPlan,
    });

    expect(
      scheduler.schedule({
        storage,
        llm: {} as LlmGateway,
        chatId: "chat-1",
        trigger: "assistant_saved",
        onDiagnostic: diagnostics,
      }),
    ).toBe(true);
    await runner.flush();
    await vi.waitFor(() => expect(diagnostics).toHaveBeenCalled());

    expect(refreshPlan).not.toHaveBeenCalled();
    expect(loadSource).not.toHaveBeenCalled();
    expect(diagnostics).toHaveBeenCalledWith(expect.objectContaining({ status: "skipped", reason: "manual" }));
  });

  it("runs a due refresh and reports typed planner failure without rejecting", async () => {
    const runner = deferredRunner();
    const diagnostics = vi.fn();
    const completions = vi.fn();
    const unsubscribe = subscribeContinuityDirectorRefreshCompletions(completions);
    const refreshPlan = vi.fn(async () => ({ ok: false as const, code: "timeout" as const, message: "Timed out" }));
    const scheduler = createContinuityDirectorRefreshScheduler({
      defer: runner.defer,
      loadSource: vi.fn(async (_storage, chatId) => source(chatId, state(), snapshot("new", 9))),
      refreshPlan,
    });

    scheduler.schedule({
      storage: storageFor(state()),
      llm: {} as LlmGateway,
      chatId: "chat-1",
      trigger: "assistant_saved",
      onDiagnostic: diagnostics,
    });
    await runner.flush();
    await vi.waitFor(() => expect(refreshPlan).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(diagnostics).toHaveBeenCalled());

    expect(diagnostics).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error", reason: "timeout", chatId: "chat-1" }),
    );
    expect(completions).toHaveBeenCalledWith({ chatId: "chat-1" });
    unsubscribe();
  });

  it("publishes after successful persistence and isolates completion observers from queue progress", async () => {
    const runner = deferredRunner();
    const completions = vi.fn(() => {
      throw new Error("observer failed");
    });
    const unsubscribe = subscribeContinuityDirectorRefreshCompletions(completions);
    const refreshPlan = vi.fn(async () => ({ ok: true as const, state: state(), rejectedUnsafeBeats: 0 }));
    const storage = storageFor(state());
    const scheduler = createContinuityDirectorRefreshScheduler({
      defer: runner.defer,
      loadSource: vi.fn(async (_storage, chatId) => source(chatId, state(), snapshot("new", 9))),
      refreshPlan,
    });

    scheduler.schedule({ storage, llm: {} as LlmGateway, chatId: "chat-1", trigger: "assistant_saved" });
    await runner.flush();
    await vi.waitFor(() => expect(scheduler.isPending(storage, "chat-1")).toBe(false));

    expect(completions).toHaveBeenCalledWith({ chatId: "chat-1" });
    unsubscribe();
  });

  it("does not publish when policy skips before a planner invocation", async () => {
    const runner = deferredRunner();
    const completions = vi.fn();
    const unsubscribe = subscribeContinuityDirectorRefreshCompletions(completions);
    const director = state({ refreshMode: "manual" });
    const scheduler = createContinuityDirectorRefreshScheduler({ defer: runner.defer });

    scheduler.schedule({
      storage: storageFor(director),
      llm: {} as LlmGateway,
      chatId: "chat-1",
      trigger: "assistant_saved",
      onDiagnostic: vi.fn(),
    });
    await runner.flush();

    expect(completions).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("coalesces preflight overlap and rechecks a trigger queued during the model call", async () => {
    const runner = deferredRunner();
    let director = state();
    const storage = storageFor(() => director);
    let release!: () => void;
    const firstRefresh = new Promise<void>((resolve) => {
      release = resolve;
    });
    let active = 0;
    let maxActive = 0;
    const refreshPlan = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await firstRefresh;
      director = { ...director, sourceSnapshot: snapshot("new", 9) };
      active -= 1;
      return { ok: true as const, state: director, rejectedUnsafeBeats: 0 };
    });
    const scheduler = createContinuityDirectorRefreshScheduler({
      defer: runner.defer,
      loadSource: vi.fn(async (_storage, chatId) => source(chatId, director, snapshot("new", 9))),
      refreshPlan,
    });
    const input = {
      storage,
      llm: {} as LlmGateway,
      chatId: "chat-1",
      trigger: "assistant_saved" as const,
    };

    scheduler.schedule(input);
    scheduler.schedule(input);
    await runner.flush();
    await vi.waitFor(() => expect(refreshPlan).toHaveBeenCalledTimes(1));
    scheduler.schedule(input);
    release();
    await vi.waitFor(() => expect(scheduler.isPending(storage, "chat-1")).toBe(false));

    expect(refreshPlan).toHaveBeenCalledTimes(1);
    expect(maxActive).toBe(1);
  });

  it("keeps queued work bound to its chat when the UI switches chats", async () => {
    const runner = deferredRunner();
    const refreshPlan = vi.fn(async (_capabilities, input: { chatId: string }) => ({
      ok: true as const,
      state: state({ sourceSnapshot: snapshot(input.chatId, 9) }),
      rejectedUnsafeBeats: 0,
    }));
    const scheduler = createContinuityDirectorRefreshScheduler({
      defer: runner.defer,
      loadSource: vi.fn(async (_storage, chatId) => source(chatId, state(), snapshot(`new-${chatId}`, 9))),
      refreshPlan,
    });
    const storage = storageFor(() => state());
    const llm = {} as LlmGateway;

    scheduler.schedule({ storage, llm, chatId: "chat-a", trigger: "assistant_saved" });
    scheduler.schedule({ storage, llm, chatId: "chat-b", trigger: "assistant_saved" });
    await runner.flush();
    await vi.waitFor(() => expect(refreshPlan).toHaveBeenCalledTimes(2));

    expect(refreshPlan.mock.calls.map((call) => call[1].chatId).sort()).toEqual(["chat-a", "chat-b"]);
  });
});
