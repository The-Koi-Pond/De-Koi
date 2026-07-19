import { describe, expect, it } from "vitest";
import { buildBehavioralExamplePool, selectBehavioralExamples } from "./behavioral-example-pool";

describe("buildBehavioralExamplePool", () => {
  it("parses separate authored example exchanges without resolving macros", () => {
    const candidates = buildBehavioralExamplePool([
      {
        id: "mira",
        name: "Mira",
        mesExample: [
          "<START>",
          "{{user}}: You missed me?",
          "{{char}}: Tragically. Don't make it weird.",
          "<START>",
          "{{user}}: Hand over the key.",
          "{{char}}: No. Ask like you mean it.",
        ].join("\n"),
      },
    ]);

    expect(candidates).toHaveLength(2);
    expect(candidates.map((candidate) => candidate.dialogueText)).toEqual([
      "<START>\n{{user}}: You missed me?\n{{char}}: Tragically. Don't make it weird.",
      "<START>\n{{user}}: Hand over the key.\n{{char}}: No. Ask like you mean it.",
    ]);
    expect(
      candidates.map((candidate) => [candidate.characterId, candidate.sourceField, candidate.sourceIndex]),
    ).toEqual([
      ["mira", "mes_example", 0],
      ["mira", "mes_example", 1],
    ]);
    expect(candidates.every((candidate) => candidate.version === 1 && candidate.id && candidate.contentHash)).toBe(
      true,
    );
  });

  it("collects authored greetings and explicit character quotes while rejecting guesses and duplicates", () => {
    const candidates = buildBehavioralExamplePool([
      {
        id: "mira",
        name: "Mira",
        mesExample: [
          "This malformed prose is not an exchange.",
          "<START>",
          "{{char}}: Keep your hands where I can see them.",
          "<START>",
          "Narration without a speaker.",
        ].join("\n"),
        firstMes: "Keep your hands where I can see them.",
        alternateGreetings: ["  Keep your hands where I can see them.  ", "{{user}}, you came back."],
        description: ['Mira: "Promises are expensive."', '"Unowned dialogue must not be inferred."'].join("\n"),
        backstory: '{{char}}: "I left before dawn."',
        scenario: 'A stranger says: "This line is not Mira\'s."',
      },
    ]);

    expect(candidates.map((candidate) => [candidate.sourceField, candidate.dialogueText])).toEqual([
      ["mes_example", "<START>\n{{char}}: Keep your hands where I can see them."],
      ["alternate_greeting", "<START>\n{{char}}: {{user}}, you came back."],
      ["description_quote", '<START>\n{{char}}: "Promises are expensive."'],
      ["backstory_quote", '<START>\n{{char}}: "I left before dawn."'],
    ]);
  });
});

describe("selectBehavioralExamples", () => {
  it("deterministically selects the authored exchange most relevant to the current turn", async () => {
    const candidates = buildBehavioralExamplePool([
      {
        id: "mira",
        name: "Mira",
        mesExample: [
          "<START>\n{{user}}: Nice weather.\n{{char}}: The clouds are tolerable.",
          "<START>\n{{user}}: Surrender the vault key.\n{{char}}: No. Threats make me less cooperative.",
          "<START>\n{{user}}: Did the joke land?\n{{char}}: It fell down the stairs.",
        ].join("\n"),
      },
    ]);
    const input = {
      candidates,
      queryText: "I order you to surrender the key.",
      visibleHistory: [],
      selectionThresholdTokens: 1,
      tokenBudget: 80,
      candidateCap: 1,
    };

    const first = await selectBehavioralExamples(input);
    const second = await selectBehavioralExamples(input);

    expect(first.activated).toBe(true);
    expect(first.mode).toBe("lexical");
    expect(first.selected.map((entry) => entry.candidate.sourceIndex)).toEqual([1]);
    expect(second.selected.map((entry) => entry.candidate.id)).toEqual(
      first.selected.map((entry) => entry.candidate.id),
    );
  });

  it("uses supplied semantic embeddings when they are complete", async () => {
    const candidates = buildBehavioralExamplePool([
      {
        id: "mira",
        name: "Mira",
        mesExample: [
          "<START>\n{{user}}: Nice weather.\n{{char}}: The clouds are tolerable.",
          "<START>\n{{user}}: I feel awful.\n{{char}}: Sit down. I made tea.",
        ].join("\n"),
      },
    ]);

    const result = await selectBehavioralExamples({
      candidates,
      queryText: "Could you comfort me?",
      visibleHistory: [],
      selectionThresholdTokens: 1,
      tokenBudget: 80,
      candidateCap: 1,
      embed: async () => [
        [1, 0],
        [0, 1],
        [1, 0],
      ],
    });

    expect(result.mode).toBe("semantic");
    expect(result.selected.map((entry) => entry.candidate.sourceIndex)).toEqual([1]);
    expect(result.selected[0]?.semanticScore).toBe(1);
  });

  it("suppresses an authored greeting already visible after normal macro resolution", async () => {
    const candidates = buildBehavioralExamplePool([
      {
        id: "mira",
        name: "Mira",
        firstMes: "{{char}}, wait at the door.",
        mesExample: "<START>\n{{user}}: What now?\n{{char}}: Keep moving.",
      },
    ]);

    const result = await selectBehavioralExamples({
      candidates,
      queryText: "Mira should wait at the door.",
      visibleHistory: ["Mira, wait at the door."],
      selectionThresholdTokens: 1,
      tokenBudget: 80,
      candidateCap: 1,
      resolveForHistory: (text) => text.replaceAll("{{char}}", "Mira"),
    });

    expect(result.selected.map((entry) => entry.candidate.sourceField)).toEqual(["mes_example"]);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "history_overlap",
          candidate: expect.objectContaining({ sourceField: "first_mes" }),
        }),
      ]),
    );
  });

  it("keeps a baseline authored exchange beside the strongest turn-relevant example when budget allows", async () => {
    const candidates = buildBehavioralExamplePool([
      {
        id: "mira",
        name: "Mira",
        mesExample: "<START>\n{{user}}: Hello.\n{{char}}: Keep your voice down.",
        alternateGreetings: ["The vault key stays with me.", "The key is not a subject for jokes."],
      },
    ]);

    const result = await selectBehavioralExamples({
      candidates,
      queryText: "Tell me about the vault key.",
      visibleHistory: [],
      selectionThresholdTokens: 1,
      tokenBudget: 120,
      candidateCap: 2,
    });

    expect(result.selected.map((entry) => [entry.candidate.sourceField, entry.candidate.sourceIndex])).toEqual([
      ["alternate_greeting", 0],
      ["mes_example", 0],
    ]);
  });
});
