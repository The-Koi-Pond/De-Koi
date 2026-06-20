import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { GameState } from "../../../engine/contracts/types/game-state";
import { useGameStateStore } from "../../runtime/world-state";
import { useAgentStore } from "../../../shared/stores/agent.store";
import { useChatStore } from "../../../shared/stores/chat.store";
import { useEncounterStore } from "../../../shared/stores/encounter.store";
import { useUIStore } from "../../../shared/stores/ui.store";
import { resetClientSessionState } from "./client-session-reset";

describe("resetClientSessionState", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useChatStore.getState().reset();
    useAgentStore.getState().reset();
    useGameStateStore.getState().reset();
    useEncounterStore.getState().reset();
  });

  afterEach(() => {
    useChatStore.getState().reset();
    useAgentStore.getState().reset();
    useGameStateStore.getState().reset();
    useEncounterStore.getState().reset();
    useUIStore.getState().closeAllDetails();
    useUIStore.getState().closeModal();
    useUIStore.getState().closeRightPanel();
    useUIStore.getState().closeBotBrowser();
    useUIStore.getState().setChatBackground(null);
  });

  it("resets client stores and clears the React Query cache", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["characters"], [{ id: "character-1" }]);

    useChatStore.getState().setActiveChatId("chat-1");
    useAgentStore.getState().setProcessing(true);
    useGameStateStore.getState().setGameState({ chatId: "chat-1", location: "Harbor" } as GameState);
    useEncounterStore.setState({ active: true, initialized: true, isProcessing: true });
    useUIStore.setState({
      modal: { type: "confirm", props: {} },
      characterDetailId: "character-1",
      rightPanelOpen: true,
      botBrowserOpen: true,
      chatBackground: "asset://background.png",
    });

    resetClientSessionState(queryClient);

    expect(useChatStore.getState().activeChatId).toBeNull();
    expect(useAgentStore.getState().isProcessing).toBe(false);
    expect(useGameStateStore.getState().current).toBeNull();
    expect(useEncounterStore.getState()).toMatchObject({
      active: false,
      initialized: false,
      isProcessing: false,
    });
    expect(useUIStore.getState()).toMatchObject({
      modal: null,
      characterDetailId: null,
      rightPanelOpen: false,
      botBrowserOpen: false,
      chatBackground: null,
    });
    expect(queryClient.getQueryCache().findAll()).toHaveLength(0);
  });
});
