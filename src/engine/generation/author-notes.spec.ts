import { describe, expect, it } from "vitest";
import { authorNotesDepthEntry } from "./prompt-assembly";

const turns = (count: number) =>
  Array.from({ length: count * 2 }, (_, index) => ({ role: index % 2 === 0 ? "user" : "assistant", content: "x" }));

describe("Author's Notes placement", () => {
  it("inserts every message by default, as a system note at depth 4", () => {
    const chat = { metadata: { authorNotes: "Keep it rainy." } };

    expect(authorNotesDepthEntry(chat, turns(1))).toEqual({ content: "Keep it rainy.", role: "system", depth: 4 });
    expect(authorNotesDepthEntry(chat, turns(2))).not.toBeNull();
  });

  it("inserts only every Nth user message, and never at 0", () => {
    const every3 = { metadata: { authorNotes: "Rain.", authorNotesInterval: 3, authorNotesRole: "user" } };
    const off = { metadata: { authorNotes: "Rain.", authorNotesInterval: 0 } };

    expect([1, 2, 3, 4, 5, 6].map((count) => authorNotesDepthEntry(every3, turns(count)) !== null)).toEqual([
      false,
      false,
      true,
      false,
      false,
      true,
    ]);
    expect(authorNotesDepthEntry(every3, turns(3))?.role).toBe("user");
    expect(authorNotesDepthEntry(off, turns(1))).toBeNull();
  });
});
