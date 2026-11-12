import { describe, expect, it } from "vitest";
import { encounterActionText, encounterTargets } from "./encounter-actions";
import type { EncounterCast, EncounterTrackedContext } from "./encounter-context";
import {
  DEFAULT_ENEMY_GLYPH,
  encounterEnemyGlyph,
  encounterSetupGaps,
  readSetupResponse,
  readTurnResponse,
} from "./encounter-rules";
import type { EncounterFight } from "./encounter-types";

const cast: EncounterCast = {
  persona: {
    name: "Mira",
    description: "",
    personality: "",
    backstory: "",
    appearance: "",
    statBars: [{ name: "Health", max: 40 }],
    maxHp: 40,
  },
  characters: [{ name: "Tobin", description: "", personality: "", scenario: "", maxHp: 30, attributes: [] }],
  legacyCards: [],
  legacyMapName: "",
};

const tracked: EncounterTrackedContext = {
  location: "Old mill",
  weather: "",
  time: "",
  date: "",
  inventory: [{ name: "Potion", quantity: 2 }],
  attributes: [],
  presentCharacters: [],
};

const gaps = encounterSetupGaps(cast, tracked, []);

function baseFight(): EncounterFight {
  return {
    party: [
      {
        name: "Mira",
        hp: 20,
        maxHp: 40,
        attacks: [{ name: "Blade", type: "single-target" }],
        items: ["Potion"],
        statuses: [],
        isPlayer: true,
      },
      { name: "Tobin", hp: 30, maxHp: 30, attacks: [], items: [], statuses: [], isPlayer: false },
    ],
    enemies: [
      {
        name: "Warden",
        hp: 10,
        maxHp: 18,
        attacks: [],
        statuses: [{ name: "Burning", emoji: "🔥", duration: 1 }],
        description: "",
        sprite: "",
      },
      { name: "Wisp", hp: 4, maxHp: 8, attacks: [], statuses: [], description: "", sprite: "" },
    ],
    environment: "A hall.",
    styleNotes: { environmentType: "dungeon", atmosphere: "tense", timeOfDay: "night", weather: "clear" },
    playerActions: { attacks: [{ name: "Blade", type: "single-target" }], items: ["Potion"] },
  };
}

describe("encounter setup checks", () => {
  it("fills a missing party from the persona and characters and a missing enemy list with Enemy 1", () => {
    const setup = readSetupResponse("{}", gaps);

    expect(setup?.enemies).toEqual([expect.objectContaining({ name: "Enemy 1", hp: 18, maxHp: 18 })]);
    expect(setup?.party[0]).toMatchObject({ name: "Mira", hp: 40, maxHp: 40, isPlayer: true, items: ["Potion x2"] });
    expect(setup?.party[1]).toMatchObject({ name: "Tobin", maxHp: 30, isPlayer: false });
    expect(setup?.environment).toBe("Old mill");
    expect(setup?.styleNotes).toEqual({
      environmentType: "plains",
      atmosphere: "tense",
      timeOfDay: "day",
      weather: "clear",
    });
  });

  it("returns nothing for junk", () => {
    expect(readSetupResponse("Roll for initiative!", gaps)).toBeNull();
  });

  it("checks combatants: numeric strings, clamped HP, dropped nameless entries, unknown attack types", () => {
    const setup = readSetupResponse(
      JSON.stringify({
        combatState: {
          party: [{ name: "Mira", hp: "50", maxHp: "40", attacks: [{ name: "Slash", type: "kick" }, { type: "AoE" }] }],
          enemies: [{ name: "Bat", maxHp: -3, statuses: [{ name: "Rage", stat: "luck" }, { emoji: "x" }] }],
        },
      }),
      gaps,
    );

    expect(setup?.party[0]).toMatchObject({ hp: 40, maxHp: 40, attacks: [{ name: "Slash", type: "single-target" }] });
    expect(setup?.enemies[0]).toMatchObject({ hp: 1, maxHp: 1, statuses: [{ name: "Rage", emoji: "", duration: 1 }] });
  });

  it("starts a combatant with a missing, zero or junk max HP at full HP from its hp", () => {
    const setup = readSetupResponse(
      JSON.stringify({
        enemies: [
          { name: "Ogre", hp: 30 },
          { name: "Imp", hp: "12", maxHp: 0 },
          { name: "Wisp", hp: 7, maxHp: "lots" },
        ],
      }),
      gaps,
    );

    expect(setup?.enemies.map((enemy) => [enemy.hp, enemy.maxHp])).toEqual([
      [30, 30],
      [12, 12],
      [7, 7],
    ]);
  });

  it("picks one player: flagged first, else the persona's name, else the first member (decision 4)", () => {
    const flagged = readSetupResponse(
      JSON.stringify({ party: [{ name: "A" }, { name: "B", isPlayer: true }, { name: "C", isPlayer: true }] }),
      gaps,
    );
    const named = readSetupResponse(JSON.stringify({ party: [{ name: "Tobin" }, { name: "mira" }] }), gaps);
    const first = readSetupResponse(JSON.stringify({ party: [{ name: "A" }, { name: "B" }] }), gaps);

    expect(flagged?.party.map((member) => member.isPlayer)).toEqual([false, true, false]);
    expect(named?.party.map((member) => member.isPlayer)).toEqual([false, true]);
    expect(first?.party.map((member) => member.isPlayer)).toEqual([true, false]);
  });
});

