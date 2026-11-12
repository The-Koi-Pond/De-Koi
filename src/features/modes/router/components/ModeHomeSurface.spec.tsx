import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HOME_SPLASH_TEXTS, ModeHomeSurface, pickHomeSplashText } from "./ModeHomeSurface";

const { connectionRows, createChatMutate } = vi.hoisted(() => ({
  connectionRows: { current: [] as Array<{ id: string; provider: string; model?: string; hasApiKey?: boolean }> },
  createChatMutate: vi.fn(),
}));
const { embeddedRuntime } = vi.hoisted(() => ({ embeddedRuntime: { current: true } }));
const { libraryPresence } = vi.hoisted(() => ({
  libraryPresence: {
    current: { status: "loading", isEmpty: null } as {
      status: "loading" | "error" | "empty" | "populated";
      isEmpty: boolean | null;
    },
  },
}));
vi.mock("../../../catalog/connections/index", () => ({ useConnections: () => ({ data: connectionRows.current }) }));
vi.mock("../../../catalog/library-presence", () => ({ useLibraryPresence: () => libraryPresence.current }));
vi.mock("../../../../shared/api/remote-runtime", () => ({ hasEmbeddedTauriRuntime: () => embeddedRuntime.current }));

vi.mock("../../../catalog/chats/index", () => ({
  useCreateChat: () => ({ mutate: createChatMutate }),
}));

vi.mock("../../../catalog/chat-presets/index", () => ({
  useApplyUserStarredChatPreset: () => vi.fn(),
}));

vi.mock("../../shared/chat-ui/new-chat-gate", () => ({
  NewChatConnectionGate: () => null,
}));

