import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  intent: { current: null as null | { journeyId: string; mode: "conversation"; originCharacterId: null; selectedConnectionId: string | null; dismissed: boolean; completed: boolean } },
  embedded: { current: false },
  health: vi.fn(),
  connections: { current: [{ id: "saved", provider: "openai", model: "gpt" }] },
  mutateAsync: vi.fn(),
  updateAsync: vi.fn(),
  markConnection: vi.fn(),
  markCompleted: vi.fn(),
  runtimeUrl: { current: "https://runtime-a.test" },
  invalidateQueries: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }) }));

vi.mock("../../../catalog/connections", () => ({ useConnections: (enabled: boolean) => ({ data: enabled ? mocks.connections.current : [] }) }));
vi.mock("../../../catalog/chats", () => ({
  chatKeys: { messages: (chatId: string) => ["chats", chatId, "messages"] },
  useCreateChat: () => ({ mutateAsync: mocks.mutateAsync }),
  useUpdateChat: () => ({ mutateAsync: mocks.updateAsync }),
}));
vi.mock("../../../catalog/chat-presets", () => ({ useApplyUserStarredChatPreset: () => vi.fn(async () => undefined) }));
vi.mock("../../../../shared/api/remote-runtime", () => ({
  hasEmbeddedTauriRuntime: () => mocks.embedded.current,
  checkRemoteRuntimeHealth: (...args: unknown[]) => mocks.health(...args),
}));
vi.mock("../../../../shared/api/storage-api", () => ({
  storageApi: {
    get: vi.fn(),
    createChatMessage: vi.fn(),
    addChatMessageSwipe: vi.fn(),
  },
}));
vi.mock("../../../../shared/stores/setup-journey.store", () => {
  const state = { get intent() { return mocks.intent.current; }, markConnection: mocks.markConnection, markCompleted: mocks.markCompleted };
  const useSetupJourneyStore = (selector: (value: typeof state) => unknown) => selector(state);
  useSetupJourneyStore.getState = () => state;
  return { useSetupJourneyStore };
});
vi.mock("../../../../shared/stores/ui.store", () => {
  const state = { get remoteRuntimeUrl() { return mocks.runtimeUrl.current; }, setSettingsTab: vi.fn(), openRightPanel: vi.fn() };
  const useUIStore = (selector: (value: typeof state) => unknown) => selector(state);
  useUIStore.getState = () => state;
  return { useUIStore };
});
vi.mock("../../../../shared/stores/chat.store", () => ({ useChatStore: { getState: () => ({ setPendingNewChatMode: vi.fn(), setActiveChatId: vi.fn(), setNewChatSetupIntent: vi.fn() }) } }));

import { SetupReadinessJourney } from "./SetupReadinessJourney";

describe("SetupReadinessJourney", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    mocks.intent.current = { journeyId: "journey-1", mode: "conversation", originCharacterId: null, selectedConnectionId: null, dismissed: false, completed: false };
    mocks.embedded.current = false; mocks.mutateAsync.mockReset(); mocks.markCompleted.mockReset(); mocks.markConnection.mockReset();
    mocks.runtimeUrl.current = "https://runtime-a.test";
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  it("stays absent for a previously completed journey", () => {
    mocks.intent.current = { ...mocks.intent.current!, completed: true };
    act(() => root.render(<SetupReadinessJourney />));
    expect(container.textContent).toBe("");
  });

  it("does not offer or create chat before web runtime readiness", async () => {
    mocks.health.mockReturnValue(new Promise(() => undefined));
    await act(async () => root.render(<SetupReadinessJourney />));
    expect(container.textContent).not.toContain("Continue to chat");
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });

  it("completes the saved intent only after healthy runtime and provider readiness", async () => {
    mocks.health.mockResolvedValue({ status: "ok", message: "Ready", health: { ok: true, writable: true } });
    mocks.mutateAsync.mockResolvedValue({ id: "chat-1" });
    await act(async () => { root.render(<SetupReadinessJourney />); await Promise.resolve(); });
    const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes("Continue to chat"));
    expect(button).toBeTruthy();
    await act(async () => button!.click());
    expect(mocks.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ mode: "conversation", connectionId: "saved" }));
    expect(mocks.markCompleted).toHaveBeenCalled();
  });

  it("invalidates healthy readiness synchronously when the runtime target changes", async () => {
    let resolveB: (value: unknown) => void = () => undefined;
    mocks.health.mockImplementation((url: string) => url.includes("runtime-a")
      ? Promise.resolve({ status: "ok", message: "A ready", health: { ok: true, writable: true } })
      : new Promise((resolve) => { resolveB = resolve; }));
    await act(async () => { root.render(<SetupReadinessJourney />); await Promise.resolve(); });
    expect(container.textContent).toContain("Continue to chat");

    mocks.runtimeUrl.current = "https://runtime-b.test";
    flushSync(() => root.render(<SetupReadinessJourney />));
    expect(container.textContent).not.toContain("Continue to chat");
    expect(mocks.mutateAsync).not.toHaveBeenCalled();

    await act(async () => resolveB({ status: "ok", message: "B ready", health: { ok: true, writable: true } }));
    expect(container.textContent).toContain("Continue to chat");
  });
});
