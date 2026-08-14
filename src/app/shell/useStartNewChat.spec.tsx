import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  begin: vi.fn(),
  closeAllDetails: vi.fn(),
  createChat: { mutate: vi.fn(), isPending: false },
  intent: {
    current: null as null | {
      journeyId: string;
      mode: "conversation" | "roleplay" | "game";
      dismissed: boolean;
      completed: boolean;
    },
  },
  setPendingNewChatMode: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ fetchQuery: vi.fn().mockResolvedValue([{ id: "connection-1", provider: "openai" }]) }),
}));
vi.mock("../../features/catalog/chat-presets/index", () => ({
  useApplyUserStarredChatPreset: () => vi.fn(),
}));
vi.mock("../../features/catalog/chats/sidebar", () => ({
  useCreateChat: () => mocks.createChat,
}));
vi.mock("../../features/catalog/connections/index", () => ({ connectionKeys: { list: () => ["connections"] } }));
vi.mock("../../shared/api/remote-runtime", () => ({ checkRemoteRuntimeHealth: vi.fn() }));
vi.mock("../../shared/api/storage-api", () => ({ storageApi: { list: vi.fn() } }));
vi.mock("../../shared/stores/chat.store", () => {
  const state = {
    setActiveChatId: vi.fn(),
    setPendingNewChatMode: mocks.setPendingNewChatMode,
  };
  const useChatStore = (selector: (value: typeof state) => unknown) => selector(state);
  useChatStore.getState = () => ({ ...state, setNewChatSetupIntent: vi.fn() });
  return { useChatStore };
});
vi.mock("../../shared/stores/setup-journey.store", () => ({
  useSetupJourneyStore: {
    getState: () => ({ begin: mocks.begin, intent: mocks.intent.current }),
  },
}));
vi.mock("../../shared/stores/ui.store", () => {
  const state = {
    remoteRuntimeUrl: "",
    hasAnyDetailOpen: () => true,
    closeAllDetails: mocks.closeAllDetails,
  };
  return { useUIStore: (selector: (value: typeof state) => unknown) => selector(state) };
});

import { useStartNewChat } from "./useStartNewChat";

describe("useStartNewChat", () => {
  let container: HTMLDivElement;
  let root: Root;
  let startNewChat: ReturnType<typeof useStartNewChat>;

  function Harness() {
    startNewChat = useStartNewChat();
    return null;
  }

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    mocks.begin.mockReset();
    mocks.closeAllDetails.mockReset();
    mocks.createChat.mutate.mockReset();
    mocks.intent.current = null;
    mocks.setPendingNewChatMode.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    container.remove();
  });

  it("routes a ready embedded launch through the shared setup journey", async () => {
    act(() => root.render(<Harness />));

    await act(async () => startNewChat("conversation"));

    expect(mocks.closeAllDetails).toHaveBeenCalledOnce();
    expect(mocks.begin).toHaveBeenCalledWith("conversation");
    expect(mocks.setPendingNewChatMode).toHaveBeenCalledWith("conversation");
    expect(mocks.createChat.mutate).not.toHaveBeenCalled();
  });

  it("ignores repeat starts while a setup journey is already active", async () => {
    mocks.intent.current = {
      journeyId: "journey-1",
      mode: "conversation",
      dismissed: false,
      completed: false,
    };
    act(() => root.render(<Harness />));

    await act(async () => startNewChat("conversation"));

    expect(mocks.closeAllDetails).not.toHaveBeenCalled();
    expect(mocks.begin).not.toHaveBeenCalled();
    expect(mocks.setPendingNewChatMode).not.toHaveBeenCalled();
  });
});
