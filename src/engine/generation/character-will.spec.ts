import { describe, expect, it } from "vitest";

import { CHARACTER_WILL_NOTES, characterWillNote, userIsPushing } from "./character-will";

describe("userIsPushing", () => {
  it.each([
    // Turns from the quality labs where characters used to fold.
    '*I reach the wheel and meet his eyes.* "Captain, let me take the wheel. Give me one pass at that gap."',
    '*I start for the hatch.* "I\'m going out on deck to sight the reef myself, whatever you say."',
    "honestly though, theo might be right? selling to the chain would be so much easier",
    "also don't be mad but theo's probably right about selling to the chain",
    "Ebooks are just better than paper books and bookshops are kind of pointless now.",
    "Trust me, I can do this.",
    "You should come with me tonight.",
  ])("notices a push: %s", (text) => {
    expect(userIsPushing(text)).toBe(true);
  });

  it.each([
    "What happens next?",
    "*I look at the map for a long moment and say nothing.*",
    "lol",
    "my mum Adaeze is visiting next weekend and I need somewhere to take her for breakfast",
    "Sorry I went quiet, the Rebecca margin note made me laugh.",
    "I've been feeling kind of lonely in the flat lately.",
  ])("leaves an ordinary turn alone: %s", (text) => {
    expect(userIsPushing(text)).toBe(false);
  });
});

describe("characterWillNote", () => {
  const push = "Let me take the wheel.";

  it("picks the note for the mode on a pushing turn", () => {
    expect(characterWillNote("roleplay", push, false)).toBe(CHARACTER_WILL_NOTES.roleplay);
    expect(characterWillNote("visual_novel", push, false)).toBe(CHARACTER_WILL_NOTES.roleplay);
    expect(characterWillNote("conversation", push, false)).toBe(CHARACTER_WILL_NOTES.conversation);
  });

  it("stays out of ordinary turns, impersonation and other modes", () => {
    expect(characterWillNote("roleplay", "What happens next?", false)).toBe("");
    expect(characterWillNote("roleplay", push, true)).toBe("");
    expect(characterWillNote("fanfic", push, false)).toBe("");
  });
});
