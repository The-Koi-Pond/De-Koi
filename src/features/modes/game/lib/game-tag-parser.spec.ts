import { describe, expect, it } from "vitest";
import { formatNarration } from "./game-narration-format";
import { parseGmTags, stripGmTags, stripGmTagsKeepReadables } from "./game-tag-parser";

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
