import { describe, expect, it, vi } from "vitest";

import type { LlmGateway, LlmRequest } from "../../../capabilities/llm";
import type { StorageGateway } from "../../../capabilities/storage";
import type { RoleplayContinuityDirectorState } from "../../../contracts/types/roleplay-continuity-director";
import { applyContinuityDirectorCommand, createDefaultContinuityDirectorState } from "./continuity-director-state";
import { refreshContinuityDirectorPlan } from "./continuity-director-planner";

const NOW = "2026-09-02T12:00:00.000Z";

function enabledState(): RoleplayContinuityDirectorState {
  return applyContinuityDirectorCommand(
    createDefaultContinuityDirectorState(NOW),
    { type: "set_enabled", enabled: true },
    { now: () => NOW, createId: (prefix) => `${prefix}-seed` },
  );
}

function harness(response: string) {
  let state = enabledState();
  let beforeAuthorization: (() => void) | null = null;
  let beforePlanPersistence: (() => void) | null = null;
  let conditionalWriteCount = 0;
  let currentChat = {
    id: "chat-1",
    mode: "roleplay",
    connectionId: "writer-connection",
    characterIds: ["mara"],
    personaId: "celia",
    metadata: { roleplayContinuityDirector: state },
  };
  const patches: Record<string, unknown>[] = [];
  const requests: LlmRequest[] = [];
  const storage = {
    get: vi.fn(async (entity: string, id: string) => {
      if (entity === "chats") return currentChat;
      if (entity === "characters") return { id, data: { name: "Mara" } };
      if (entity === "personas") return { id, name: "Celia" };
      if (entity === "connections" && id === "director-local") return { id, provider: "local" };
      return null;
    }),
    listChatMessages: vi.fn(async () => [
      { id: "m1", role: "user", content: "We enter the watch house." },
      { id: "m2", role: "assistant", content: "Mara studies the seal." },
    ]),
    queryMemories: vi.fn(async () => []),
    queryKnowledgeEdges: vi.fn(async () => []),
    patchChatMetadata: vi.fn(async (_chatId: string, patch: Record<string, unknown>) => {
      beforePlanPersistence?.();
      beforePlanPersistence = null;
      patches.push(patch);
      currentChat = { ...currentChat, metadata: { ...currentChat.metadata, ...patch } };
      if (patch.roleplayContinuityDirector) {
        state = patch.roleplayContinuityDirector as RoleplayContinuityDirectorState;
      }
      return currentChat;
    }),
    updateChatIfUnchanged: vi.fn(
      async (_chatId: string, expected: Record<string, unknown>, patch: Record<string, unknown>) => {
        conditionalWriteCount += 1;
        if (conditionalWriteCount === 1) {
          beforeAuthorization?.();
          beforeAuthorization = null;
        } else {
          beforePlanPersistence?.();
          beforePlanPersistence = null;
        }
        const expectedMetadata = expected.metadata as Record<string, unknown>;
        const patchMetadata = patch.metadata as Record<string, unknown>;
        const key = "roleplayContinuityDirector";
        const expectedValue = expectedMetadata[key] ?? null;
        const value = patchMetadata[key];
        const currentValue = currentChat.metadata.roleplayContinuityDirector ?? null;
        if (JSON.stringify(currentValue) !== JSON.stringify(expectedValue)) {
          return { updated: false, chat: currentChat };
        }
        const directorValue = value as RoleplayContinuityDirectorState;
        patches.push({ [key]: directorValue });
        currentChat = {
          ...currentChat,
          metadata: { ...currentChat.metadata, roleplayContinuityDirector: directorValue },
        };
        state = directorValue;
        return { updated: true, chat: currentChat };
      },
    ),
  } as unknown as StorageGateway;
  const llm = {
    complete: vi.fn(async (request: LlmRequest) => {
      requests.push(request);
      return response;
    }),
  } as unknown as LlmGateway;
  return {
    storage,
    llm,
    patches,
    requests,
    getState: () => state,
    setState(next: RoleplayContinuityDirectorState) {
      state = next;
      currentChat = { ...currentChat, metadata: { ...currentChat.metadata, roleplayContinuityDirector: next } };
    },
    beforeAuthorization(callback: () => void) {
      beforeAuthorization = callback;
    },
    beforePlanPersistence(callback: () => void) {
      beforePlanPersistence = callback;
    },
  };
}

