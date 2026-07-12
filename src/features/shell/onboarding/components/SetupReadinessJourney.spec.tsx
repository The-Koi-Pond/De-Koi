import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  intent: { current: null as null | { mode: "conversation"; originCharacterId: null; selectedConnectionId: string | null; dismissed: boolean; completed: boolean } },
  embedded: { current: false },
  health: vi.fn(),
  connections: { current: [{ id: "saved", provider: "openai", model: "gpt" }] },
  mutate: vi.fn(),
  markConnection: vi.fn(),
  markCompleted: vi.fn(),
}));

vi.mock("../../../catalog/connections", () => ({ useConnections: (enabled: boolean) => ({ data: enabled ? mocks.connections.current : [] }) }));
vi.mock("../../../catalog/chats", () => ({ useCreateChat: () => ({ mutate: mocks.mutate }) }));
vi.mock("../../../catalog/chat-presets", () => ({ useApplyUserStarredChatPreset: () => vi.fn(async () => undefined) }));
vi.mock("../../../../shared/api/remote-runtime", () => ({
  hasEmbeddedTauriRuntime: () => mocks.embedded.current,
  checkRemoteRuntimeHealth: (...args: unknown[]) => mocks.health(...args),
}));
vi.mock("../../../../shared/stores/setup-journey.store", () => {
  const state = { get intent() { return mocks.intent.current; }, markConnection: mocks.markConnection, markCompleted: mocks.markCompleted };
  const useSetupJourneyStore = (selector: (value: typeof state) => unknown) => selector(state);
  useSetupJourneyStore.getState = () => state;
  return { useSetupJourneyStore };
});
vi.mock("../../../../shared/stores/ui.store", () => {
  const state = { remoteRuntimeUrl: "https://runtime.test", setSettingsTab: vi.fn(), openRightPanel: vi.fn() };
  const useUIStore = (selector: (value: typeof state) => unknown) => selector(state);
  useUIStore.getState = () => state;
  return { useUIStore };
});
vi.mock("../../../../shared/stores/chat.store", () => ({ useChatStore: { getState: () => ({ setPendingNewChatMode: vi.fn(), setActiveChatId: vi.fn(), setShouldOpenSettings: vi.fn(), setShouldOpenWizard: vi.fn() }) } }));

import { SetupReadinessJourney } from "./SetupReadinessJourney";

describe("SetupReadinessJourney", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    mocks.intent.current = { mode: "conversation", originCharacterId: null, selectedConnectionId: null, dismissed: false, completed: false };
    mocks.embedded.current = false; mocks.mutate.mockReset(); mocks.markCompleted.mockReset(); mocks.markConnection.mockReset();
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
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("completes the saved intent only after healthy runtime and provider readiness", async () => {
    mocks.health.mockResolvedValue({ status: "ok", message: "Ready", health: { ok: true, writable: true } });
    mocks.mutate.mockImplementation((_input, options) => options.onSuccess({ id: "chat-1" }));
    await act(async () => { root.render(<SetupReadinessJourney />); await Promise.resolve(); });
    const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes("Continue to chat"));
    expect(button).toBeTruthy();
    await act(async () => button!.click());
    expect(mocks.mutate).toHaveBeenCalledWith(expect.objectContaining({ mode: "conversation", connectionId: "saved" }), expect.any(Object));
    expect(mocks.markCompleted).toHaveBeenCalled();
  });
});
