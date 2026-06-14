import { describe, expect, it } from "vitest";
import {
  combatLevelFromHp,
  combatSkillsFromGeneratedAttacks,
  combatStatusEffectsFromGenerated,
  formatGameTimeForHud,
  gameSceneTurnNumber,
  getGameDirectAddressMode,
  isLikelyNamedCombatEnemy,
  isLikelyNarrationNpcName,
  isPartyTurnMessage,
  normalizeGameDay,
  normalizeGameHour,
  parseHourMinuteFromTimeLabel,
  parseStoredNarrationProgress,
  resolveRestoredNarrationState,
  stripGameDirectAddressPrefix,
  stripPartyTurnMarker,
} from "./game-surface-helpers";

describe("game surface helpers", () => {
  it("parses game direct-address and party-turn markers", () => {
    expect(getGameDirectAddressMode("  [To the party] regroup")).toBe("party");
    expect(getGameDirectAddressMode("[To the GM] narrate the door")).toBe("gm");
    expect(getGameDirectAddressMode("[aside] no marker")).toBeNull();

    expect(
      isPartyTurnMessage({
        role: "assistant",
        content: " [party-chat] Paimon waves.",
      }),
    ).toBe(true);
    expect(stripPartyTurnMarker(" [party-turn] Amber: Ready")).toBe("Amber: Ready");
    expect(stripGameDirectAddressPrefix("[To the GM] look around")).toBe("look around");
    expect(stripGameDirectAddressPrefix("  [To the party] regroup")).toBe("regroup");
  });

  it("counts assistant and narrator turns for scene numbering", () => {
    expect(
      gameSceneTurnNumber([
        { role: "system" },
        { role: "assistant" },
        { role: "user" },
        { role: "narrator" },
      ]),
    ).toBe(2);
  });

  it("normalizes and formats game time labels", () => {
    expect(normalizeGameDay("0")).toBe(1);
    expect(normalizeGameHour("99")).toBe(23);
    expect(parseHourMinuteFromTimeLabel("Day 3, 6.07 dawn")).toEqual({ hour: 6, minute: 7 });
    expect(formatGameTimeForHud({ day: 3, hour: 6, minute: 7 })).toBe("Day 3, 06:07 (dawn)");
  });

  it("parses stored narration progress defensively", () => {
    expect(parseStoredNarrationProgress('{"index":2,"messageId":"m2"}')).toEqual({ index: 2, messageId: "m2" });
    expect(parseStoredNarrationProgress("2")).toEqual({ index: 2, messageId: null });
    expect(parseStoredNarrationProgress("02")).toEqual({ index: 2, messageId: null });
    expect(parseStoredNarrationProgress('{"index":-1,"messageId":"m2"}')).toBeNull();
    expect(parseStoredNarrationProgress("-1")).toBeNull();
    expect(parseStoredNarrationProgress("not-json")).toBeNull();
  });

  it("restores narration progress from current-message and legacy local values", () => {
    expect(
      resolveRestoredNarrationState({
        currentMessageId: "m2",
        storedProgress: { index: 2, messageId: "m2" },
        serverIndex: 1,
        serverMessageId: "m2",
      }),
    ).toEqual({ index: 2, hasStoredPosition: true });

    expect(
      resolveRestoredNarrationState({
        currentMessageId: "m2",
        storedProgress: { index: 3, messageId: null },
        serverIndex: undefined,
        serverMessageId: undefined,
      }),
    ).toEqual({ index: 3, hasStoredPosition: true });

    expect(
      resolveRestoredNarrationState({
        currentMessageId: "m2",
        storedProgress: { index: 3, messageId: null },
        serverIndex: 1,
        serverMessageId: "m2",
      }),
    ).toEqual({ index: 1, hasStoredPosition: true });
  });

  it("filters generated NPC and combat enemy names", () => {
    expect(isLikelyNarrationNpcName("Jean Gunnhildr")).toBe(true);
    expect(isLikelyNarrationNpcName("guard")).toBe(false);
    expect(isLikelyNarrationNpcName("Jean [neutral]")).toBe(false);

    expect(isLikelyNamedCombatEnemy("Abyss Herald")).toBe(true);
    expect(isLikelyNamedCombatEnemy("Enemy 2")).toBe(false);
    expect(isLikelyNamedCombatEnemy("Guard IV")).toBe(false);
  });

  it("maps generated combat tags into combat UI-safe derived values", () => {
    expect(combatLevelFromHp(45, 3)).toBe(2);
    expect(combatLevelFromHp(0, 3)).toBe(3);

    expect(
      combatStatusEffectsFromGenerated([{ name: "Burning", emoji: "", modifier: -2, stat: "defense", duration: 0 }]),
    ).toEqual([{ name: "Burning", modifier: -2, stat: "defense", turnsLeft: 1 }]);

    expect(
      combatSkillsFromGeneratedAttacks(
        [
          { name: "Attack", type: "single-target", power: 1 },
          { name: "Flame Arc", type: "AoE", description: "", element: "pyro" },
          { name: "Flame Arc", type: "single-target", power: 9 },
        ],
        4,
      ),
    ).toEqual([
      expect.objectContaining({
        id: "flame-arc-1",
        name: "Flame Arc",
        mpCost: 9,
        power: 1.15,
        description: "Area combat ability",
        element: "pyro",
      }),
      expect.objectContaining({
        id: "flame-arc-2",
        name: "Flame Arc",
        power: 3,
      }),
    ]);
  });
});
