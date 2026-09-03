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
  const patchChatMetadata = vi.fn(async (_chatId: string, patch: Record<string, unknown>) => {
    current = patch.roleplayContinuityDirector as RoleplayContinuityDirectorState;
    return { id: "chat-1", metadata: { roleplayContinuityDirector: current } };
  });
  const storage = {
    get: vi.fn(async (entity: string) =>
      entity === "chats"
        ? { id: "chat-1", mode: "roleplay", characterIds: [], metadata: { roleplayContinuityDirector: current } }
        : null,
    ),
    patchChatMetadata,
  } as unknown as StorageGateway;
  return { storage, patchChatMetadata, current: () => current };
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

  it("applies a command through one metadata-only patch", async () => {
    const test = harness();
    const api = createRoleplayContinuityDirectorApi(
      { storage: test.storage, llm: {} as LlmGateway },
      { now: () => NOW },
    );

    const result = await api.command("chat-1", { type: "set_enabled", enabled: false }, 0);

    expect(result.state.enabled).toBe(false);
    expect(test.patchChatMetadata).toHaveBeenCalledWith("chat-1", {
      roleplayContinuityDirector: expect.objectContaining({ enabled: false, revision: 1 }),
    });
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
