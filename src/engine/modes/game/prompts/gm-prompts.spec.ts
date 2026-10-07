import { describe, expect, it } from "vitest";
import { buildGmFormatReminder } from "./gm-prompts";

const baseReminder = {
  map: null,
  gameActiveState: "exploration",
  sessionNumber: 1,
  partyNames: [],
  playerName: "Chai",
} as const;

describe("GM format reminder scene tags", () => {
  it("asks the GM for clock and weather tags only when no scene model runs", () => {
    const inline = buildGmFormatReminder({ ...baseReminder, partyNames: [], hasSceneModel: false });
    expect(inline).toContain('[time: elapsed="minutes"]');
    expect(inline).toContain('[time: of_day="dawn|morning|noon|afternoon|evening|night|midnight"]');
    expect(inline).toContain("[weather: clear|cloudy|foggy|rainy|stormy|snowy|windy|frost]");

    const withSceneModel = buildGmFormatReminder({ ...baseReminder, partyNames: [], hasSceneModel: true });
    expect(withSceneModel).not.toContain("[time:");
    expect(withSceneModel).not.toContain("[weather:");
  });
});
