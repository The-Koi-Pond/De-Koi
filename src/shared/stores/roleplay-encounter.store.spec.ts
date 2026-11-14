import { beforeEach, describe, expect, it } from "vitest";
import type {
  EncounterFight,
  EncounterSettings,
  EncounterTurnOutcome,
} from "../../engine/modes/roleplay/encounter/encounter-types";
import { ENCOUNTER_LEFT_CHAT_MESSAGE, useRoleplayEncounterStore } from "./roleplay-encounter.store";

const narration = { tense: "present", person: "third", narration: "omniscient", pov: "narrator" } as const;
const settings: EncounterSettings = {
  combatNarration: narration,
  summaryNarration: narration,
  spellbookId: null,
  historyDepth: 8,
};

const fight: EncounterFight = {
  party: [{ name: "Mira", hp: 20, maxHp: 20, attacks: [], items: [], statuses: [], isPlayer: true }],
  enemies: [{ name: "Warden", hp: 18, maxHp: 18, attacks: [], statuses: [], description: "", sprite: "" }],
  environment: "A hall.",
  styleNotes: { environmentType: "dungeon", atmosphere: "tense", timeOfDay: "night", weather: "clear" },
  playerActions: { attacks: [], items: [] },
};

function outcome(narrative: string): EncounterTurnOutcome {
  return {
    fight,
    round: { action: "Strike", enemyActions: [], partyActions: [], narrative },
    log: [{ kind: "narration", text: narrative }],
    result: null,
  };
}

const store = () => useRoleplayEncounterStore.getState();
const logText = () => store().encounter?.log.map((line) => line.text);

function startFight(chatId = "chat-a") {
  store().openSetup(chatId);
  const ticket = store().beginStart(settings)!;
  store().finishStart(ticket.id, fight);
}

describe("encounter store", () => {
  beforeEach(() => store().reset());

  it("ignores a late setup answer once a newer encounter was opened in the same chat", () => {
    store().openSetup("chat-a");
    const stale = store().beginStart(settings)!;
    store().openSetup("chat-a");

    store().finishStart(stale.id, fight);

    expect(stale.signal.aborted).toBe(true);
    expect(store().encounter).toMatchObject({ chatId: "chat-a", stage: "setup", fight: null });
  });

  it("drops an encounter whose setup was pending when you left its chat, and ignores the late answer", () => {
    store().openSetup("chat-a");
    const pending = store().beginStart(settings)!;

    store().leaveChat("chat-b");
    store().finishStart(pending.id, fight);

    expect(pending.signal.aborted).toBe(true);
    expect(store().encounter).toBeNull();
  });

  it("keeps the fight and its whole log when you leave mid-turn, with the cancel message", () => {
    startFight();
    const turn = store().beginTurn("Strike")!;

    store().leaveChat("chat-b");
    store().leaveChat("chat-a");
    store().finishTurn(turn.id, outcome("Late narration"));

    expect(turn.signal.aborted).toBe(true);
    expect(store().encounter).toMatchObject({ stage: "fighting", turnError: ENCOUNTER_LEFT_CHAT_MESSAGE, rounds: [] });
    expect(store().pending).toBeNull();
    expect(logText()).toEqual(["Combat begins!", "You: Strike"]);
  });

  it("does not let a turn from a replaced encounter touch the new one", () => {
    startFight();
    const turn = store().beginTurn("Strike")!;
    startFight();

    store().finishTurn(turn.id, outcome("Late narration"));

    expect(logText()).toEqual(["Combat begins!"]);
  });

  it("appends a turn's lines after the player's line and records the round", () => {
    startFight();
    const turn = store().beginTurn("Strike")!;
    expect(store().beginTurn("Again")).toBeNull();

    store().finishTurn(turn.id, outcome("Steel rings."));

    expect(logText()).toEqual(["Combat begins!", "You: Strike", "Steel rings."]);
    expect(store().encounter?.rounds).toHaveLength(1);
    expect(store().pending).toBeNull();
  });

  it("fails the summary when you leave while it is written, and a late answer can't undo that", () => {
    startFight();
    store().conclude();
    expect(store().encounter).toMatchObject({ stage: "ended", result: "interrupted" });
    const summary = store().beginSummary()!;

    store().leaveChat("chat-b");
    store().finishSummary(summary.id);

    expect(summary.signal.aborted).toBe(true);
    expect(store().encounter?.summaryStatus).toBe("failed");
  });

  it("counts a summary as written once its save started, even if you leave the chat during the save", () => {
    startFight();
    store().conclude();
    const summary = store().beginSummary()!;
    store().startSummarySave(summary.id);

    store().leaveChat("chat-b");
    expect(summary.signal.aborted).toBe(false);
    expect(store().encounter?.summaryStatus).toBe("generating");

    store().finishSummary(summary.id);
    expect(store().encounter?.summaryStatus).toBe("written");
    expect(store().beginSummary()).toBeNull();
  });

  it("cancels a pending turn on Conclude and ignores its late answer", () => {
    startFight();
    const turn = store().beginTurn("Strike")!;

    store().conclude();
    expect(turn.signal.aborted).toBe(true);
    expect(store().pending).toBeNull();
    const summary = store().beginSummary();
    expect(summary).not.toBeNull();

    store().finishTurn(turn.id, outcome("Late narration"));
    expect(store().encounter).toMatchObject({ stage: "ended", result: "interrupted", rounds: [] });
    expect(logText()).toEqual(["Combat begins!", "You: Strike"]);
  });

  it("lets a failed summary be tried again", () => {
    startFight();
    store().conclude();
    store().failSummary(
      store().beginSummary()!.id,
      "The Encounters helper is set to a connection that no longer exists.",
    );

    const retry = store().beginSummary()!;
    // The last failure's reason mustn't come back if the retry fails another way.
    expect(store().encounter?.summaryError).toBeNull();
    store().finishSummary(retry.id);

    expect(store().encounter?.summaryStatus).toBe("written");
  });

  it("leaves nothing behind on close or reset", () => {
    startFight();
    const turn = store().beginTurn("Strike")!;
    store().close();
    expect(turn.signal.aborted).toBe(true);
    expect(store()).toMatchObject({ encounter: null, pending: null });

    startFight();
    store().reset();
    expect(store()).toMatchObject({ encounter: null, pending: null });
  });
});
