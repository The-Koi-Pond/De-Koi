import { useEffect } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChatStore } from "../../../shared/stores/chat.store";
import { useUIStore } from "../../../shared/stores/ui.store";
import { useNavigateToChatFromShell } from "./chat-navigation";

const exitGameSetup = vi.fn();

vi.mock("../../modes/game/startup", () => ({
  useExitGameSetupFromShell: () => exitGameSetup,
}));

function NavigateProbe({ onReady }: { onReady: (navigate: (chatId: string) => void) => void }) {
  const navigate = useNavigateToChatFromShell();

  useEffect(() => {
    onReady(navigate);
  }, [navigate, onReady]);

  return null;
}

describe("useNavigateToChatFromShell", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    window.localStorage.clear();
    useChatStore.getState().reset();
    exitGameSetup.mockClear();
    useUIStore.setState({
      characterDetailId: "character-1",
      botBrowserOpen: true,
      editorDirty: true,
    });

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
    useChatStore.getState().reset();
    useUIStore.getState().closeAllDetails();
  });

  it("closes shell surfaces, exits game setup, and activates the selected chat", async () => {
    let navigate: ((chatId: string) => void) | null = null;

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

    act(() => {
      navigate?.("target-chat");
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
    expect(useUIStore.getState()).toMatchObject({
      characterDetailId: null,
      botBrowserOpen: false,
      editorDirty: false,
    });
  });
});
