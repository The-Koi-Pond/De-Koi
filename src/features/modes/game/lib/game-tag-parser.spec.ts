// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { formatNarration } from "./game-narration-format";
import { parseGmTags, parseSegmentInventoryUpdates, stripGmTags, stripGmTagsKeepReadables } from "./game-tag-parser";

describe("game GM tag parsing", () => {
  it("preserves inventory count aliases on parsed commands", () => {
    const parsed = parseGmTags(
      [
        '[inventory: action="add" item="Potion" count=3]',
        '[inventory: action="remove" item="Arrow" quantity=2]',
        '[inventory: add item="Coin" qty=5]',
      ].join("\n"),
    );

    expect(parsed.inventoryUpdates).toEqual([
      { action: "add", items: ["Potion"], count: 3 },
      { action: "remove", items: ["Arrow"], count: 2 },
      { action: "add", items: ["Coin"], count: 5 },
    ]);
  });

  it("stops unquoted inventory item names before trailing attributes", () => {
    const parsed = parseGmTags("[inventory: action=add item=Potion count=3]");

    expect(parsed.inventoryUpdates).toEqual([{ action: "add", items: ["Potion"], count: 3 }]);
  });

  it("parses inline clock and weather tags with the scene-analysis vocabulary", () => {
    const elapsed = parseGmTags('You search the shelves.\n[time: elapsed="45"]\n[weather: rainy]');
    expect(elapsed.time).toEqual({ elapsedMinutes: 45, timeOfDay: null });
    expect(elapsed.weather).toBe("rainy");
    expect(elapsed.cleanContent).toBe("You search the shelves.");

    expect(parseGmTags('[time: of_day="Dawn"] [weather: type="stormy"]')).toMatchObject({
      time: { elapsedMinutes: null, timeOfDay: "dawn" },
      weather: "stormy",
    });
    expect(parseGmTags("[time: elapsed=5000]").time).toEqual({ elapsedMinutes: 1440, timeOfDay: null });
    expect(
      parseGmTags('[time: elapsed="20"] beat [time: of_day="evening"] beat [time: elapsed="25"] [time: of_day="night"]')
        .time,
    ).toEqual({ elapsedMinutes: 45, timeOfDay: "night" });
    expect(parseGmTags('[time: of_day="teatime"] [weather: sunny-ish]')).toMatchObject({ time: null, weather: null });
  });

  it("keeps inline clock and weather tags out of narration and segment counting", () => {
    const source = ['[time: elapsed="10"]', "", "You pocket the key.", '[inventory: action="add" item="Key"]'].join(
      "\n",
    );
    expect(stripGmTags(source)).toBe("You pocket the key.");
    expect(stripGmTagsKeepReadables(source)).toBe("You pocket the key.");
    expect(parseSegmentInventoryUpdates(source)).toEqual([{ segment: 0, update: { action: "add", items: ["Key"] } }]);
  });

  it("parses and displays legacy party_add as a party addition", () => {
    const source = 'Mira joins. [party_add: character="Mira"]';
    const parsed = parseGmTags(source);

    expect(parsed.partyChanges).toEqual([{ characterName: "Mira", change: "add" }]);
    expect(parsed.cleanContent).toBe("Mira joins.");
    expect(stripGmTags(source)).not.toContain("party_add");
    expect(stripGmTagsKeepReadables(source)).not.toContain("party_add");
    expect(formatNarration(source)).toContain("Party");
    expect(formatNarration(source)).toContain("add: Mira");
  });
});
