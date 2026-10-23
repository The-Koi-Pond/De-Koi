import { describe, expect, it } from "vitest";

import { detectExplicitTimeSkip } from "./time-skip-detection";

describe("detectExplicitTimeSkip", () => {
  it.each([
    ["*Three days later,* I knock on the door.", "three days", "Three days later"],
    ["A week later, the harbour is quiet.", "a week", "A week later"],
    ["_2 months later_", "2 months", "2 months later"],
    ["We sleep.\n*A few hours later* the bell rings.", "a few hours", "A few hours later"],
    ["[Time skip: one week]", "one week", "Time skip: one week"],
    ["(OOC: time skip to the next morning please)", "until the next morning", "time skip to the next morning please"],
    ["Timeskip.", "", "Timeskip"],
    ["Skip to the festival.", "until the festival", "Skip to the festival"],
    ["Let's fast-forward a couple of days", "a couple of days", "Let's fast-forward a couple of days"],
    ["*The next morning,* Mara is gone.", "until the next morning", "The next morning"],
    ["— The following week —", "until the following week", "The following week"],
  ])("spots %j", (text, elapsed, phrase) => {
    expect(detectExplicitTimeSkip(text)).toEqual({ elapsed, phrase });
  });

  it.each([
    "I knock on the door.",
    '"Three days later he came back," she says.',
    'I ask, "Should we time skip?"',
    "No time skip yet, I want to talk to her first.",
    "Let's not do a time skip.",
    "He said he'd be back three days later.",
    "I want to skip the small talk.",
    "Next to the fire, Mara sleeps.",
    "",
  ])("leaves %j alone", (text) => {
    expect(detectExplicitTimeSkip(text)).toBeNull();
  });
});
