import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
  chat: {
    id: "chat-harlequin",
    name: "Harlequin",
    mode: "conversation",
    characterIds: ["harlequin"],
    metadata: { conversationStatusMessagesEnabled: true } as Record<string, unknown>,
  },
  characters: [
    {
      id: "harlequin",
      data: {
        name: "Harlequin",
        extensions: {
          conversationStatus: "online",
          conversationStatusMessage: "thinking about what you said. still.",
          conversationActivity: "unknown (no schedule)",
          conversationAvailabilityExplanation: "Available: unknown (no schedule).",
        },
      },
    },
  ],
  setActiveChatId: vi.fn(),
  closeRightPanel: vi.fn(),
  setTrackerPanelOpen: vi.fn(),
  closeAllDetails: vi.fn(),
  settings: { statusMessagesEnabledByDefault: false },
}));

vi.mock("../../features/catalog/chats/index", () => ({
  useChat: () => ({ data: fixtures.chat }),
}));

vi.mock("../../features/catalog/characters/index", () => ({
  CharacterAvatarImage: () => null,
  useChatSurfaceCharacterSummariesByIds: () => ({ data: fixtures.characters }),
}));

vi.mock("../../shared/stores/chat.store", () => ({
  useChatStore: (
    selector: (state: {
      activeChatId: string;
      activeChat: typeof fixtures.chat;
      setActiveChatId: typeof fixtures.setActiveChatId;
    }) => unknown,
  ) =>
    selector({
      activeChatId: fixtures.chat.id,
      activeChat: fixtures.chat,
      setActiveChatId: fixtures.setActiveChatId,
    }),
}));

vi.mock("../../shared/stores/ui.store", () => ({
  useUIStore: (
    selector: (state: {
      closeRightPanel: typeof fixtures.closeRightPanel;
      setTrackerPanelOpen: typeof fixtures.setTrackerPanelOpen;
      closeAllDetails: typeof fixtures.closeAllDetails;
    }) => unknown,
  ) =>
    selector({
      closeRightPanel: fixtures.closeRightPanel,
      setTrackerPanelOpen: fixtures.setTrackerPanelOpen,
      closeAllDetails: fixtures.closeAllDetails,
    }),
}));

vi.mock("../../shared/components/mobile-shell-actions", () => ({
  useTopBarActions: () => ({ rightSlot: null }),
}));

vi.mock("../../shared/api/conversation-settings-api", () => ({
  conversationSettingsKeys: { settings: ["conversation-settings"] },
  conversationSettingsApi: {
    settings: {
      get: () => Promise.resolve(fixtures.settings),
    },
  },
}));

import { TopBar } from "./TopBar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("TopBar conversation status", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    fixtures.chat.metadata = { conversationStatusMessagesEnabled: true };
    fixtures.settings.statusMessagesEnabledByDefault = false;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
    vi.clearAllMocks();
  });

  it("shows the generated character status message instead of the no-schedule placeholder", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TopBar />
        </QueryClientProvider>,
      );
    });

    expect(container.textContent).toContain("thinking about what you said. still.");
    expect(container.textContent).not.toContain("unknown (no schedule)");
  });

  it("shows generated status messages enabled by the global conversation default", async () => {
    fixtures.chat.metadata = {};
    fixtures.settings.statusMessagesEnabledByDefault = true;
    queryClient.setQueryData(["conversation-settings"], fixtures.settings);

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TopBar />
        </QueryClientProvider>,
      );
    });

    expect(container.textContent).toContain("thinking about what you said. still.");
    expect(container.textContent).not.toContain("unknown (no schedule)");
  });
});
