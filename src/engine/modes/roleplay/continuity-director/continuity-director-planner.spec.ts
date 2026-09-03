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
      patches.push(patch);
      currentChat = { ...currentChat, metadata: { ...currentChat.metadata, ...patch } };
      return currentChat;
    }),
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
    expect(test.patches).toHaveLength(1);
    expect(test.patches[0]).toEqual({
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
    expect(test.patches).toHaveLength(0);
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

  it("reloads metadata after the model call and preserves concurrent user edits", async () => {
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

    expect(result).toMatchObject({ ok: true });
    expect(test.patches[0]).toEqual({
      roleplayContinuityDirector: expect.objectContaining({
        currentArc: expect.objectContaining({ text: "User-owned arc", source: "user" }),
        beats: [expect.objectContaining({ text: "A fresh proposal." })],
      }),
    });
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
    expect(test.patches).toHaveLength(0);
  });

  it("rerolls one beat atomically while preserving the rest of the plan", async () => {
    const test = harness('{"currentArc":null,"openThreads":[],"beats":["The captain drops a coded ledger."]}');
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
    expect(result.state.beats).toEqual([
      expect.objectContaining({ id: targetId, status: "rejected", resolution: "rerolled" }),
      expect.objectContaining({ text: "Mara finds a seal." }),
      expect.objectContaining({ text: "The captain drops a coded ledger.", status: "proposed" }),
    ]);
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
      .mockResolvedValueOnce('{"currentArc":null,"openThreads":[],"beats":["A different beat."]}');

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
