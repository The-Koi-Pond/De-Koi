import { describe, expect, it } from "vitest";
import {
  buildConversationSteeringGuidance,
  isReplyRedirect,
  isSceneAsk,
  isUnsureMessage,
} from "./conversation-steering";

const user = (content: string) => ({ role: "user", content });
const reply = (content: string) => ({ role: "assistant", content });

describe("conversation steering", () => {
  // Lines from a real chat where every attempt drifted back to the character's usual mood.
  it("hears a reply being called a miss", () => {
    for (const text of [
      "Ah, but that sounds so easy and wonderful~ that's not horror~",
      "Too easy.",
      "This isn't horror this is just kinky",
      "That's not scary, that's just boring and oddly targeted!",
      "That's just not intimate",
      "I mean, I don't feel turned on or scared.",
      "nah try again",
    ]) {
      expect(isReplyRedirect(text), text).toBe(true);
    }
  });

  it("leaves ordinary banter alone", () => {
    for (const text of [
      "that's not fair lol",
      "nope, still at work",
      "it's not like I asked for this",
      "I like the thought of being one of the circus's possessions",
      "I'm still on the computer.",
    ]) {
      expect(isReplyRedirect(text), text).toBe(false);
    }
  });

  it("hears what they asked the scene to be", () => {
    expect(isSceneAsk("So make your kidnapping scenario actually scary.")).toBe(true);
    expect(isSceneAsk("I suppose what I was considering was... Horror?")).toBe(true);
    expect(isSceneAsk("I'm in the mood for something slow")).toBe(true);
    expect(isSceneAsk("I want it but I have some conditions")).toBe(false);
  });

  it("hears unsure or tired, but not every 'I don't know'", () => {
    expect(isUnsureMessage("I dunno, whatever is scary?")).toBe(true);
    expect(isUnsureMessage("I'm sorry. I can't figure out what it is that I need.")).toBe(true);
    expect(isUnsureMessage("idk you pick")).toBe(true);
    expect(isUnsureMessage("I don't know why he's like that")).toBe(false);
  });

  it("tells the next reply to change approach, quoting them, and to deliver the ask", () => {
    const guidance = buildConversationSteeringGuidance({
      userName: "Chai",
      messages: [
        user("So make your kidnapping scenario actually scary."),
        reply("Fine. A cheap motel off the highway."),
        user("That's not scary, that's just boring and oddly targeted!"),
        reply("Then I blindfold you."),
        user("That's just not intimate"),
      ],
    });
    expect(guidance).toContain(`Chai's last message says your previous reply missed: "That's just not intimate".`);
    expect(guidance).toContain("don't tease them for the feedback, call them picky or give up on it");
    expect(guidance).toContain("They have now redirected 2 times");
    expect(guidance).toContain(
      `What Chai asked for, in their words: "So make your kidnapping scenario actually scary."`,
    );
  });

  it("asks the character to lead when they're unsure", () => {
    const guidance = buildConversationSteeringGuidance({
      userName: "Chai",
      messages: [user("make it scary"), reply("Which do you want, cold or close?")],
      latestUserInput: "I dunno, whatever is scary?",
    });
    expect(guidance).toContain("Lead: choose one concrete thing yourself and go with it.");
    expect(guidance).not.toContain("missed");
  });

  it("says nothing for an ordinary text, and doesn't keep pinning an old ask", () => {
    expect(
      buildConversationSteeringGuidance({ messages: [user("I'm in the mood for horror"), reply("ok"), user("lol")] }),
    ).toBeNull();
    expect(buildConversationSteeringGuidance({ messages: [] })).toBeNull();
  });
});
