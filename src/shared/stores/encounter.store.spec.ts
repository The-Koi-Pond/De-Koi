import { beforeEach, describe, expect, it } from "vitest";

import type { CombatInitState } from "../../engine/contracts/types/combat-encounter";
import { useEncounterStore } from "./encounter.store";

const combatState: CombatInitState = {
  party: [
    {
      name: "Mira",
      hp: 30,
      maxHp: 30,
      attacks: [],
      items: [],
      statuses: [],
      isPlayer: true,
    },
  ],
  enemies: [],
  environment: "A mirror-bright hall.",
  styleNotes: {
    environmentType: "dungeon",
    atmosphere: "tense",
    timeOfDay: "night",
    weather: "clear",
  },
  itemEffects: [],
  mechanics: [],
  dialogueCues: [],
  visuals: { isBossFight: false, enemyImagePrompts: [] },
};

describe("encounter store chat ownership", () => {
  beforeEach(() => useEncounterStore.getState().reset());

  it("records the chat that opened encounter configuration", () => {
    const openForChat = useEncounterStore.getState().openConfigModal;

    openForChat("chat-a");

    expect(useEncounterStore.getState()).toMatchObject({ chatId: "chat-a", requestId: expect.any(Number) });
  });

  it("ignores a late initialization result from a chat that no longer owns the encounter", () => {
    const store = useEncounterStore.getState();
    const openForChat = store.openConfigModal;
    const initForChat = store.initCombat;
    openForChat("chat-a");
    const staleRequestId = useEncounterStore.getState().requestId;
    openForChat("chat-b");

    expect(() => initForChat("chat-a", staleRequestId, combatState)).not.toThrow();
    expect(useEncounterStore.getState()).toMatchObject({ chatId: "chat-b", initialized: false, active: false });
  });

  it("ignores a late initialization after the same chat starts a newer request", () => {
    const store = useEncounterStore.getState();
    const openForChat = store.openConfigModal;
    const initForRequest = store.initCombat;
    openForChat("chat-a");
    const staleRequestId = useEncounterStore.getState().requestId;
    openForChat("chat-a");
    const currentRequestId = useEncounterStore.getState().requestId;

    expect(() => initForRequest("chat-a", staleRequestId, combatState)).not.toThrow();
    expect(useEncounterStore.getState()).toMatchObject({
      chatId: "chat-a",
      requestId: currentRequestId,
      initialized: false,
      active: false,
    });
  });

  it("does not let a stale request settle a newer request's lifecycle flags", () => {
    const { openConfigModal: openForChat, beginRequest } = useEncounterStore.getState();
    openForChat("chat-a");
    const staleRequestId = beginRequest("chat-a", { isLoading: true });
    const currentRequestId = beginRequest("chat-a", {
      isLoading: true,
      isProcessing: true,
      summaryStatus: "generating",
    });

    expect(currentRequestId).toBeGreaterThan(staleRequestId ?? -1);
    useEncounterStore.getState().setRequestState("chat-a", staleRequestId ?? -1, {
      isLoading: false,
      isProcessing: false,
      summaryStatus: "error",
    });
    expect(useEncounterStore.getState()).toMatchObject({
      isLoading: true,
      isProcessing: true,
      summaryStatus: "generating",
    });
  });
});
