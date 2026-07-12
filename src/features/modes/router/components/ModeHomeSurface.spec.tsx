import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HOME_SPLASH_TEXTS, ModeHomeSurface, pickHomeSplashText } from "./ModeHomeSurface";

const { connectionRows, createChatMutate } = vi.hoisted(() => ({ connectionRows: { current: [] as Array<{ id: string; provider: string }> }, createChatMutate: vi.fn() }));
vi.mock("../../../catalog/connections/index", () => ({ useConnections: () => ({ data: connectionRows.current }) }));

vi.mock("../../../catalog/chats/index", () => ({
  useCreateChat: () => ({ mutate: createChatMutate }),
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

const { beginSetupJourney } = vi.hoisted(() => ({ beginSetupJourney: vi.fn() }));
vi.mock("../../../../shared/stores/setup-journey.store", () => ({
  useSetupJourneyStore: { getState: () => ({ begin: beginSetupJourney }) },
}));

describe("ModeHomeSurface launch splash", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    connectionRows.current = [];
    createChatMutate.mockClear();
    beginSetupJourney.mockClear();
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
    expect([...HOME_SPLASH_TEXTS].map((text) => `Launch splash: ${text}`)).toContain(
      splash?.getAttribute("aria-label") ?? "",
    );
    expect(splash?.querySelectorAll(".koi-home-splash-letter").length).toBeGreaterThan(0);
  });

  it("runs the splash bounce twice while retaining reduced-motion opt out", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles/globals/04-surfaces-components.css"), "utf8");

    expect(css).toMatch(/\.koi-home-splash-letter\s*\{[^}]*animation:[^;]* 2;/);
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.koi-home-splash-letter\s*\{[^}]*animation:\s*none;/,
    );
  });
});

describe("ModeHomeSurface quick-start prewarming", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let requestIdleCallbackSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    connectionRows.current = [];
    createChatMutate.mockClear();
    beginSetupJourney.mockClear();
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

  it("records mode intent before opening the prerequisite detour", async () => {
    await act(async () => {
      root = createRoot(container!);
      root.render(<ModeHomeSurface />);
    });
    const button = Array.from(container!.querySelectorAll("button")).find((item) => item.getAttribute("aria-label") === "Start Conversation chat");
    act(() => button!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(beginSetupJourney).toHaveBeenCalledWith("conversation");
  });

  it("never creates a chat directly before the shared journey proves runtime readiness", async () => {
    connectionRows.current = [{ id: "saved", provider: "openai" }];
    await act(async () => {
      root = createRoot(container!);
      root.render(<ModeHomeSurface />);
    });
    const button = Array.from(container!.querySelectorAll("button")).find((item) => item.getAttribute("aria-label") === "Start Roleplay chat");
    act(() => button!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(beginSetupJourney).toHaveBeenCalledWith("roleplay");
    expect(createChatMutate).not.toHaveBeenCalled();
  });
});