describe("continuity director planner", () => {
  it("uses the explicit connection, filters unsafe beats, and patches only director metadata", async () => {
    const test = harness(
      JSON.stringify({
        currentArc: "The forged seal threatens Mara's standing.",
        openThreads: ["Who ordered the forgery?"],
        beats: ["Mara reveals the forged seal.", "Celia decides to attack the captain."],
      }),
    );
    test.setState(
      applyContinuityDirectorCommand(
        test.getState(),
        { type: "set_connection", connectionId: "director-local" },
        { now: () => NOW },
      ),
    );

    const result = await refreshContinuityDirectorPlan(
      { storage: test.storage, llm: test.llm },
      { chatId: "chat-1", now: () => NOW, createId: (prefix) => `${prefix}-new` },
    );

    expect(result).toMatchObject({ ok: true, rejectedUnsafeBeats: 1 });
    expect(test.requests[0]).toMatchObject({
      connectionId: "director-local",
      parameters: { temperature: 0.2, max_tokens: 900 },
    });
    expect(test.requests[0]?.messages[0]?.content).toMatch(/never prescribe Celia's dialogue/i);
    expect(test.patches).toHaveLength(2);
    expect(test.patches.at(-1)).toEqual({
      roleplayContinuityDirector: expect.objectContaining({
        currentArc: expect.objectContaining({ text: "The forged seal threatens Mara's standing." }),
        beats: [expect.objectContaining({ text: "Mara reveals the forged seal.", status: "proposed" })],
        sourceSnapshot: expect.objectContaining({ lastMessageId: "m2" }),
      }),
    });
  });

  it("leaves the current plan untouched when structured output is malformed", async () => {
    const test = harness("not json");
    const result = await refreshContinuityDirectorPlan(
      { storage: test.storage, llm: test.llm },
      { chatId: "chat-1", now: () => NOW },
    );
    expect(result).toMatchObject({ ok: false, code: "invalid_output" });
    expect(test.patches).toHaveLength(1);
    expect(test.getState()).toMatchObject({ currentArc: null, openThreads: [], beats: [], sourceSnapshot: null });
  });

  it("persists a failed initial planning attempt without fabricating a successful snapshot", async () => {
    const test = harness("not json");

    const result = await refreshContinuityDirectorPlan(
      { storage: test.storage, llm: test.llm },
      { chatId: "chat-1", now: () => NOW },
    );

    expect(result).toMatchObject({ ok: false, code: "invalid_output" });
    expect(test.getState()).toMatchObject({
      sourceSnapshot: null,
      lastPlanningAttemptAssistantTurnCount: 1,
    });
  });

  it("keeps manual refresh available immediately after an initial failure", async () => {
    const test = harness("not json");

    await refreshContinuityDirectorPlan(
      { storage: test.storage, llm: test.llm },
      { chatId: "chat-1", now: () => NOW },
    );
    test.llm.complete = vi.fn(async () =>
      JSON.stringify({ currentArc: "The seal draws attention.", openThreads: [], beats: [] }),
    );
    const retry = await refreshContinuityDirectorPlan(
      { storage: test.storage, llm: test.llm },
      { chatId: "chat-1", now: () => NOW },
    );

    expect(retry).toMatchObject({ ok: true });
    expect(test.llm.complete).toHaveBeenCalledTimes(1);
  });

  it("rejects a structurally empty plan instead of reporting reviewable success", async () => {
    const test = harness('{"currentArc":null,"openThreads":[],"beats":[]}');

    const result = await refreshContinuityDirectorPlan(
      { storage: test.storage, llm: test.llm },
      { chatId: "chat-1", now: () => NOW },
    );

    expect(result).toMatchObject({ ok: false, code: "invalid_output" });
    expect(test.getState()).toMatchObject({ currentArc: null, openThreads: [], beats: [], sourceSnapshot: null });
  });

  it.each([
    {
      field: "current arc",
      response: {
        currentArc: "Celia decides to betray Mara.",
        openThreads: ["Who forged the seal?"],
        beats: ["Mara confronts the watch captain."],
      },
    },
    {
      field: "open thread",
      response: {
        currentArc: "The forged seal threatens Mara's standing.",
        openThreads: ["Will Celia confess to stealing the map?"],
        beats: ["Mara confronts the watch captain."],
      },
    },
  ])("rejects an unsafe $field without patching state", async ({ response }) => {
    const test = harness(JSON.stringify(response));

    const result = await refreshContinuityDirectorPlan(
      { storage: test.storage, llm: test.llm },
      { chatId: "chat-1", now: () => NOW },
    );

    expect(result).toMatchObject({ ok: false, code: "invalid_output" });
    expect(test.patches).toHaveLength(1);
    expect(test.getState()).toMatchObject({ currentArc: null, openThreads: [], beats: [], sourceSnapshot: null });
  });

  it("rejects a refresh when every proposed beat is unsafe", async () => {
    const test = harness(
      JSON.stringify({
        currentArc: "The forged seal threatens Mara's standing.",
        openThreads: ["Who forged the seal?"],
        beats: ["Celia attacks the captain.", "You decide to flee."],
      }),
    );

    const result = await refreshContinuityDirectorPlan(
      { storage: test.storage, llm: test.llm },
      { chatId: "chat-1", now: () => NOW },
    );

    expect(result).toMatchObject({ ok: false, code: "invalid_output" });
    expect(test.patches).toHaveLength(1);
    expect(test.getState()).toMatchObject({ currentArc: null, openThreads: [], beats: [], sourceSnapshot: null });
  });

  it("does not silently fall back when an explicit connection is unavailable", async () => {
    const test = harness('{"currentArc":null,"openThreads":[],"beats":[]}');
    test.setState(
      applyContinuityDirectorCommand(
        test.getState(),
        { type: "set_connection", connectionId: "missing" },
        { now: () => NOW },
      ),
    );
    const result = await refreshContinuityDirectorPlan(
      { storage: test.storage, llm: test.llm },
      { chatId: "chat-1", now: () => NOW },
    );
    expect(result).toMatchObject({ ok: false, code: "connection_unavailable" });
    expect(test.llm.complete).not.toHaveBeenCalled();
    expect(test.patches).toHaveLength(0);
  });

  it("discards a stale plan when a concurrent user edit advances the authorizing revision", async () => {
    const test = harness('{"currentArc":"Replace me","openThreads":[],"beats":["A fresh proposal."]}');
    test.llm.complete = vi.fn(async () => {
      const edited = applyContinuityDirectorCommand(
        test.getState(),
        { type: "edit_arc", text: "User-owned arc" },
        { now: () => "2026-09-02T12:01:00.000Z", createId: (prefix) => `${prefix}-user` },
      );
      test.setState(edited);
      return '{"currentArc":"Replace me","openThreads":[],"beats":["A fresh proposal."]}';
    });

    const result = await refreshContinuityDirectorPlan(
      { storage: test.storage, llm: test.llm },
      { chatId: "chat-1", now: () => "2026-09-02T12:02:00.000Z", createId: (prefix) => `${prefix}-new` },
    );

    expect(result).toMatchObject({ ok: false, code: "persistence_failed" });
    expect(test.getState()).toMatchObject({
      currentArc: expect.objectContaining({ text: "User-owned arc", source: "user" }),
      beats: [],
    });
  });

  it("discards a stale plan when a pre-read user edit lands with the reserved revision", async () => {
    const test = harness('{"currentArc":"Stale plan","openThreads":[],"beats":["A stale proposal."]}');
    const precomputedEdit = applyContinuityDirectorCommand(
      test.getState(),
      { type: "edit_arc", text: "Pre-read user arc" },
      { now: () => "2026-09-02T12:01:00.000Z", createId: (prefix) => `${prefix}-user` },
    );
    test.llm.complete = vi.fn(async () => {
      test.setState(precomputedEdit);
      return '{"currentArc":"Stale plan","openThreads":[],"beats":["A stale proposal."]}';
    });

    const result = await refreshContinuityDirectorPlan(
      { storage: test.storage, llm: test.llm },
      { chatId: "chat-1", now: () => "2026-09-02T12:02:00.000Z", createId: (prefix) => `${prefix}-new` },
    );

    expect(result).toMatchObject({ ok: false, code: "persistence_failed" });
    expect(test.getState()).toMatchObject({
      currentArc: expect.objectContaining({ text: "Pre-read user arc", source: "user" }),
      beats: [],
      lastPlanningAttemptAssistantTurnCount: null,
    });
  });

  it("cannot resurrect Director state reverted after its final read", async () => {
    const test = harness('{"currentArc":"Replace me","openThreads":[],"beats":["A stale proposal."]}');
    test.beforePlanPersistence(() => {
      test.setState({
        ...createDefaultContinuityDirectorState("2026-09-02T12:03:00.000Z"),
        revision: test.getState().revision + 1,
      });
    });

    const result = await refreshContinuityDirectorPlan(
      { storage: test.storage, llm: test.llm },
      { chatId: "chat-1", now: () => "2026-09-02T12:02:00.000Z", createId: (prefix) => `${prefix}-new` },
    );

    expect(result).toMatchObject({ ok: false });
    expect(test.getState()).toMatchObject({ enabled: false, currentArc: null, beats: [] });
  });

  it("does not spend a model call when the authorizing Director state changes before the attempt is recorded", async () => {
    const test = harness('{"currentArc":"Stale","openThreads":[],"beats":[]}');
    test.beforeAuthorization(() => {
      test.setState({
        ...test.getState(),
        revision: test.getState().revision + 1,
        sourceSnapshot: {
          storyProjectionIds: [],
          knowledgeEdgeIds: [],
          lastMessageId: "m2",
          visibleAssistantTurnCount: 1,
          fingerprint: "already-planned",
          generatedAt: NOW,
        },
      });
    });

    const result = await refreshContinuityDirectorPlan(
      { storage: test.storage, llm: test.llm },
      { chatId: "chat-1", now: () => NOW },
    );

    expect(result).toMatchObject({ ok: false, code: "persistence_failed" });
    expect(test.llm.complete).not.toHaveBeenCalled();
    expect(test.getState().sourceSnapshot?.fingerprint).toBe("already-planned");
  });

  it("maps timeout-like failures without patching state", async () => {
    const test = harness("unused");
    test.llm.complete = vi.fn(async () => {
      throw new DOMException("timed out", "AbortError");
    });
    const result = await refreshContinuityDirectorPlan(
      { storage: test.storage, llm: test.llm },
      { chatId: "chat-1", now: () => NOW, timeoutMs: 1 },
    );
    expect(result).toMatchObject({ ok: false, code: "timeout" });
    expect(test.patches).toHaveLength(1);
    expect(test.getState()).toMatchObject({ currentArc: null, openThreads: [], beats: [], sourceSnapshot: null });
  });

  it("rerolls one beat atomically while preserving the rest of the plan", async () => {
    const test = harness('{"replacementBeat":"The captain drops a coded ledger."}');
    let current = applyContinuityDirectorCommand(
      test.getState(),
      { type: "replace_director_proposals", beats: ["The guard arrives.", "Mara finds a seal."] },
      { now: () => NOW, createId: (prefix) => `${prefix}-${Math.random()}` },
    );
    const targetId = current.beats[0]!.id;
    current = applyContinuityDirectorCommand(
      current,
      { type: "set_beat_status", beatId: targetId, status: "approved" },
      { now: () => NOW },
    );
    test.setState(current);

    const result = await refreshContinuityDirectorPlan(
      { storage: test.storage, llm: test.llm },
      { chatId: "chat-1", rerollBeatId: targetId, now: () => NOW, createId: (prefix) => `${prefix}-rerolled` },
    );

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("expected success");
    expect(test.requests[0]?.messages[1]?.content).toContain(targetId);
    expect(test.requests[0]?.messages[1]?.content).toContain("The guard arrives.");
    expect(result.state.beats).toEqual([
      expect.objectContaining({ id: targetId, status: "rejected", resolution: "rerolled" }),
      expect.objectContaining({ text: "Mara finds a seal." }),
      expect.objectContaining({ text: "The captain drops a coded ledger.", status: "proposed" }),
    ]);
  });

  it("rejects ambiguous reroll output without patching state", async () => {
    const test = harness('{"currentArc":null,"openThreads":[],"beats":["One option.","Another option."]}');
    const current = applyContinuityDirectorCommand(
      test.getState(),
      { type: "replace_director_proposals", beats: ["The guard arrives.", "Mara finds a seal."] },
      { now: () => NOW, createId: (prefix) => `${prefix}-seeded` },
    );
    const targetId = current.beats[0]!.id;
    test.setState(current);

    const result = await refreshContinuityDirectorPlan(
      { storage: test.storage, llm: test.llm },
      { chatId: "chat-1", rerollBeatId: targetId, now: () => NOW },
    );

    expect(result).toMatchObject({ ok: false, code: "invalid_output" });
    expect(test.patches).toHaveLength(1);
    expect(test.getState().beats).toEqual(current.beats);
  });

  it("serializes a reroll behind an in-flight full refresh instead of silently coalescing it", async () => {
    const test = harness("unused");
    let current = applyContinuityDirectorCommand(
      test.getState(),
      { type: "replace_director_proposals", beats: ["The guard arrives."] },
      { now: () => NOW, createId: (prefix) => `${prefix}-seeded` },
    );
    const targetId = current.beats[0]!.id;
    current = applyContinuityDirectorCommand(
      current,
      { type: "set_beat_status", beatId: targetId, status: "approved" },
      { now: () => NOW },
    );
    test.setState(current);

    let releaseFirst!: () => void;
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    test.llm.complete = vi
      .fn()
      .mockImplementationOnce(async () => {
        await firstPending;
        return '{"currentArc":null,"openThreads":[],"beats":["A fresh proposal."]}';
      })
      .mockResolvedValueOnce('{"replacementBeat":"A different beat."}');

    const refresh = refreshContinuityDirectorPlan(
      { storage: test.storage, llm: test.llm },
      { chatId: "chat-1", now: () => NOW, createId: (prefix) => `${prefix}-refresh` },
    );
    await vi.waitFor(() => expect(test.llm.complete).toHaveBeenCalledTimes(1));
    const reroll = refreshContinuityDirectorPlan(
      { storage: test.storage, llm: test.llm },
      { chatId: "chat-1", rerollBeatId: targetId, now: () => NOW, createId: (prefix) => `${prefix}-reroll` },
    );

    releaseFirst();
    await refresh;
    const rerollResult = await reroll;

    expect(test.llm.complete).toHaveBeenCalledTimes(2);
    expect(rerollResult).toMatchObject({ ok: true });
    if (!rerollResult.ok) throw new Error("expected success");
    expect(rerollResult.state.beats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: targetId, status: "rejected", resolution: "rerolled" }),
        expect.objectContaining({ text: "A different beat.", status: "proposed" }),
      ]),
    );
  });
});
