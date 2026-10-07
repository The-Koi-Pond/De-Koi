import { describe, expect, it } from "vitest";
import { parseSlashRoll } from "./game-slash-roll";

describe("parseSlashRoll", () => {
  it("reads the dice and any turn text after them", () => {
    expect(parseSlashRoll("/roll 2d6")).toEqual({ notation: "2d6", rest: "" });
    expect(parseSlashRoll(" /ROLL d20 + 3 I swing at the goblin")).toEqual({
      notation: "d20+3",
      rest: "I swing at the goblin",
    });
  });

  it("leaves other text and malformed rolls to the GM", () => {
    expect(parseSlashRoll("I /roll 2d6")).toBeNull();
    expect(parseSlashRoll("/roll lots")).toBeNull();
    expect(parseSlashRoll("/rolling 2d6")).toBeNull();
  });
});
