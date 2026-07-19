import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationModeRoute } from "./ConversationModeRoute";

const {
  deleteChatMock,
  dispatchMusicPlaybackEventMock,
  enabledChatAgentIdsMock,
  handleRetryAgentMock,
  setActiveChatIdMock,
  timelineState,
  useChatSurfaceDataMock,
} = vi.hoisted(() => ({
  deleteChatMock: { mutateAsync: vi.fn() },
  dispatchMusicPlaybackEventMock: vi.fn(),
  enabledChatAgentIdsMock: vi.fn(),
  handleRetryAgentMock: vi.fn(),
  setActiveChatIdMock: vi.fn(),
  timelineState: { agentProcessing: false, isStreaming: false },
  useChatSurfaceDataMock: vi.fn(),
}));

vi.mock("../../../../engine/contracts/types/agent", () => ({
  enabledChatAgentIds: enabledChatAgentIdsMock,
}));

vi.mock("../../../../shared/lib/music-playback-events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../shared/lib/music-playback-events")>();
  return {
    ...actual,
    dispatchMusicPlaybackEvent: dispatchMusicPlaybackEventMock,
  };
});

vi.mock("../../../../shared/stores/chat.store", () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      pendingNewChatMode: null,
      setActiveChatId: setActiveChatIdMock,
    }),
}));

vi.mock("../../../../shared/stores/ui.store", () => ({
  useUIStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      messagesPerPage: 50,
    }),
}));

vi.mock("../../../catalog/chats/index", () => ({
  useDeleteChat: () => deleteChatMock,
}));

vi.mock("../hooks/use-conversation-avatar-overrides", () => ({
  useConversationAvatarOverrides: (characterMap: unknown) => characterMap,
}));

vi.mock("../../shared/chat-ui/index", () => ({
  CreatorNotesCssInjector: () => null,
  NewChatConnectionGate: () => null,
  isEmptyNewChatSetup: () => false,
  useChatMetadataSync: () => ({ chatBackground: null }),
  useChatOverlays: () => ({
    settingsOpen: false,
    filesOpen: false,
    galleryOpen: false,
    wizardOpen: false,
    spriteArrangeMode: false,
    newChatSetupChatId: null,
    setWizardOpen: vi.fn(),
    clearNewChatSetup: vi.fn(),
    finishWizard: vi.fn(),
    openSettings: vi.fn(),
    openFiles: vi.fn(),
    openGallery: vi.fn(),
    closeSettings: vi.fn(),
    closeFiles: vi.fn(),
    closeGallery: vi.fn(),
    toggleSpriteArrange: vi.fn(),
  }),
  useChatSurfaceData: useChatSurfaceDataMock,
  useChatTimelineActions: () => ({
    multiSelectMode: false,
    deleteDialogMessageId: null,
    deleteDialogCanDeleteSwipe: false,
    deleteDialogActiveSwipeIndex: 0,
    deleteDialogSwipeCount: 1,
    peekPromptData: null,
    agentProcessing: timelineState.agentProcessing,
    isStreaming: timelineState.isStreaming,
    latestAssistantMessageForSwipes: null,
    latestMessageForEdit: null,
    lastAssistantMessageId: null,
    selectedMessageIds: new Set(),
    handleSetActiveSwipe: vi.fn(),
    handleRegenerate: vi.fn(),
    handleRetryAgent: handleRetryAgentMock,
    handleEdit: vi.fn(),
    handleDelete: vi.fn(),
    handleToggleHiddenFromAI: vi.fn(),
    handleBranch: vi.fn(),
    handleToggleSelectMessage: vi.fn(),
    handlePeekPrompt: vi.fn(),
    handleIllustrate: vi.fn(),
    closePeekPrompt: vi.fn(),
    handleDeleteConfirm: vi.fn(),
    handleDeleteSwipe: vi.fn(),
    handleDeleteMore: vi.fn(),
    closeDeleteDialog: vi.fn(),
    handleBulkDelete: vi.fn(),
    handleCancelMultiSelect: vi.fn(),
    handleUnselectAllMessages: vi.fn(),
    handleSelectAllAboveSelection: vi.fn(),
    handleSelectAllBelowSelection: vi.fn(),
  }),
  useChatTranscriptShortcuts: vi.fn(),
  useChatTtsAutoplay: vi.fn(),
  useSpriteMetadataState: () => ({
    handleResetSpritePlacements: vi.fn(),
    handleSetSpritePosition: vi.fn(),
  }),
}));

vi.mock("./ChatConversationSurface", () => ({
  ChatConversationSurface: () => <div data-testid="conversation-surface" />,
}));

function makeConversationSurfaceData() {
  const messages = [
    { id: "m1", role: "assistant", content: "The rain keeps tapping the window while everyone studies." },
  ];
  return {
    allCharacters: [],
    characterMap: new Map(),
    characterNames: ["Chai"],
    chat: { id: "chat-1", name: "Late Night DMs", mode: "conversation" },
    chatCharIds: [],
    chatList: [],
    chatMeta: {},
    chatMode: "conversation",
    connectedChatName: null,
    dataUpdatedAt: 1,
    hasNextPage: false,
    isFetchingNextPage: false,
    isLoading: false,
    messageIdByOrderIndex: new Map(),
    messages,
    pageCount: 1,
    personaInfo: { name: "Celia" },
    totalMessageCount: messages.length,
    fetchNextPage: vi.fn(),
  };
}

describe("ConversationModeRoute music context", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    enabledChatAgentIdsMock.mockReturnValue([]);
    timelineState.agentProcessing = false;
    timelineState.isStreaming = false;
    useChatSurfaceDataMock.mockReturnValue(makeConversationSurfaceData());
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
    vi.clearAllMocks();
  });

  it("clears conversation music context for the mini-player instead of inferring keywords", async () => {
    await act(async () => {
      root = createRoot(container!);
      root.render(<ConversationModeRoute activeChatId="chat-1" />);
    });

    expect(dispatchMusicPlaybackEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "context",
        query: null,
      }),
    );
  });

  it("routes Fresh Music Player requests through the AI Music Player agent", async () => {
    handleRetryAgentMock.mockResolvedValue(undefined);
    await act(async () => {
      root = createRoot(container!);
      root.render(<ConversationModeRoute activeChatId="chat-1" />);
    });

    const complete = vi.fn();
    const event = new CustomEvent("de-koi:music-ai-pick-request", {
      cancelable: true,
      detail: { complete },
    });
    await act(async () => {
      window.dispatchEvent(event);
      await Promise.resolve();
    });

    expect(event.defaultPrevented).toBe(true);
    expect(handleRetryAgentMock).toHaveBeenCalledWith("music-dj");
    expect(complete).toHaveBeenCalledWith({ status: "completed" });
  });

  it("rejects Fresh Music Player requests instead of accepting them while another agent is running", async () => {
    timelineState.agentProcessing = true;
    await act(async () => {
      root = createRoot(container!);
      root.render(<ConversationModeRoute activeChatId="chat-1" />);
    });

    const complete = vi.fn();
    const event = new CustomEvent("de-koi:music-ai-pick-request", {
      cancelable: true,
      detail: { complete },
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(handleRetryAgentMock).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledWith({
      status: "failed",
      message: "Music Player can't start while another response or agent is still running.",
    });
  });
});