describe("encounter turns", () => {
  it("returns nothing for a junk turn, so the fight stays as it was", () => {
    expect(readTurnResponse("The warden staggers.", baseFight(), "Strike")).toBeNull();
    expect(readTurnResponse(JSON.stringify({ unrelated: true }), baseFight(), "Strike")).toBeNull();
  });

  it("ends as a victory when every enemy reaches 0 HP", () => {
    const outcome = readTurnResponse(
      JSON.stringify({
        combatStats: {
          enemies: [
            { name: "Warden", hp: 0 },
            { name: "Wisp", hp: 0 },
          ],
        },
      }),
      baseFight(),
      "Strike",
    );

    expect(outcome?.result).toBe("victory");
  });

  it.each(["I flee from the fight", "I deal a killing blow to every enemy"])(
    "never ends without combatEnd while enemies stand, whatever the action (%s)",
    (action) => {
      const outcome = readTurnResponse(
        JSON.stringify({ result: "fled", narrative: "Nothing decisive happens." }),
        baseFight(),
        action,
      );

      expect(outcome?.result).toBeNull();
    },
  );

  it("ends on the model's combatEnd with a valid result", () => {
    const outcome = readTurnResponse(JSON.stringify({ combatEnd: true, result: "fled" }), baseFight(), "Run");

    expect(outcome?.result).toBe("fled");
  });

  it("doesn't end on combatEnd with an unknown result while enemies stand", () => {
    const outcome = readTurnResponse(JSON.stringify({ combatEnd: true, result: "won" }), baseFight(), "Strike");

    expect(outcome?.result).toBeNull();
  });

  it("ignores a turn's interrupted result, which only Conclude makes", () => {
    const outcome = readTurnResponse(JSON.stringify({ combatEnd: true, result: "interrupted" }), baseFight(), "Wait");

    expect(outcome?.result).toBeNull();
  });

  it("ends as a defeat when the whole party is at 0 HP", () => {
    const outcome = readTurnResponse(
      JSON.stringify({
        combatStats: {
          party: [
            { name: "Mira", hp: 0 },
            { name: "Tobin", hp: 0 },
          ],
        },
      }),
      baseFight(),
      "Strike",
    );

    expect(outcome?.result).toBe("defeat");
  });

  it("takes the buttons from the updated player when the turn leaves playerActions out", () => {
    const outcome = readTurnResponse(
      JSON.stringify({ combatStats: { party: [{ name: "Mira", items: [] }] } }),
      baseFight(),
      "Uses Potion on Mira!",
    );

    expect(outcome?.fight.playerActions).toEqual({ attacks: [{ name: "Blade", type: "single-target" }], items: [] });
  });

  it("reads a status given as a plain string", () => {
    const outcome = readTurnResponse(
      JSON.stringify({ combatStats: { enemies: [{ name: "Wisp", statuses: ["Stunned"] }] } }),
      baseFight(),
      "Strike",
    );

    expect(outcome?.fight.enemies[1]?.statuses).toEqual([{ name: "Stunned", emoji: "", duration: 1 }]);
  });

  it("drops a nameless combatant that matches nobody instead of adding an Unknown", () => {
    const outcome = readTurnResponse(
      JSON.stringify({ combatStats: { enemies: [{ name: "Warden" }, { name: "Wisp" }, { hp: 5 }] } }),
      baseFight(),
      "Strike",
    );

    expect(outcome?.fight.enemies.map((enemy) => enemy.name)).toEqual(["Warden", "Wisp"]);
  });

  it("treats empty item and status lists as empty, and missing ones as unchanged (decision 2)", () => {
    const outcome = readTurnResponse(
      JSON.stringify({
        combatStats: {
          party: [{ name: "Mira", items: [] }],
          enemies: [{ name: "Warden", statuses: [] }, { name: "Wisp" }],
        },
        playerActions: { items: [] },
      }),
      baseFight(),
      "Uses Potion on Mira!",
    );

    expect(outcome?.fight.party[0]?.items).toEqual([]);
    expect(outcome?.fight.playerActions).toEqual({ attacks: [{ name: "Blade", type: "single-target" }], items: [] });
    expect(outcome?.fight.enemies[0]?.statuses).toEqual([]);
    expect(outcome?.fight.enemies[1]?.hp).toBe(4);
  });

  it("matches by name, keeps left-out combatants, and never makes a new one the player (decisions 3 and 4)", () => {
    const outcome = readTurnResponse(
      JSON.stringify({
        combatStats: {
          party: [
            { name: "tobin", hp: 12 },
            { name: "Stranger", hp: 9, maxHp: 9, isPlayer: true },
          ],
          enemies: [{ name: "WISP", hp: 1 }],
        },
      }),
      baseFight(),
      "Strike",
    );

    expect(outcome?.fight.party.map((member) => [member.name, member.hp, member.isPlayer])).toEqual([
      ["Mira", 20, true],
      ["Tobin", 12, false],
      ["Stranger", 9, false],
    ]);
    expect(outcome?.fight.enemies.map((enemy) => [enemy.name, enemy.hp])).toEqual([
      ["Warden", 10],
      ["Wisp", 1],
    ]);
  });

  it("logs enemy, ally and narration lines and records the round", () => {
    const outcome = readTurnResponse(
      JSON.stringify({
        enemyActions: [{ enemyName: "Warden", action: "swings", target: "Mira" }, { enemyName: "Wisp" }],
        partyActions: [{ memberName: "Tobin", action: "blocks", target: "Mira" }],
        narrative: "Steel rings.\n\nDust falls.",
      }),
      baseFight(),
      "Strike",
    );

    expect(outcome?.log).toEqual([
      { kind: "enemy", text: "Warden: swings" },
      { kind: "ally", text: "Tobin: blocks" },
      { kind: "narration", text: "Steel rings." },
      { kind: "narration", text: "Dust falls." },
    ]);
    expect(outcome?.round).toEqual({
      action: "Strike",
      enemyActions: ["Warden: swings"],
      partyActions: ["Tobin: blocks"],
      narrative: "Steel rings.\n\nDust falls.",
    });
  });
});

