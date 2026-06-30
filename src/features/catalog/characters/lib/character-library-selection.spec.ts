import { describe, expect, it } from "vitest";

import {
  characterLibrarySelectionLabel,
  selectVisibleCharacterIds,
  toggleCharacterLibrarySelection,
} from "./character-library-selection";

describe("character library selection", () => {
  it("toggles character ids without mutating the previous selection", () => {
    const current = new Set(["mira"]);
    const added = toggleCharacterLibrarySelection(current, "deki");
    const removed = toggleCharacterLibrarySelection(added, "mira");

    expect([...current]).toEqual(["mira"]);
    expect([...added].sort()).toEqual(["deki", "mira"]);
    expect([...removed]).toEqual(["deki"]);
  });

  it("selects all visible character ids in their current order", () => {
    const selected = selectVisibleCharacterIds([{ id: "mira" }, { id: "deki" }, { id: "koi" }]);

    expect([...selected]).toEqual(["mira", "deki", "koi"]);
  });

  it("formats a compact selected count label", () => {
    expect(characterLibrarySelectionLabel(0)).toBe("0 selected");
    expect(characterLibrarySelectionLabel(1)).toBe("1 selected");
    expect(characterLibrarySelectionLabel(3)).toBe("3 selected");
  });
});
