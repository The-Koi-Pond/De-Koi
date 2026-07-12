import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ begin: vi.fn(), intent: { current: { mode: "conversation", originCharacterId: null, selectedConnectionId: "saved", dismissed: false, completed: true } } }));
vi.mock("../../../../../shared/stores/setup-journey.store", () => {
  const state = { get intent() { return mocks.intent.current; }, begin: mocks.begin };
  const useSetupJourneyStore = (selector: (value: typeof state) => unknown) => selector(state);
  useSetupJourneyStore.getState = () => state;
  return { useSetupJourneyStore };
});
import { NewChatConnectionGate } from "./NewChatConnectionGate";

describe("NewChatConnectionGate", () => {
  afterEach(() => mocks.begin.mockReset());
  it("starts a fresh journey only when a completed user makes a blocked mode request", () => {
    const host = document.createElement("div"); const root = createRoot(host);
    act(() => root.render(<NewChatConnectionGate mode="roleplay" onClose={vi.fn()} />));
    expect(mocks.begin).toHaveBeenCalledWith("roleplay");
    expect(host.textContent).toBe("");
    act(() => root.unmount());
  });
});
