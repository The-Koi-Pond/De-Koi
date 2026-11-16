import { describe, expect, it } from "vitest";

import { parseCharacterCommands } from "./character-commands";

describe("[spotify: …] command", () => {
  it("reads the title and artist and strips the command from the visible reply", () => {
    const parsed = parseCharacterCommands('Put this on.\n[spotify: title="Merry-Go-Round", artist="Joe Hisaishi"]');
    expect(parsed.commands).toEqual([{ type: "spotify", title: "Merry-Go-Round", artist: "Joe Hisaishi" }]);
    expect(parsed.cleanContent).toBe("Put this on.");
  });

  it("accepts curly quotes, and a ] inside a quoted value does not end the command", () => {
    const curly = parseCharacterCommands("[spotify: title=“Songs [Live]”, artist=“The Band”] okay");
    expect(curly.commands).toEqual([{ type: "spotify", title: "Songs [Live]", artist: "The Band" }]);
    expect(curly.cleanContent).toBe("okay");

    const straight = parseCharacterCommands('[spotify: title="Intro [Remastered]", artist="Don’t Panic"]');
    expect(straight.commands).toEqual([{ type: "spotify", title: "Intro [Remastered]", artist: "Don’t Panic" }]);
    expect(straight.cleanContent).toBe("");
  });

  it("still strips a command missing a value and leaves it empty for execution to report", () => {
    const parsed = parseCharacterCommands('Listen [spotify: title="Only a title"]');
    expect(parsed.commands).toEqual([{ type: "spotify", title: "Only a title", artist: "" }]);
    expect(parsed.cleanContent).toBe("Listen");
  });
});
