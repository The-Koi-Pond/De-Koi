import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  intent: {
    current: null as null | {
      journeyId: string;
      mode: "conversation";
      originCharacterId: null;
      selectedConnectionId: string | null;
      dismissed: boolean;
      completed: boolean;
    },
  },
  embedded: { current: false },
  health: vi.fn(),
  connections: {
    current: [{ id: "saved", provider: "openai", model: "gpt" }] as Array<{
      id: string;
      provider: string;
      model: string;
      isDefault?: boolean;
    }>,
  },
  connectionsPending: { current: false },
  mutateAsync: vi.fn(),
  updateAsync: vi.fn(),
  markConnection: vi.fn(),
  markCompleted: vi.fn(),
  recordRecovery: vi.fn(),
  clearRecovery: vi.fn(),
  applyPreset: vi.fn(),
  recovery: { current: null as import("../../../../engine/onboarding").SetupJourneyRecovery | null },
  runtimeUrl: { current: "https://runtime-a.test" },
  sameOriginRuntimeUrl: { current: "https://de-koi.test" },
  invalidateQueries: vi.fn(),
  selectDefaultTextConnectionId: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }) }));

vi.mock("../../../catalog/connections", () => ({
  useConnections: (enabled: boolean) => ({
    data: enabled && !mocks.connectionsPending.current ? mocks.connections.current : undefined,
    isPending: enabled && mocks.connectionsPending.current,
  }),
}));
vi.mock("../../../catalog/chats", () => ({
  chatKeys: { messages: (chatId: string) => ["chats", chatId, "messages"] },
  useCreateChat: () => ({ mutateAsync: mocks.mutateAsync }),
  useUpdateChat: () => ({ mutateAsync: mocks.updateAsync }),
}));
vi.mock("../../../catalog/chat-presets", () => ({ useApplyUserStarredChatPreset: () => mocks.applyPreset }));
vi.mock("../../../../shared/api/remote-runtime", () => ({
  hasEmbeddedTauriRuntime: () => mocks.embedded.current,
  sameOriginRemoteRuntimeUrl: () => mocks.sameOriginRuntimeUrl.current,
  checkRemoteRuntimeHealth: (...args: unknown[]) => mocks.health(...args),
}));
vi.mock("../../../../shared/api/storage-api", () => ({
  storageApi: {
    get: vi.fn(),
    createChatMessage: vi.fn(),
    addChatMessageSwipe: vi.fn(),
  },
}));
vi.mock("../../../../shared/api/connection-catalog-api", () => ({
  connectionCatalogApi: {
    selectDefaultTextConnectionId: (...args: unknown[]) => mocks.selectDefaultTextConnectionId(...args),
  },
}));
vi.mock("../../../../shared/stores/setup-journey.store", () => {
  const state = {
    get intent() {
      return mocks.intent.current;
    },
    get recovery() {
      return mocks.recovery.current;
    },
    savedWithoutTestConnectionIds: [],
    markConnection: mocks.markConnection,
    markCompleted: mocks.markCompleted,
    recordRecovery: (recovery: import("../../../../engine/onboarding").SetupJourneyRecovery) => {
      mocks.recovery.current = recovery;
      mocks.recordRecovery(recovery);
    },
    clearRecovery: () => {
      mocks.recovery.current = null;
      mocks.clearRecovery();
    },
  };
  const useSetupJourneyStore = (selector: (value: typeof state) => unknown) => selector(state);
  useSetupJourneyStore.getState = () => state;
  return { useSetupJourneyStore };
});
vi.mock("../../../../shared/stores/ui.store", () => {
  const state = {
    get remoteRuntimeUrl() {
      return mocks.runtimeUrl.current;
    },
    setSettingsTab: vi.fn(),
    openRightPanel: vi.fn(),
  };
  const useUIStore = (selector: (value: typeof state) => unknown) => selector(state);
  useUIStore.getState = () => state;
  return { useUIStore };
});
vi.mock("../../../../shared/stores/chat.store", () => ({
  useChatStore: {
    getState: () => ({ setPendingNewChatMode: vi.fn(), setActiveChatId: vi.fn(), setNewChatSetupIntent: vi.fn() }),
  },
}));

import { SetupReadinessJourney } from "./SetupReadinessJourney";

