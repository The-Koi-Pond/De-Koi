import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatStore } from "../../../../shared/stores/chat.store";
import { useUIStore } from "../../../../shared/stores/ui.store";
import { DISCOVERY_APP_EVENT } from "../../../../shared/lib/discovery-navigation";
import { getDiscoveryActionLabel, resolveDiscoveryAction, runDiscoveryAction } from "./discovery-actions";

describe("settings discovery actions", () => {
  beforeEach(() => {
    useChatStore.getState().reset();
    useUIStore.setState({ rightPanelOpen: false, settingsTab: "general", pendingSettingsDestination: null });
  });

  it("opens Settings at a stable destination", () => {
    runDiscoveryAction({ type: "open-settings", tab: "appearance", destination: "notification-sounds" });

    expect(useUIStore.getState()).toMatchObject({
      rightPanelOpen: true,
      rightPanel: "settings",
      settingsTab: "appearance",
      pendingSettingsDestination: "notification-sounds",
    });
  });

  it("routes an available contextual destination without replacing the active chat", () => {
    useChatStore.setState({
      activeChatId: "game-chat",
      activeChat: { id: "game-chat", mode: "game" } as never,
    });
    const listener = vi.fn();
    window.addEventListener(DISCOVERY_APP_EVENT, listener);

    expect(runDiscoveryAction({ type: "open-chat-destination", destination: "game-journal" })).toEqual({
      status: "handled",
    });

    expect(useChatStore.getState().activeChatId).toBe("game-chat");
    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      type: "open-chat-destination",
      destination: "game-journal",
    });
    window.removeEventListener(DISCOVERY_APP_EVENT, listener);
  });

  it("explains a missing mode and offers setup without navigating home", () => {
    useChatStore.setState({
      activeChatId: "roleplay-chat",
      activeChat: { id: "roleplay-chat", mode: "roleplay" } as never,
    });

    expect(resolveDiscoveryAction({ type: "open-chat-destination", destination: "game-checkpoints" })).toEqual({
      status: "blocked",
      message: "Game Checkpoints needs an active Game chat.",
      fallback: { type: "open-mode-setup", mode: "game", label: "Set up Game" },
    });
    expect(useChatStore.getState().activeChatId).toBe("roleplay-chat");
  });

  it("offers the chat list when a chat-owned destination has no active chat", () => {
    expect(resolveDiscoveryAction({ type: "open-chat-destination", destination: "chat-settings" })).toEqual({
      status: "blocked",
      message: "Chat Settings needs an active chat.",
      fallback: { type: "open-chat-list", label: "Choose a chat" },
    });
  });

  it("does not choose an arbitrary setup mode when a destination supports multiple modes", () => {
    useChatStore.setState({
      activeChatId: "game-chat",
      activeChat: { id: "game-chat", mode: "game" } as never,
    });

    expect(resolveDiscoveryAction({ type: "open-chat-destination", destination: "slash-commands" })).toEqual({
      status: "blocked",
      message: "Slash Commands needs an active Conversation or Roleplay chat.",
      fallback: { type: "open-chat-list", label: "Choose a chat" },
    });
  });

  it("keeps malformed runtime destinations readable instead of rendering undefined", () => {
    expect(
      getDiscoveryActionLabel({
        type: "open-chat-destination",
        destination: "future-destination" as never,
      }),
    ).toBe("Open Chat destination");
  });
});
