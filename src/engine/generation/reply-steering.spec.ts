import { describe, expect, it } from "vitest";
import { buildReplySteeringGuidance, isReplyRedirect, isSceneAsk, isUnsureMessage } from "./reply-steering";

const user = (content: string) => ({ role: "user", content });
const reply = (content: string) => ({ role: "assistant", content });

describe("reply steering", () => {
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
    expect(isUnsureMessage("idk lol")).toBe(true);
    expect(isUnsureMessage("i don't know... theres just so much i struggle with")).toBe(true);
  });

  // Filler "idk" inside a real answer, where a "lead" note talked over what they said.
  it("doesn't read filler idk as unsure", () => {
    expect(isUnsureMessage("Blue idk it's dark")).toBe(false);
    expect(isUnsureMessage("Probably my posture. Stress does that soooo idk blame that. I do have a slight idea")).toBe(
      false,
    );
  });

  it("tells the next reply to change approach, quoting them, and to deliver the ask", () => {
    const guidance = buildReplySteeringGuidance({
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
    const guidance = buildReplySteeringGuidance({
      userName: "Chai",
      messages: [user("make it scary"), reply("Which do you want, cold or close?")],
      latestUserInput: "I dunno, whatever is scary?",
    });
    expect(guidance).toContain("Then lead: choose one concrete thing yourself and go with it.");
    expect(guidance).toContain("If they also sound hurt or hard on themselves, answer that first");
    expect(guidance).not.toContain("missed");
  });

  it("says nothing for an ordinary text, and doesn't keep pinning an old ask", () => {
    expect(
      buildReplySteeringGuidance({ messages: [user("I'm in the mood for horror"), reply("ok"), user("lol")] }),
    ).toBeNull();
    expect(buildReplySteeringGuidance({ messages: [] })).toBeNull();
  });

  // Roleplay pushback from real scenes: said in character, often drawn out.
  it("hears in-character pushback", () => {
    for (const text of [
      `"Mnnnn, nooo, that isn't what I meaaaaan~~~"`,
      'I groan. "You two are completely reversing this. You have it so backwards."',
      "you've got it all backwards",
    ]) {
      expect(isReplyRedirect(text), text).toBe(true);
    }
    expect(isSceneAsk("Let's lean into the spooky part more")).toBe(true);
    expect(isSceneAsk("Can you make him more possessive?")).toBe(true);
  });

  it("leaves ordinary scene lines alone", () => {
    for (const text of [
      "I watch, perplexed",
      "I don't understand how this machine works",
      '"Bit more boring than the plan we had."',
      'I flop onto the pillows. "Enough bickering."',
      '"Noooo~" I laugh and shove his shoulder.',
      `"You want to train.... The thing in my reflection? Isn't it an illusion?"`,
      '*I lean on the railing.* "You can give me more orders. I like being useful."',
    ]) {
      expect(isReplyRedirect(text), text).toBe(false);
    }
  });

  it("points a roleplay redirect at what the missed reply answered", () => {
    const guidance = buildReplySteeringGuidance({
      mode: "roleplay",
      userName: "Chai",
      messages: [
        user('"What if you were a famous chef. What would that be like...hehe~"'),
        reply(`"I'd be fired on my first day, dear one."`),
        user(
          '"I guess the fun part to me would be you knowing so much. Treating it like it was something very clean and professional~"',
        ),
        reply(`"Fine. Let's be clinical." He sets the knife down. "Hands flat."`),
        user(`"Mnnnn, nooo, that isn't what I meaaaaan~~~"`),
      ],
    });
    expect(guidance).toContain(
      `Chai's last message pushes back on how your previous reply took the scene: ""Mnnnn, nooo, that isn't what I meaaaaan~~~"".`,
    );
    expect(guidance).toContain("not just their character reacting to something in the story");
    expect(guidance).toContain(
      `The message your previous reply answered says what they were after: ""I guess the fun part to me would be you knowing so much.`,
    );
    expect(guidance).toContain("Don't make them explain it again");
    expect(guidance).not.toContain("redirected");
  });

  it("keeps roleplay quiet for an ordinary scene turn", () => {
    expect(
      buildReplySteeringGuidance({
        mode: "roleplay",
        messages: [
          user("*I take his arm.* Lead the way, then."),
          reply("He leads."),
          user("*I keep walking.* Where are we going?"),
        ],
      }),
    ).toBeNull();
  });

  // Story lines from scripted roleplay players: in a scene these are the character talking, not the user.
  it("reads unsure only from out-of-character asides in roleplay", () => {
    const story = `*My jaw tightens.* "I don't know. She stopped writing eight months ago."`;
    expect(isUnsureMessage(story)).toBe(true);
    expect(isUnsureMessage(story, "roleplay")).toBe(false);
    expect(isUnsureMessage(`"It's up to you, Captain."`, "roleplay")).toBe(false);
    expect(isUnsureMessage("*I shrug.* (idk, you pick)", "roleplay")).toBe(true);
    expect(isUnsureMessage("[OOC: surprise me]", "roleplay")).toBe(true);
  });

  it("keeps story requests out of roleplay asks", () => {
    expect(isSceneAsk(`"Hennessy, I need it to be a clean line."`, "roleplay")).toBe(false);
    expect(isSceneAsk(`"Fair. Then let me make it less like gold's gold."`, "roleplay")).toBe(false);
    expect(isSceneAsk("I want it to be scary")).toBe(true);
  });
});
