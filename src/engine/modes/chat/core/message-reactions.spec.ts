import { describe, expect, it } from "vitest";
import { parseCharacterCommands, parseReactionEmoji } from "../commands/character-commands";
import { reactionHistoryNote, readMessageReactions, withMessageReaction } from "./message-reactions";

describe("conversation message reactions", () => {
  it("accepts exactly one emoji, including skin tones, ZWJ sequences, flags and keycaps", () => {
    for (const emoji of ["😂", "❤️", "👍🏽", "🧑‍🍳", "🇯🇵", "1️⃣"]) expect(parseReactionEmoji(emoji)).toBe(emoji);
    for (const value of ["lol", "😂😂", "ok 😂", "", ":)"]) expect(parseReactionEmoji(value)).toBeNull();
  });

  it("parses a tapback tag in any of its forms and strips it from the visible reply", () => {
    const parsed = parseCharacterCommands('ha ok fine\n[react: emoji="😂"]');
    expect(parsed.commands).toEqual([{ type: "react", emoji: "😂" }]);
    expect(parsed.cleanContent.trim()).toBe("ha ok fine");
    expect(parseCharacterCommands("[react: 👍]").commands).toEqual([{ type: "react", emoji: "👍" }]);
    expect(parseCharacterCommands('[react: "❤️"]').commands).toEqual([{ type: "react", emoji: "❤️" }]);
  });

  it("keeps one reaction per reactor; the same pick again removes it", () => {
    const at = "2026-10-19T12:00:00.000Z";
    const first = withMessageReaction([], "user", "❤️", at);
    const swapped = withMessageReaction(first, "user", "😂", at);
    expect(swapped).toEqual([{ by: "user", emoji: "😂", at }]);
    expect(withMessageReaction(swapped, "user", "😂", at)).toEqual([]);
    const both = withMessageReaction(swapped, "char-1", "😮", at);
    expect(readMessageReactions({ reactions: both }).map((reaction) => reaction.by)).toEqual(["user", "char-1"]);
  });

  it("reads reactions from string extras and drops malformed or duplicate entries", () => {
    const extra = JSON.stringify({
      reactions: [{ by: "user", emoji: "❤️" }, { by: "user", emoji: "😂" }, { emoji: "👍" }, "nope"],
    });
    expect(readMessageReactions(extra)).toEqual([{ by: "user", emoji: "❤️", at: "" }]);
  });

  it("writes a short history note naming each reactor", () => {
    const note = reactionHistoryNote(
      [
        { by: "user", emoji: "❤️", at: "" },
        { by: "char-1", emoji: "😂", at: "" },
      ],
      (by) => (by === "user" ? "Sam" : "Juno"),
    );
    expect(note).toBe("(Sam reacted ❤️, Juno reacted 😂)");
    expect(reactionHistoryNote([], () => "x")).toBe("");
  });
});