describe("SetupReadinessJourney", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    mocks.intent.current = {
      journeyId: "journey-1",
      mode: "conversation",
      originCharacterId: null,
      selectedConnectionId: null,
      dismissed: false,
      completed: false,
    };
    mocks.embedded.current = false;
    mocks.health.mockReset().mockResolvedValue({
      status: "ok",
      message: "Ready",
      health: { ok: true, writable: true },
    });
    mocks.mutateAsync.mockReset().mockResolvedValue({ id: "chat-1" });
    mocks.markCompleted.mockReset();
    mocks.markConnection.mockReset();
    mocks.applyPreset.mockReset().mockResolvedValue(undefined);
    mocks.recovery.current = null;
    mocks.runtimeUrl.current = "https://runtime-a.test";
    mocks.sameOriginRuntimeUrl.current = "https://de-koi.test";
    mocks.connections.current = [{ id: "saved", provider: "openai", model: "gpt" }];
    mocks.connectionsPending.current = false;
    mocks.selectDefaultTextConnectionId
      .mockReset()
      .mockImplementation((connections: Array<{ id: string; isDefault?: boolean }>) => {
        return connections.find((connection) => connection.isDefault)?.id ?? connections[0]?.id ?? null;
      });
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("stays absent for a previously completed journey", () => {
    mocks.intent.current = { ...mocks.intent.current!, completed: true };
    act(() => root.render(<SetupReadinessJourney />));
    expect(container.textContent).toBe("");
  });

  it("does not offer or create chat before web runtime readiness", async () => {
    mocks.health.mockReturnValue(new Promise(() => undefined));
    await act(async () => root.render(<SetupReadinessJourney />));
    expect(container.textContent).toBe("");
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });

  it("stays absent while usable connections are still loading", async () => {
    mocks.embedded.current = true;
    mocks.connectionsPending.current = true;

    await act(async () => root.render(<SetupReadinessJourney />));

    expect(container.textContent).toBe("");
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });

  it("shows setup after the web runtime is confirmed unhealthy", async () => {
    mocks.health.mockResolvedValue({ status: "unreachable", message: "Server unavailable" });

    await act(async () => {
      root.render(<SetupReadinessJourney />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Finish setting up De-Koi");
    expect(container.textContent).toContain("Repair server connection");
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });

  it("automatically launches a fresh intent with an existing usable connection", async () => {
    mocks.health.mockResolvedValue({ status: "ok", message: "Ready", health: { ok: true, writable: true } });
    mocks.mutateAsync.mockResolvedValue({ id: "chat-1" });

    await act(async () => {
      root.render(<SetupReadinessJourney />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "conversation", connectionId: "saved" }),
    );
    expect(mocks.mutateAsync).toHaveBeenCalledOnce();
    expect(mocks.markCompleted).toHaveBeenCalled();
    expect(container.textContent).not.toContain("Finish setting up De-Koi");
  });

  it("uses the stored default when Local Model is listed first", async () => {
    mocks.embedded.current = true;
    mocks.connections.current = [
      { id: "sidecar:local", provider: "custom", model: "local" },
      { id: "saved-default", provider: "openai", model: "gpt", isDefault: true },
    ];

    await act(async () => {
      root.render(<SetupReadinessJourney />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.selectDefaultTextConnectionId).toHaveBeenCalled();
    expect(mocks.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ connectionId: "saved-default" }));
  });

  it("keeps an explicit setup selection ahead of the stored default", async () => {
    mocks.embedded.current = true;
    mocks.intent.current = { ...mocks.intent.current!, selectedConnectionId: "sidecar:local" };
    mocks.connections.current = [
      { id: "sidecar:local", provider: "custom", model: "local" },
      { id: "saved-default", provider: "openai", model: "gpt", isDefault: true },
    ];

    await act(async () => {
      root.render(<SetupReadinessJourney />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ connectionId: "sidecar:local" }));
  });

  it("launches against the hosted page origin before runtime URL persistence", async () => {
    mocks.runtimeUrl.current = "";
    mocks.health.mockResolvedValue({ status: "ok", message: "Ready", health: { ok: true, writable: true } });

    await act(async () => {
      root.render(<SetupReadinessJourney />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.health).toHaveBeenCalledWith(
      "https://de-koi.test",
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(mocks.mutateAsync).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain("Finish setting up De-Koi");
  });

  it("keeps setup visible without creating when no usable connection exists", async () => {
    mocks.embedded.current = true;
    mocks.connections.current = [];

    await act(async () => root.render(<SetupReadinessJourney />));

    expect(container.textContent).toContain("Connect a language model");
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });

  it("invalidates healthy readiness synchronously when the runtime target changes", async () => {
    let resolveB: (value: unknown) => void = () => undefined;
    mocks.health.mockImplementation((url: string) =>
      url.includes("runtime-a")
        ? Promise.resolve({ status: "ok", message: "A ready", health: { ok: true, writable: true } })
        : new Promise((resolve) => {
            resolveB = resolve;
          }),
    );
    mocks.connections.current = [];
    await act(async () => {
      root.render(<SetupReadinessJourney />);
      await Promise.resolve();
    });
    expect(mocks.mutateAsync).not.toHaveBeenCalled();

    mocks.runtimeUrl.current = "https://runtime-b.test";
    mocks.connections.current = [{ id: "saved", provider: "openai", model: "gpt" }];
    flushSync(() => root.render(<SetupReadinessJourney />));
    expect(mocks.mutateAsync).not.toHaveBeenCalled();

    await act(async () => resolveB({ status: "ok", message: "B ready", health: { ok: true, writable: true } }));
    expect(mocks.mutateAsync).toHaveBeenCalledOnce();
  });

  it("surfaces a failed automatic launch and retries it without creating twice", async () => {
    mocks.embedded.current = true;
    mocks.mutateAsync.mockRejectedValueOnce(new Error("launch failed")).mockResolvedValueOnce({ id: "chat-1" });
    await act(async () => {
      root.render(<SetupReadinessJourney />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Couldn’t finish setup");
    expect(container.textContent).not.toContain("Continue with defaults");
    const retry = Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "Retry")!;
    await act(async () => retry.click());
    expect(mocks.mutateAsync).toHaveBeenCalledTimes(2);
  });

  it("offers an explicit default fallback after preset application fails", async () => {
    mocks.embedded.current = true;
    mocks.mutateAsync.mockResolvedValue({ id: "chat-1" });
    mocks.applyPreset.mockRejectedValue(new Error("preset unavailable"));
    await act(async () => {
      root.render(<SetupReadinessJourney />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("preset unavailable");
    mocks.recovery.current = {
      createdChatId: "chat-1",
      journeyId: "journey-1",
      stage: "created",
    };
    mocks.updateAsync.mockResolvedValue({ id: "chat-1" });
    const useDefaults = Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent === "Continue with defaults",
    )!;
    expect(useDefaults).toBeTruthy();
    await act(async () => useDefaults.click());
    expect(mocks.mutateAsync).toHaveBeenCalledOnce();
    expect(mocks.applyPreset).toHaveBeenCalledOnce();
    expect(mocks.markCompleted).toHaveBeenCalledOnce();
  });
});
