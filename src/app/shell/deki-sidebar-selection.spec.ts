import { describe, expect, it } from "vitest";

import { getSelectedDekiSessionIds, getDekiBatchDeleteCopy, toggleDekiSessionSelection } from "./deki-sidebar-selection";

describe("Deki sidebar selection helpers", () => {
  it("toggles selected Deki session ids without mutating the previous selection", () => {
    const current = new Set(["deki-1"]);

    const withSecond = toggleDekiSessionSelection(current, "deki-2");
    const withoutFirst = toggleDekiSessionSelection(withSecond, "deki-1");

    expect(Array.from(current)).toEqual(["deki-1"]);
    expect(Array.from(withSecond)).toEqual(["deki-1", "deki-2"]);
    expect(Array.from(withoutFirst)).toEqual(["deki-2"]);
  });

  it("normalizes selected ids to the current visible Deki session order", () => {
    const selected = new Set(["missing", "deki-3", "deki-1"]);

    expect(getSelectedDekiSessionIds(selected, ["deki-1", "deki-2", "deki-3"])).toEqual(["deki-1", "deki-3"]);
  });

  it("uses destructive batch-delete copy for one or many selected Deki chats", () => {
    expect(getDekiBatchDeleteCopy(1)).toEqual({ title: "Delete Deki Chat", message: "Delete 1 Deki chat?" });
    expect(getDekiBatchDeleteCopy(3)).toEqual({ title: "Delete Deki Chats", message: "Delete 3 Deki chats?" });
  });
});
