// @vitest-environment jsdom
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { TrackerState } from "../../../engine/contracts/types/tracker-state";
import { useTrackerStateStore } from "../../runtime/world-state";
import { useAgentStore } from "../../../shared/stores/agent.store";
import { useChatStore } from "../../../shared/stores/chat.store";
import { useRoleplayEncounterStore } from "../../../shared/stores/roleplay-encounter.store";
import { useUIStore } from "../../../shared/stores/ui.store";
import { resetClientDataState, resetClientSessionState } from "./client-session-reset";

const narration = { tense: "present", person: "third", narration: "omniscient", pov: "narrator" } as const;

/** A running fight in chat-1 with a turn still waiting on the model. */
function startFightWithPendingTurn() {
  useRoleplayEncounterStore.getState().openSetup("chat-1");
  const start = useRoleplayEncounterStore.getState().beginStart({
    combatNarration: narration,
    summaryNarration: narration,
    spellbookId: null,
    historyDepth: 8,
  });
  useRoleplayEncounterStore.getState().finishStart(start!.id, {
    party: [{ name: "Mira", hp: 20, maxHp: 20, attacks: [], items: [], statuses: [], isPlayer: true }],
    enemies: [],
    environment: "A hall.",
    styleNotes: { environmentType: "dungeon", atmosphere: "tense", timeOfDay: "night", weather: "clear" },
    playerActions: { attacks: [], items: [] },
  });
  return useRoleplayEncounterStore.getState().beginTurn("Strike")!;
}

function expectNoEncounterLeft(turn: { signal: AbortSignal }) {
  expect(useRoleplayEncounterStore.getState()).toMatchObject({ encounter: null, pending: null });
  expect(turn.signal.aborted).toBe(true);
}

describe("resetClientSessionState", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useChatStore.getState().reset();
    useAgentStore.getState().reset();
    useTrackerStateStore.getState().reset();
    useRoleplayEncounterStore.getState().reset();
  });

  afterEach(() => {
    useChatStore.getState().reset();
    useAgentStore.getState().reset();
    useTrackerStateStore.getState().reset();
    useRoleplayEncounterStore.getState().reset();
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
    useTrackerStateStore.getState().setTrackerState({ chatId: "chat-1", location: "Harbor" } as TrackerState);
    const turn = startFightWithPendingTurn();
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
    expect(useTrackerStateStore.getState().current).toBeNull();
    expectNoEncounterLeft(turn);
    expect(useUIStore.getState()).toMatchObject({
      modal: null,
      characterDetailId: null,
      rightPanelOpen: false,
      botBrowserOpen: false,
      chatBackground: null,
    });
    expect(queryClient.getQueryCache().findAll()).toHaveLength(0);
  });

  it("resets client data without closing the settings owner or other shell UI", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["characters"], [{ id: "character-1" }]);

    useChatStore.getState().setActiveChatId("chat-1");
    useAgentStore.getState().setProcessing(true);
    useTrackerStateStore.getState().setTrackerState({ chatId: "chat-1", location: "Harbor" } as TrackerState);
    const turn = startFightWithPendingTurn();
    useUIStore.setState({
      modal: { type: "confirm", props: {} },
      characterDetailId: "character-1",
      rightPanelOpen: true,
      rightPanel: "settings",
      botBrowserOpen: true,
      chatBackground: "asset://background.png",
    });

    resetClientDataState(queryClient);

    expect(useChatStore.getState().activeChatId).toBeNull();
    expect(useAgentStore.getState().isProcessing).toBe(false);
    expect(useTrackerStateStore.getState().current).toBeNull();
    expectNoEncounterLeft(turn);
    expect(useUIStore.getState()).toMatchObject({
      modal: { type: "confirm", props: {} },
      characterDetailId: "character-1",
      rightPanelOpen: true,
      rightPanel: "settings",
      botBrowserOpen: true,
      chatBackground: "asset://background.png",
    });
    expect(queryClient.getQueryCache().findAll()).toHaveLength(0);
  });
});
