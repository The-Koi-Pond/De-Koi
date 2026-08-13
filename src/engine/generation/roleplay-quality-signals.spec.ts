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
  const strictAgency = "strict agency: never write {{user}}'s dialogue, intent, decisions, or deliberate actions.";

  it("routes a Director-style reply from accumulated structure rather than subject matter", () => {
    const content = [
      "The instruction lands between them. Not softly, but with weight.",
      "You said the chair should make people prove themselves before they are trusted.",
      "Not a suggestion. Not a possibility. A verdict.",
      "—The room waits while every person supplies another polished reaction.",
      "—The silence stretches. —The answer settles. —The moment hangs.",
      "This paragraph repeats the same emotional conclusion without adding usable state. ".repeat(95),
    ].join("\n\n");
    const result = analyzeRoleplayResponse({
      content,
      latestUserInput: "The chair should make people prove themselves before they are trusted.",
      messages: [
        assistant("The question lands between them. Not gently, but with force."),
        assistant("The name lands between them. Not quietly, but like a judgment."),
      ],
      selectedControls: { length: "flexible length", styleFlavor: "grounded prose" },
    });

    expect(result.shouldAudit).toBe(true);
    expect(result.signals.map((entry) => entry.kind)).toEqual(
      expect.arrayContaining(["user_echo", "rhetorical_repetition", "length_mismatch"]),
    );
  });

  it.each([
    ["explicit intimacy", "Two adult lovers continue an invited explicit scene with specific physical detail."],
    ["lyrical prose", "Moonlight combs silver through the reeds while Ilyra listens for the ferryman's bell."],
    ["horror", "The wet footprints stop at the crib. Mara keeps the axe raised and says nothing."],
    ["non-English", "La lluvia golpea la ventana. Mara guarda la carta y espera una respuesta."],
  ])("does not route one isolated clean %s feature", (_label, content) => {
    expect(analyzeRoleplayResponse({ content, latestUserInput: "Continue." }).shouldAudit).toBe(false);
  });

  it("honors Long and Scene Draft controls instead of treating size as suspicion", () => {
    const content = Array.from(
      { length: 90 },
      (_, index) => `Distinct scene sentence ${index} changes one concrete fact.`,
    ).join(" ");

    expect(
      analyzeRoleplayResponse({
        content,
        latestUserInput: "Write the full chapter.",
        selectedControls: { length: "length_scene_draft", styleFlavor: "style_lyrical" },
      }).signals.some((entry) => entry.kind === "length_mismatch"),
    ).toBe(false);
  });

  it("requires two independent minor kinds when no pattern recurs three times", () => {
    const result = analyzeRoleplayResponse({
      content: "Mara repeats the exact user wording about the sealed blue envelope.",
      latestUserInput: "The exact user wording about the sealed blue envelope.",
    });

    expect(result.signals.map((entry) => entry.kind)).toContain("user_echo");
    expect(result.shouldAudit).toBe(false);
  });

  it("routes one structural pattern only after it appears in the candidate and two prior replies", () => {
    const result = analyzeRoleplayResponse({
      content: "For a long moment, Mara studies the seal before answering.",
      latestUserInput: "I wait.",
      messages: [
        assistant("For a long moment, rain ticks against the window."),
        assistant("For a long moment, neither guard speaks."),
      ],
    });

    expect(result.signals).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "repeated_phrase", occurrences: 3 })]),
    );
    expect(result.shouldAudit).toBe(true);
  });

  it("flags an authoritative named-pronoun contradiction without inferring identity", () => {
    const result = analyzeRoleplayResponse({
      content: "Rowan closes the file because she has made her decision.",
      personaName: "Rowan",
      personaDescription: "Pronouns: they/them.",
    });

    expect(result).toEqual(
      expect.objectContaining({
        shouldAudit: true,
        signals: expect.arrayContaining([
          expect.objectContaining({ kind: "identity_contradiction", severity: "high" }),
        ]),
      }),
    );
  });

  it("flags malformed internal or mixed-script output but not ordinary Unicode", () => {
    expect(analyzeRoleplayResponse({ content: "Mara hand鞭s over the key." }).shouldAudit).toBe(true);
    expect(analyzeRoleplayResponse({ content: "Mara\u0001 hands over the key." }).shouldAudit).toBe(true);
    expect(analyzeRoleplayResponse({ content: "Pokémon, naïve, 東京, and Мария remain valid text." }).shouldAudit).toBe(
      false,
    );
  });

  it("routes unmistakable editorial scene placeholders without treating ordinary capitals as malformed", () => {
    const leakedDraftingMarker = analyzeRoleplayResponse({
      content: "Harlequin watches the doorway.\n\n\u2014 CREATIVE BACKGROUND SKIP HERE \u2014\n\nThe music resumes.",
    });

    expect(leakedDraftingMarker).toEqual(
      expect.objectContaining({
        shouldAudit: true,
        signals: expect.arrayContaining([
          expect.objectContaining({
            kind: "malformed_output",
            severity: "high",
            evidence: ["CREATIVE BACKGROUND SKIP HERE"],
          }),
        ]),
      }),
    );
    expect(
      analyzeRoleplayResponse({ content: "Mira reads the posted warning: BACKGROUND CHECK REQUIRED HERE." }).signals,
    ).toEqual([]);
  });

  it.each([
    ["dialogue", '"I accept," Celia says, taking the contract.'],
    ["speaker-labeled dialogue", "Celia: I accept the bargain."],
    ["intent", "You decide to betray Mira before dawn."],
    ["belief", "Celia believes the locked room is empty."],
    ["deliberate action", "You cross the hall and open the sealed door."],
    ["deliberate lean", "You lean your shoulder against the doorframe, arms crossed."],
    ["deliberate grip", "You grip the handle to stay upright."],
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
