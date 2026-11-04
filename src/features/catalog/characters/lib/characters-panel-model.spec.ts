import { describe, expect, it } from "vitest";

import { parseCharacterGroups, type ParsedCharacterRow } from "./characters-panel-model";

const character = (id: string, name: string) => ({ id, parsed: { name } }) as unknown as ParsedCharacterRow;

describe("parseCharacterGroups", () => {
  const mira = character("mira", "Mira");
  const kaz = character("kaz", "Kaz");

  it("adds no Ungrouped folder while there are no real folders, so the list isn't shown twice", () => {
    expect(parseCharacterGroups([], [mira, kaz])).toEqual([]);
  });

  it("collects the characters outside every folder into Ungrouped once real folders exist", () => {
    const groups = parseCharacterGroups([{ id: "crew", name: "Crew", characterIds: ["kaz"] }], [mira, kaz]);

    expect(groups.map((group) => [group.name, group.memberIds])).toEqual([
      ["Crew", ["kaz"]],
      ["Ungrouped", ["mira"]],
    ]);
    expect(groups[1]?.isSynthetic).toBe(true);
  });
});
