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
    const openForChat = useEncounterStore.getState().openConfigModal as unknown as (chatId: string) => void;

    openForChat("chat-a");

    expect((useEncounterStore.getState() as { chatId?: string }).chatId).toBe("chat-a");
  });

  it("ignores a late initialization result from a chat that no longer owns the encounter", () => {
    const store = useEncounterStore.getState();
    const openForChat = store.openConfigModal as unknown as (chatId: string) => void;
    const initForChat = store.initCombat as unknown as (chatId: string, state: CombatInitState) => void;
    openForChat("chat-a");
    openForChat("chat-b");

    expect(() => initForChat("chat-a", combatState)).not.toThrow();
    expect(useEncounterStore.getState()).toMatchObject({ chatId: "chat-b", initialized: false, active: false });
  });
});
