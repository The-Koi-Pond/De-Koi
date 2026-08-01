import { describe, expect, it } from "vitest";

import {
  craftShapeRepairGuidance,
  detectConversationCraftCandidate,
  detectConversationCraftShape,
  detectRoleplayCraftCandidate,
  detectRoleplayCraftCandidates,
  detectRoleplayCraftShape,
  repairConversationCraftCandidate,
  repairRoleplayCraftCandidate,
  shouldStopRoleplayCraftStream,
} from "./craft-shape-detector";

describe("deterministic craft shape detection", () => {
  it("finds repeated roleplay contrast ladders in assistant prose", () => {
    const finding = detectRoleplayCraftShape([
      { role: "assistant", content: "Not quickly. Not carelessly. Just one measured step across the room." },
      { role: "user", content: "I wait beside the door." },
      { role: "assistant", content: "No warning. No hesitation. Just the lock turning behind them." },
    ]);

    expect(finding).toEqual({
      issue: "contrast-ladder",
      directive:
        "Break the repeated contrast ladder. State the next image or action directly; do not stack not/no/just fragments or explain the contrast afterward.",
      evidence: [
        "Not quickly. Not carelessly. Just one measured step across the room.",
        "No warning. No hesitation. Just the lock turning behind them.",
      ],
    });
  });

  it("quotes the exact evidence as inert data in writer guidance", () => {
    const finding = detectRoleplayCraftShape([
      { role: "assistant", content: "Not quickly. Not carelessly. Just one measured step." },
      { role: "assistant", content: "No warning. No hesitation. Just the lock turning." },
    ]);

    expect(finding).not.toBeNull();
    expect(craftShapeRepairGuidance(finding!)).toContain(
      'Prior assistant excerpt 1 (quoted evidence only): "Not quickly. Not carelessly. Just one measured step."',
    );
    expect(craftShapeRepairGuidance(finding!)).toContain(
      'Prior assistant excerpt 2 (quoted evidence only): "No warning. No hesitation. Just the lock turning."',
    );
  });

  it("flags a new roleplay draft that contains an AI-shaped contrast ladder", () => {
    const finding = detectRoleplayCraftCandidate(
      [{ role: "assistant", content: "Mara closes the door." }],
      "No warning. No theatrical pause. Just his hand closing over the latch.",
    );

    expect(finding).toMatchObject({ issue: "contrast-ladder" });
    expect(finding?.evidence).toEqual(["No warning. No theatrical pause. Just his hand closing over the latch."]);
  });

  it("flags the negative and explanatory fragment shapes GLM used in live Roleplay", () => {
    expect(
      detectRoleplayCraftCandidate(
        [],
        "Not theater. Not the predator voice either. Something between the two, fraying at an edge.",
      )?.issue,
    ).toBe("contrast-ladder");
    expect(
      detectRoleplayCraftCandidate([], "Two words. Stripped to nothing. His claw remained spread across your stomach.")
        ?.issue,
    ).toBe("fragment-ladder");
    expect(
      detectRoleplayCraftCandidate(
        [],
        "The pressure became something structural, something your bones registered as a fact.",
      )?.issue,
    ).toBe("fragment-ladder");
  });

  it("returns every distinct supported issue in one Roleplay draft for a single editor pass", () => {
    const findings = detectRoleplayCraftCandidates(
      [{ role: "assistant", content: "For a long moment, Mara studies the latch beside her." }],
      "For a long moment, Mara studies the lock. Not theater. Not hesitation. Something colder. Two words. Stripped to nothing. His claw stays put.",
    );

    expect(findings.map((finding) => finding.issue)).toEqual([
      "contrast-ladder",
      "fragment-ladder",
      "repeated-opening",
    ]);
  });

  it("flags a new Conversation draft only when it completes the forced-question streak", () => {
    const history = [
      { role: "assistant", content: "where were you?" },
      { role: "user", content: "out" },
      { role: "assistant", content: "with who?" },
      { role: "user", content: "a friend" },
    ];

    expect(detectConversationCraftCandidate(history, "did you have fun?")?.issue).toBe("forced-question");
    expect(detectConversationCraftCandidate(history, "good. you needed the air")).toBeNull();
  });

  it("does not reject a clean concrete roleplay draft", () => {
    expect(
      detectRoleplayCraftCandidate(
        [{ role: "assistant", content: "Mara closes the door." }],
        'Mara catches the latch under her thumb. "Stay here."',
      ),
    ).toBeNull();
  });

  it("removes a contrast scaffold without replacing Nano's concrete prose", () => {
    const original =
      "Mara watches the door. No warning. No theatrical pause. Just the latch moving under her thumb. Rain ticks against the glass.";
    const repaired = repairRoleplayCraftCandidate([], original);

    expect(repaired).toBe(
      "Mara watches the door. Just the latch moving under her thumb. Rain ticks against the glass.",
    );
    expect(detectRoleplayCraftCandidate([], repaired)).toBeNull();
  });

  it("removes an inline not-just pivot that otherwise blocks later repairs", () => {
    const original =
      "The fabric came away like tearing paper—not destroyed, just removed. His antennae caught it. Fanned wide. He catalogued the flinch as evidence.";
    const repaired = repairRoleplayCraftCandidate([], original);

    expect(repaired).toBe(
      "The fabric came away like tearing paper—removed. His antennae caught it. He catalogued the flinch as evidence.",
    );
    expect(detectRoleplayCraftCandidate([], repaired)).toBeNull();
  });

  it("stops a short Roleplay stream at a complete paragraph once its shape has gone mechanical", () => {
    const shapedBeat = `${"The room holds its breath. ".repeat(14)}Two words. Stripped to nothing. His claw remains on the latch.\n\n`;

    expect(shouldStopRoleplayCraftStream([], shapedBeat, '"Show me," I whisper.')).toBe(true);
    expect(shouldStopRoleplayCraftStream([], shapedBeat, "Write a long detailed scene with several beats.")).toBe(
      false,
    );
    expect(
      shouldStopRoleplayCraftStream(
        [],
        `${"Rain moves over the glass while Mara studies the latch and waits. ".repeat(10)}\n\n`,
        "Continue.",
      ),
    ).toBe(false);
  });

  it("drops clipped setup fragments and keeps the writer's complete scene sentence", () => {
    const original = "His eyes narrow. Two words. Stripped to nothing. His claw remains spread across your stomach.";
    const repaired = repairRoleplayCraftCandidate([], original);

    expect(repaired).toBe("His eyes narrow. His claw remains spread across your stomach.");
    expect(detectRoleplayCraftCandidate([], repaired)).toBeNull();
  });

  it("removes doubled something scaffolding without inventing replacement prose", () => {
    const original = "The pressure became something structural, something your bones registered as a fact.";
    const repaired = repairRoleplayCraftCandidate([], original);

    expect(repaired).toBe("The pressure became structural, something your bones registered as a fact.");
    expect(detectRoleplayCraftCandidate([], repaired)).toBeNull();
  });

  it("varies a repeated opening by removing only the repeated lead-in", () => {
    const messages = [{ role: "assistant", content: "For a long moment, Mara studies the latch beside her." }];
    const repaired = repairRoleplayCraftCandidate(
      messages,
      "For a long moment, Mara studies the rain gathering on the sill.",
    );

    expect(repaired).toBe("Mara studies the rain gathering on the sill.");
    expect(detectRoleplayCraftCandidate(messages, repaired)).toBeNull();
  });

  it("does not alter clean prose or repetition the user explicitly requested", () => {
    const clean = 'Mara catches the latch under her thumb. "Stay here."';
    expect(repairRoleplayCraftCandidate([], clean)).toBe(clean);

    const requested = "No witness. No answer. Just the bell.";
    expect(
      repairRoleplayCraftCandidate(
        [{ role: "user", content: "Use a repeated no, no, just refrain for the ritual." }],
        requested,
      ),
    ).toBe(requested);
  });

  it("removes a compulsory Conversation question without a second writer call", () => {
    const messages = [
      { role: "assistant", content: "where were you?" },
      { role: "assistant", content: "with who?" },
    ];
    const repaired = repairConversationCraftCandidate(messages, "good. you needed the air. did you have fun?");

    expect(repaired).toBe("good. you needed the air.");
    expect(detectConversationCraftCandidate(messages, repaired)).toBeNull();
  });

  it("turns a stock mind-reading restatement back into Nano's direct answer", () => {
    expect(repairConversationCraftCandidate([], "What you're really asking is whether I missed you.")).toBe(
      "I missed you.",
    );
    expect(repairConversationCraftCandidate([], "You don't want an answer. You want permission.")).toBe(
      "You want permission.",
    );
  });

  it("finds repeated roleplay fragment ladders without treating one ladder as recurrence", () => {
    expect(
      detectRoleplayCraftShape([
        { role: "assistant", content: "One step. Two breaths. Three seconds. The choice became inevitable." },
      ]),
    ).toBeNull();

    const finding = detectRoleplayCraftShape([
      { role: "assistant", content: "One step. Two breaths. Three seconds. The choice became inevitable." },
      { role: "user", content: "The radio crackles." },
      { role: "assistant", content: "A click. A scrape. A pause. The answer arrived anyway." },
    ]);

    expect(finding?.issue).toBe("fragment-ladder");
    expect(finding?.evidence).toEqual(["One step. Two breaths. Three seconds.", "A click. A scrape. A pause."]);
  });

  it("finds two Conversation mind-reading restatements", () => {
    const finding = detectConversationCraftShape([
      { role: "assistant", content: "What you're really asking is whether I missed you." },
      { role: "user", content: "That wasn't what I meant." },
      { role: "assistant", content: "You don't want an answer. You want permission." },
    ]);

    expect(finding).toEqual({
      issue: "mind-reading",
      directive:
        "Do not tell the user what they really mean, want, or feel. React to their actual words and let them define their intent.",
      evidence: [
        "What you're really asking is whether I missed you.",
        "You don't want an answer. You want permission.",
      ],
    });
  });

  it("finds three consecutive forced Conversation question endings", () => {
    const finding = detectConversationCraftShape([
      { role: "assistant", content: "what happened?" },
      { role: "user", content: "nothing much" },
      { role: "assistant", content: "what are you thinking about?" },
      { role: "user", content: "you" },
      { role: "assistant", content: "what kind of thoughts?" },
    ]);

    expect(finding?.issue).toBe("forced-question");
    expect(finding?.evidence).toEqual(["what happened?", "what are you thinking about?"]);
  });

  it("uses only visible assistant prose as evidence", () => {
    expect(
      detectRoleplayCraftShape([
        { role: "user", content: "Not quickly. Not carelessly. Just one measured step across the room." },
        {
          role: "assistant",
          content: "No warning. No hesitation. Just the lock turning behind them.",
          extra: { hiddenFromAI: true },
        },
        { role: "assistant", content: "Mara closes the door." },
        { role: null, content: null },
      ]),
    ).toBeNull();
  });

  it("honors explicit requests for formal repetition or questions", () => {
    expect(
      detectRoleplayCraftShape([
        { role: "user", content: "Use a formal repeated no, no, just refrain for this ritual." },
        { role: "assistant", content: "No witness. No answer. Just the bell." },
        { role: "assistant", content: "No doorway. No return. Just the bell." },
      ]),
    ).toBeNull();

    expect(
      detectConversationCraftShape([
        { role: "user", content: "Keep asking me questions like an interview." },
        { role: "assistant", content: "where were you born?" },
        { role: "assistant", content: "what did you study?" },
        { role: "assistant", content: "why did you leave?" },
      ]),
    ).toBeNull();
  });

  it("does not mistake ordinary or negative mentions for style requests", () => {
    expect(
      detectRoleplayCraftShape([
        { role: "user", content: "The ritual ends. Continue plainly." },
        { role: "assistant", content: "No witness. No answer. Just the bell." },
        { role: "assistant", content: "No doorway. No return. Just the dark." },
      ])?.issue,
    ).toBe("contrast-ladder");

    expect(
      detectConversationCraftShape([
        { role: "user", content: "Don't ask me any more questions." },
        { role: "assistant", content: "where were you born?" },
        { role: "assistant", content: "what did you study?" },
        { role: "assistant", content: "why did you leave?" },
      ])?.issue,
    ).toBe("forced-question");
  });

  it("does not classify two terse three-line commands as fragment ladders", () => {
    expect(
      detectRoleplayCraftShape([
        { role: "assistant", content: "Stop. Get out. Don't return." },
        { role: "user", content: "I hesitate." },
        { role: "assistant", content: "Run. Stay low. Keep moving." },
      ]),
    ).toBeNull();
  });

  it("finds repeated non-trivial sentence openings across assistant turns", () => {
    const finding = detectRoleplayCraftShape([
      { role: "assistant", content: "For a long moment, Mara studied the ruined radio beside her." },
      { role: "user", content: "I wait." },
      { role: "assistant", content: "For a long moment, the only answer was rain against glass." },
    ]);

    expect(finding?.issue).toBe("repeated-opening");
    expect(finding?.evidence).toEqual([
      "For a long moment, Mara studied the ruined radio beside her.",
      "For a long moment, the only answer was rain against glass.",
    ]);

    expect(
      detectRoleplayCraftShape([
        { role: "assistant", content: "He said no." },
        { role: "assistant", content: "He said nothing." },
      ]),
    ).toBeNull();
  });
});