vi.mock("./RecentChats", () => ({
  RecentChats: () => <div data-testid="recent-chats">Recent chats</div>,
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

const { openRightPanel, uiVisualTheme } = vi.hoisted(() => ({
  openRightPanel: vi.fn(),
  uiVisualTheme: { current: "default" as "default" | "pond" },
}));
vi.mock("../../../../shared/stores/ui.store", () => {
  const state = {
    remoteRuntimeUrl: "",
    setHasCompletedOnboarding: vi.fn(),
    openRightPanel,
    get visualTheme() {
      return uiVisualTheme.current;
    },
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
    embeddedRuntime.current = true;
    connectionRows.current = [];
    createChatMutate.mockClear();
    beginSetupJourney.mockClear();
    openRightPanel.mockClear();
    libraryPresence.current = { status: "loading", isEmpty: null };
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
    expect(splash?.hasAttribute("aria-label")).toBe(false);
    expect([...HOME_SPLASH_TEXTS].map((text) => `Launch splash: ${text}`)).toContain(
      splash?.querySelector(".sr-only")?.textContent ?? "",
    );
    expect(splash?.querySelectorAll(".koi-home-splash-letter").length).toBeGreaterThan(0);
  });

  it("keeps each splash word whole, so long lines wrap between words", async () => {
    const longSplash = '"We have AI roleplay at home!" (AI roleplay at home:)';
    vi.spyOn(Math, "random").mockReturnValue(HOME_SPLASH_TEXTS.indexOf(longSplash) / HOME_SPLASH_TEXTS.length);
    await act(async () => {
      root = createRoot(container!);
      root.render(<ModeHomeSurface />);
    });

    const words = [...container!.querySelectorAll(".koi-home-splash-word")].map((word) => word.textContent ?? "");
    expect(words.join(" ")).toBe(longSplash);
    expect(words.every((word) => !word.includes(" "))).toBe(true);
  });

  it("keeps the plain logo outside the Pond theme", async () => {
    await act(async () => {
      root = createRoot(container!);
      root.render(<ModeHomeSurface />);
    });
    expect(container!.querySelector(".koi-ring")).toBeNull();
    expect(container!.querySelector(".deki-home-bubble")).toBeNull();
    expect(container!.querySelector(".koi-home-logo")).toBeTruthy();
  });

  it("puts Deki in the koi ring in the Pond theme and lets them explain the mode you point at", async () => {
    uiVisualTheme.current = "pond";
    const onOpenDiscover = vi.fn();
    try {
      await act(async () => {
        root = createRoot(container!);
        root.render(<ModeHomeSurface onOpenDiscover={onOpenDiscover} />);
      });
      const ring = container!.querySelector(".koi-ring");
      expect(ring?.querySelector("img.koi-ring-deki-live")?.getAttribute("src")).toBe("/deki-steady.svg");
      expect(ring?.querySelector(".koi-home-splash")).toBeTruthy();
      expect(ring?.querySelectorAll("[data-koi-orbit]")).toHaveLength(3);

      // The modes are a visual-novel choice menu instead of cards, with recent
      // chats under them, and no "Next steps" grid.
      expect(container!.querySelectorAll(".vn-choice")).toHaveLength(3);
      expect(container!.querySelector(".koi-start-card")).toBeNull();
      expect(
        [...container!.querySelectorAll("[data-home-section]")].map((s) => s.getAttribute("data-home-section")),
      ).toEqual(["readiness", "mode-cards", "recent-chats"]);

      // Deki's quick menu: the pending setup step, and Discover.
      const actions = [...container!.querySelectorAll<HTMLButtonElement>(".deki-home-action")];
      expect(actions.map((button) => button.textContent)).toEqual(["Connect a model", "Discover"]);
      act(() => actions[0]!.click());
      expect(openRightPanel).toHaveBeenCalledWith("connections");
      act(() => actions[1]!.click());
      expect(onOpenDiscover).toHaveBeenCalledTimes(1);

      // With no model connection yet, Deki points at that first.
      const bubble = container!.querySelector(".deki-home-bubble");
      expect(bubble?.textContent).toMatch(/Connect a model first/);

      // Each choice is named by its visible text and described by Deki's explanation.
      const roleplayChoice = container!.querySelector<HTMLButtonElement>('.vn-choice[data-mode="roleplay"]')!;
      expect(roleplayChoice.textContent).toBe("Let's play out a story!Roleplay");
      expect(roleplayChoice.hasAttribute("aria-label")).toBe(false);
      const description = document.getElementById(roleplayChoice.getAttribute("aria-describedby") ?? "");
      expect(description?.textContent).toMatch(/^Roleplay:/);

      await act(async () => {
        roleplayChoice.focus();
      });
      expect(bubble?.textContent).toMatch(/^Roleplay:/);

      await act(async () => {
        roleplayChoice.blur();
      });
      expect(bubble?.textContent).toMatch(/Connect a model first/);

      // Picking a choice starts that mode, like the cards do in other themes.
      await act(async () => {
        container!.querySelector<HTMLButtonElement>('.vn-choice[data-mode="fanfic"]')!.click();
      });
      expect(beginSetupJourney).toHaveBeenCalledWith("fanfic");
    } finally {
      uiVisualTheme.current = "default";
    }
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
    embeddedRuntime.current = true;
    connectionRows.current = [];
    createChatMutate.mockClear();
    beginSetupJourney.mockClear();
    openRightPanel.mockClear();
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

  it("offers to add a model connection when no language connections exist", async () => {
    await act(async () => {
      root = createRoot(container!);
      root.render(<ModeHomeSurface />);
    });

    const button = Array.from(container!.querySelectorAll("button")).find((item) =>
      item.textContent?.includes("Add a model connection"),
    );
    expect(button).toBeTruthy();

    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(openRightPanel).toHaveBeenCalledWith("connections");
  });

  it("renders at most three contextual journeys and opens dedicated Discover", async () => {
    const onOpenDiscover = vi.fn();
    await act(async () => {
      root = createRoot(container!);
      root.render(<ModeHomeSurface hasActivity onOpenDiscover={onOpenDiscover} />);
    });

    expect(container!.querySelectorAll("[data-home-suggestion]").length).toBeLessThanOrEqual(3);
    expect(container!.textContent).not.toMatch(/features tracked|coverage|Browse all 40/i);
    const discoverButton = Array.from(container!.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Open Discover"),
    );
    act(() => discoverButton?.click());
    expect(onOpenDiscover).toHaveBeenCalledTimes(1);
  });

  it("orders readiness, recent chats, mode cards, then contextual suggestions", async () => {
    await act(async () => {
      root = createRoot(container!);
      root.render(<ModeHomeSurface readinessSurface={<div data-testid="readiness">Continue setup</div>} />);
    });
    const sections = Array.from(container!.querySelectorAll("[data-home-section]")).map((node) =>
      node.getAttribute("data-home-section"),
    );
    expect(sections).toEqual(["readiness", "recent-chats", "mode-cards", "suggestions"]);
    expect(container!.querySelector('[data-home-section="readiness"] [data-testid="readiness"]')).toBeTruthy();
    expect(container!.querySelector('[data-home-section="recent-chats"] [data-testid="recent-chats"]')).toBeTruthy();
  });

  it("prioritizes server setup from production web readiness facts", async () => {
    embeddedRuntime.current = false;
    await act(async () => {
      root = createRoot(container!);
      root.render(<ModeHomeSurface />);
    });
    expect(container!.querySelector("[data-home-suggestion]")?.textContent).toContain("Connect to your De-Koi server");
  });

  it("does not claim an unknown library is empty just because there are no chats", async () => {
    await act(async () => {
      root = createRoot(container!);
      root.render(<ModeHomeSurface hasActivity={false} />);
    });
    expect(container!.textContent).not.toContain("Import your library");
  });

  it("recommends import after every library collection is known empty", async () => {
    libraryPresence.current = { status: "empty", isEmpty: true };
    await act(async () => {
      root = createRoot(container!);
      root.render(<ModeHomeSurface />);
    });

    expect(container!.textContent).toContain("Import your library");
  });

  it("records mode intent before opening the prerequisite detour", async () => {
    await act(async () => {
      root = createRoot(container!);
      root.render(<ModeHomeSurface />);
    });
    const button = Array.from(container!.querySelectorAll("button")).find(
      (item) => item.getAttribute("aria-label") === "Start Conversation chat",
    );
    act(() => button!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(beginSetupJourney).toHaveBeenCalledWith("conversation");
  });

  it("never creates a chat directly before the shared journey proves runtime readiness", async () => {
    connectionRows.current = [{ id: "saved", provider: "openai" }];
    await act(async () => {
      root = createRoot(container!);
      root.render(<ModeHomeSurface />);
    });
    const button = Array.from(container!.querySelectorAll("button")).find(
      (item) => item.getAttribute("aria-label") === "Start Roleplay chat",
    );
    act(() => button!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(beginSetupJourney).toHaveBeenCalledWith("roleplay");
    expect(createChatMutate).not.toHaveBeenCalled();
  });

  it("keeps offering Add a model connection while the only connection has no model yet", async () => {
    connectionRows.current = [{ id: "new", provider: "openrouter", model: "" }];
    await act(async () => {
      root = createRoot(container!);
      root.render(<ModeHomeSurface />);
    });
    expect(container!.textContent).toContain("Add a model connection");
  });

  it("drops Add a model connection once a connection has a model", async () => {
    connectionRows.current = [{ id: "ready", provider: "openrouter", model: "openrouter/auto", hasApiKey: true }];
    await act(async () => {
      root = createRoot(container!);
      root.render(<ModeHomeSurface />);
    });
    expect(container!.textContent).not.toContain("Add a model connection");
  });
});
