import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HOME_SPLASH_TEXTS, ModeHomeSurface, pickHomeSplashText } from "./ModeHomeSurface";

vi.mock("../../../catalog/connections/index", () => ({
  useConnections: () => ({ data: [] }),
}));

vi.mock("../../../catalog/chats/index", () => ({
  useCreateChat: () => ({ mutate: vi.fn() }),
}));

vi.mock("../../../catalog/chat-presets/index", () => ({
  useApplyUserStarredChatPreset: () => vi.fn(),
}));

vi.mock("../../shared/chat-ui/index", () => ({
  NewChatConnectionGate: () => null,
}));

vi.mock("./HomeCreditsModal", () => ({
  HomeCreditsModal: () => null,
}));

vi.mock("./RecentChats", () => ({
  RecentChats: () => null,
}));

vi.mock("../../../../shared/stores/chat.store", () => {
  const state = {
    pendingNewChatMode: null,
    setPendingNewChatMode: vi.fn(),
    setActiveChatId: vi.fn(),
    setShouldOpenSettings: vi.fn(),
    setShouldOpenWizard: vi.fn(),
  };
  const useChatStore = (selector: (value: typeof state) => unknown) => selector(state);
  useChatStore.getState = () => state;
  return { useChatStore };
});

vi.mock("../../../../shared/stores/ui.store", () => {
  const state = {
    setHasCompletedOnboarding: vi.fn(),
  };
  const useUIStore = (selector: (value: typeof state) => unknown) => selector(state);
  useUIStore.getState = () => state;
  return { useUIStore };
});

describe("ModeHomeSurface launch splash", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
    vi.restoreAllMocks();
  });

  it("maps random launch values to bundled splash text", () => {
    expect(pickHomeSplashText(() => 0)).toBe(HOME_SPLASH_TEXTS[0]);
    expect(pickHomeSplashText(() => 0.999)).toBe(HOME_SPLASH_TEXTS[HOME_SPLASH_TEXTS.length - 1]);
    expect(pickHomeSplashText(() => 1)).toBe(HOME_SPLASH_TEXTS[HOME_SPLASH_TEXTS.length - 1]);
  });

  it("renders one bundled splash saying on the home surface", async () => {
    await act(async () => {
      root = createRoot(container!);
      root.render(<ModeHomeSurface />);
    });

    const splash = container!.querySelector(".koi-home-splash");
    expect(splash).toBeTruthy();
    expect([...HOME_SPLASH_TEXTS]).toContain(splash?.textContent ?? "");
  });
});

describe("ModeHomeSurface quick-start prewarming", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let requestIdleCallbackSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    requestIdleCallbackSpy = vi.fn();
    Object.defineProperty(window, "requestIdleCallback", {
      configurable: true,
      value: requestIdleCallbackSpy,
    });
    Object.defineProperty(window, "cancelIdleCallback", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
    Reflect.deleteProperty(window, "requestIdleCallback");
    Reflect.deleteProperty(window, "cancelIdleCallback");
    vi.restoreAllMocks();
  });

  it("does not schedule heavy mode bundle prewarming on mount", async () => {
    await act(async () => {
      root = createRoot(container!);
      root.render(<ModeHomeSurface />);
    });

    expect(requestIdleCallbackSpy).not.toHaveBeenCalled();
  });

  it("offers a no-model showcase when no language connections exist", async () => {
    const onOpenNoModelShowcase = vi.fn();

    await act(async () => {
      root = createRoot(container!);
      root.render(<ModeHomeSurface onOpenNoModelShowcase={onOpenNoModelShowcase} />);
    });

    const button = Array.from(container!.querySelectorAll("button")).find((item) =>
      item.textContent?.includes("Explore sample world"),
    );
    expect(button).toBeTruthy();

    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onOpenNoModelShowcase).toHaveBeenCalledTimes(1);
  });
});