describe("encounter choices", () => {
  it("offers targets by attack type and only living combatants", () => {
    const fight = baseFight();
    fight.enemies[1]!.hp = 0;

    expect(encounterTargets(fight, { type: "attack", attack: { name: "Quake", type: "AoE" } })).toEqual({
      allEnemies: true,
      combatants: [],
    });
    const both = encounterTargets(fight, { type: "attack", attack: { name: "Bolt", type: "both" } });
    expect(both.allEnemies).toBe(true);
    expect(both.combatants.map((target) => target.name)).toEqual(["Warden", "Mira", "Tobin"]);
    expect(encounterTargets(fight, { type: "item", item: "Potion" }).allEnemies).toBe(false);
  });

  it("words the action text", () => {
    const attack = { type: "attack" as const, attack: { name: "Quake", type: "AoE" as const } };
    expect(encounterActionText(attack, null)).toBe("Uses Quake targeting all enemies!");
    expect(encounterActionText({ type: "item", item: "Potion" }, "Mira")).toBe("Uses Potion on Mira!");
  });

  it("shows one emoji as the enemy glyph and the default for anything else (decision 8)", () => {
    expect(encounterEnemyGlyph("🐉")).toBe("🐉");
    expect(encounterEnemyGlyph("enemy")).toBe(DEFAULT_ENEMY_GLYPH);
    expect(encounterEnemyGlyph("🐉🐉")).toBe(DEFAULT_ENEMY_GLYPH);
  });
});
