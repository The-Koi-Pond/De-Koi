import { useEffect } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChatStore } from "../../../shared/stores/chat.store";
import { useUIStore } from "../../../shared/stores/ui.store";
import {
  LOCAL_NOTIFICATION_ACTIVATION_EVENT,
  type LocalNotificationActivationDetail,
} from "../../../shared/lib/local-notifications";
import { registerAppCloseGuard, registerEditorDirtyAppCloseGuard } from "../../../shared/lib/app-close-guard";
import { useLocalNotificationNavigation, useNavigateToChatFromShell } from "./chat-navigation";

const exitGameSetup = vi.fn();
const dialogs = vi.hoisted(() => ({
  showConfirmDialog: vi.fn(),
}));

vi.mock("../../modes/game/startup", () => ({
  useExitGameSetupFromShell: () => exitGameSetup,
}));
vi.mock("../../../shared/lib/app-dialogs", () => dialogs);

type NavigateToChat = (chatId: string) => void | Promise<void>;

function NavigateProbe({ onReady }: { onReady: (navigate: NavigateToChat) => void }) {
  const navigate = useNavigateToChatFromShell();

  useEffect(() => {
    onReady(navigate);
  }, [navigate, onReady]);

  return null;
}

function LocalNotificationNavigationProbe() {
  useLocalNotificationNavigation();
  return null;
}

describe("useNavigateToChatFromShell", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  const guardCleanups: Array<() => void> = [];

  beforeEach(() => {
    window.localStorage.clear();
    useChatStore.getState().reset();
    exitGameSetup.mockClear();
    dialogs.showConfirmDialog.mockReset();
    dialogs.showConfirmDialog.mockResolvedValue(true);
    useUIStore.setState({
      characterDetailId: "character-1",
      botBrowserOpen: true,
      editorDirty: true,
    });
    guardCleanups.push(registerEditorDirtyAppCloseGuard(() => useUIStore.getState().editorDirty));

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
    while (guardCleanups.length > 0) guardCleanups.pop()?.();
    useChatStore.getState().reset();
    useUIStore.getState().closeAllDetails();
  });

  it("closes shell surfaces, exits game setup, and activates the selected chat", async () => {
    let navigate: NavigateToChat | null = null;

    act(() => {
      const chat = useChatStore.getState();
      chat.setPendingNewChatMode("game");
      chat.setShouldOpenSettings(true, "pending-chat");
      chat.setShouldOpenWizard(true, "pending-chat");
      chat.setShouldOpenWizardInShortcutMode(true, "pending-chat");
      chat.addNotification("target-chat", "Rin", null);
    });

    await act(async () => {
      root = createRoot(container!);
      root.render(<NavigateProbe onReady={(value) => (navigate = value)} />);
    });

    await act(async () => {
      await navigate?.("target-chat");
    });

    expect(useChatStore.getState()).toMatchObject({
      activeChatId: "target-chat",
      pendingNewChatMode: null,
      shouldOpenSettings: false,
      shouldOpenWizard: false,
      shouldOpenWizardInShortcutMode: false,
    });
    expect(useChatStore.getState().chatNotifications.has("target-chat")).toBe(false);
    expect(exitGameSetup).toHaveBeenCalledTimes(1);
    expect(dialogs.showConfirmDialog).toHaveBeenCalledWith({
      title: "Switch chats?",
      message: "An editor has unsaved changes. Continue anyway and discard them?",
      confirmLabel: "Switch anyway",
      cancelLabel: "Keep working",
      tone: "destructive",
    });
    expect(useUIStore.getState()).toMatchObject({
      characterDetailId: null,
      botBrowserOpen: false,
      editorDirty: false,
    });
  });

  it("does nothing when the selected chat is already active", async () => {
    let navigate: NavigateToChat | null = null;
    useChatStore.getState().setActiveChatId("target-chat");

    await act(async () => {
      root = createRoot(container!);
      root.render(<NavigateProbe onReady={(value) => (navigate = value)} />);
    });

    await act(async () => {
      await navigate?.("target-chat");
    });

    expect(dialogs.showConfirmDialog).not.toHaveBeenCalled();
    expect(exitGameSetup).not.toHaveBeenCalled();
    expect(useUIStore.getState()).toMatchObject({
      characterDetailId: "character-1",
      botBrowserOpen: true,
      editorDirty: true,
    });
  });

  it("keeps the editor and current chat when discarding is canceled", async () => {
    let navigate: NavigateToChat | null = null;
    dialogs.showConfirmDialog.mockResolvedValue(false);

    await act(async () => {
      root = createRoot(container!);
      root.render(<NavigateProbe onReady={(value) => (navigate = value)} />);
    });

    await act(async () => {
      await navigate?.("target-chat");
    });

    expect(useChatStore.getState().activeChatId).toBeNull();
    expect(exitGameSetup).not.toHaveBeenCalled();
    expect(useUIStore.getState()).toMatchObject({
      characterDetailId: "character-1",
      botBrowserOpen: true,
      editorDirty: true,
    });
  });

  it("keeps the current chat when a non-editor pending-work guard is canceled", async () => {
    let navigate: NavigateToChat | null = null;
    useUIStore.setState({ editorDirty: false });
    dialogs.showConfirmDialog.mockResolvedValue(false);
    guardCleanups.push(
      registerAppCloseGuard({
        label: "Conversation upload",
        hasPendingWork: () => true,
        message: "A conversation attachment is still being prepared.",
        purposes: ["navigation"],
      }),
    );

    await act(async () => {
      root = createRoot(container!);
      root.render(<NavigateProbe onReady={(value) => (navigate = value)} />);
    });

    await act(async () => {
      await navigate?.("target-chat");
    });

    expect(dialogs.showConfirmDialog).toHaveBeenCalledWith({
      title: "Switch chats?",
      message: "A conversation attachment is still being prepared.",
      confirmLabel: "Switch anyway",
      cancelLabel: "Keep working",
      tone: "destructive",
    });
    expect(useChatStore.getState().activeChatId).toBeNull();
    expect(exitGameSetup).not.toHaveBeenCalled();
  });

  it("routes notification activation through the central non-editor pending-work guard", async () => {
    useUIStore.setState({ editorDirty: false });
    dialogs.showConfirmDialog.mockResolvedValue(false);
    guardCleanups.push(
      registerAppCloseGuard({
        label: "Conversation upload",
        hasPendingWork: () => true,
        message: "A conversation attachment is still being prepared.",
        purposes: ["navigation"],
      }),
    );

    await act(async () => {
      root = createRoot(container!);
      root.render(<LocalNotificationNavigationProbe />);
    });

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent<LocalNotificationActivationDetail>(LOCAL_NOTIFICATION_ACTIVATION_EVENT, {
          detail: { chatId: "notified-chat" },
        }),
      );
      await Promise.resolve();
    });

    expect(dialogs.showConfirmDialog).toHaveBeenCalledWith({
      title: "Switch chats?",
      message: "A conversation attachment is still being prepared.",
      confirmLabel: "Switch anyway",
      cancelLabel: "Keep working",
      tone: "destructive",
    });
    expect(useChatStore.getState().activeChatId).toBeNull();
    expect(exitGameSetup).not.toHaveBeenCalled();
  });
});
