import { describe, expect, it } from "vitest";

import { analyzeRoleplayHistory, analyzeRoleplayResponse } from "./roleplay-quality-signals";

function assistant(content: string, extra?: Record<string, unknown>) {
  return { role: "assistant", content, extra };
}

describe("roleplay quality history signals", () => {
  it("finds a repeated conversation-local phrase without building a permanent blacklist", () => {
    const result = analyzeRoleplayHistory({
      messages: [
        assistant("Mira waited for a long moment before answering."),
        assistant("Rain touched the glass for a long moment before she moved."),
        assistant("For a long moment, neither of them spoke."),
      ],
      latestUserInput: "I wait.",
    });

    expect(result.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "repeated_phrase",
          severity: "minor",
          evidence: expect.arrayContaining(["for a long moment"]),
        }),
      ]),
    );
  });

  it("distinguishes repeated sentence openings, question closings, and gesture spans", () => {
    const result = analyzeRoleplayHistory({
      messages: [
        assistant("Without looking away, Mira tilted her head. Do you understand?"),
        assistant("Without looking away, she tilted her head. Will you answer?"),
        assistant("Without looking away, Mira tilted her head again. Are you listening?"),
      ],
      latestUserInput: "I stay silent.",
    });

    expect(result.signals.map((signal) => signal.kind)).toEqual(
      expect.arrayContaining(["repeated_opening", "repeated_closing", "repeated_gesture"]),
    );
    expect(result.guidance.split("\n").length).toBeLessThanOrEqual(4);
  });

  it("keeps similar ordinary prose clean and ignores hidden assistant messages", () => {
    const result = analyzeRoleplayHistory({
      messages: [
        assistant("Mira set the cup beside the map."),
        assistant("She folded the map and checked the window."),
        assistant("Without looking away, she tilted her head. Is that clear?", { hiddenFromAI: true }),
        assistant("Without looking away, she tilted her head. Is that clear?", { hiddenFromAI: true }),
        assistant("Without looking away, she tilted her head. Is that clear?", { hiddenFromAI: true }),
      ],
      latestUserInput: "I point to the road.",
    });

    expect(result).toEqual({ signals: [], guidance: "" });
  });

  it("lets an explicit request for questions override only closing-shape guidance", () => {
    const result = analyzeRoleplayHistory({
      messages: [
        assistant("For a long moment, Mira waits. What happened?"),
        assistant("For a long moment, she listens. Where were you?"),
        assistant("For a long moment, the room stays quiet. What did you see?"),
      ],
      latestUserInput: "Keep asking me questions until we solve it.",
    });

    expect(result.signals.some((signal) => signal.kind === "repeated_closing")).toBe(false);
    expect(result.signals.some((signal) => signal.kind === "repeated_phrase")).toBe(true);
  });
});

describe("roleplay quality response signals", () => {
  const strictAgency =
    "strict agency: never write {{user}}'s dialogue, intent, decisions, or deliberate actions.";

  it.each([
    ["dialogue", '"I accept," Celia says, taking the contract.'],
    ["speaker-labeled dialogue", "Celia: I accept the bargain."],
    ["intent", "You decide to betray Mira before dawn."],
    ["belief", "Celia believes the locked room is empty."],
    ["deliberate action", "You cross the hall and open the sealed door."],
  ])("flags source-backed strict-agency %s candidates", (_label, content) => {
    const result = analyzeRoleplayResponse({
      content,
      personaName: "Celia",
      characterNames: ["Mira"],
      agencyContract: strictAgency,
    });

    expect(result.signals).toEqual([
      expect.objectContaining({
        kind: "agency_candidate",
        severity: "high",
        evidence: [content],
      }),
    ]);
  });

  it.each([
    "You hear rain ticking against the window.",
    "Your breath catches when the floor drops.",
    "The cut stings after you grab the broken glass.",
    "Mira crosses the hall and opens the sealed door.",
    '"Do you think the lock is trapped?" Mira asks.',
    '"What do you want from me?" Mira asks.',
    "Do you want me to open the gate?",
    "Would you accept the bargain if Mira lowered the price?",
    "If you accept the bargain, Mira will open the gate.",
    "Whether you agree or refuse, the choice remains yours.",
  ])("does not flag sensory, involuntary, consequence, or other-character narration: %s", (content) => {
    expect(
      analyzeRoleplayResponse({
        content,
        personaName: "Celia",
        characterNames: ["Mira"],
        agencyContract: strictAgency,
      }).signals,
    ).toEqual([]);
  });

  it.each([
    "organic agency: preserve the user's meaningful choices and speech.",
    "cinematic agency: preserve the user's decisions and spoken words.",
    "",
  ])("does not promote a local candidate without an explicit strict contract: %s", (agencyContract) => {
    expect(
      analyzeRoleplayResponse({
        content: "You agree to the bargain and sign your name.",
        personaName: "Celia",
        characterNames: ["Mira"],
        agencyContract,
      }).signals,
    ).toEqual([]);
  });
});
