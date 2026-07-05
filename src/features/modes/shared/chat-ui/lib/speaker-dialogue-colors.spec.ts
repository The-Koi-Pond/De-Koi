import { describe, expect, it } from "vitest";

import { createSpeakerColorLookup, splitSpeakerDialogueColorSegments } from "./speaker-dialogue-colors";

describe("speaker dialogue colors", () => {
  it("uses each speaker tag color case-insensitively on repeated renders", () => {
    const colors = createSpeakerColorLookup([
      ["Alice", "#ff3366"],
      ["Bob", "#33aaff"],
    ]);
    const text = '<speaker="alice">"First."</speaker> <speaker="BOB">"Second."</speaker>';

    expect(splitSpeakerDialogueColorSegments(text, "#ffffff", colors)).toEqual([
      { text: '"First."', color: "#ff3366" },
      { text: " ", color: "#ffffff" },
      { text: '"Second."', color: "#33aaff" },
    ]);
    expect(splitSpeakerDialogueColorSegments(text, "#ffffff", colors)).toEqual([
      { text: '"First."', color: "#ff3366" },
      { text: " ", color: "#ffffff" },
      { text: '"Second."', color: "#33aaff" },
    ]);
  });

  it("colors narrator-style name-prefixed dialogue by the current speaker", () => {
    const colors = createSpeakerColorLookup([
      ["Alice", "#ff3366"],
      ["Bob", "#33aaff"],
    ]);

    expect(splitSpeakerDialogueColorSegments('Alice: "Ready."\nBob: "Always."', "#ffffff", colors)).toEqual([
      { text: "Alice: ", color: "#ffffff" },
      { text: '"Ready."\n', color: "#ff3366" },
      { text: "Bob: ", color: "#ffffff" },
      { text: '"Always."', color: "#33aaff" },
    ]);
  });

  it("colors attributed narrator quotes by the nearest named speaker", () => {
    const colors = createSpeakerColorLookup([
      ["Alice", "#ff3366"],
      ["Bob", "#33aaff"],
    ]);

    expect(
      splitSpeakerDialogueColorSegments('Alice leaned closer. "Ready." Bob smiled. "Always."', "#ffffff", colors),
    ).toEqual([
      { text: "Alice leaned closer. ", color: "#ffffff" },
      { text: '"Ready."', color: "#ff3366" },
      { text: " Bob smiled. ", color: "#ffffff" },
      { text: '"Always."', color: "#33aaff" },
    ]);
  });

  it("colors quote-first attributions by the immediately following speaker", () => {
    const colors = createSpeakerColorLookup([
      ["Mira Vale", "#b58cff"],
      ["Orin", "#44ccff"],
      ["Sable Reed", "#28f26d"],
    ]);

    expect(
      splitSpeakerDialogueColorSegments(
        '"Yes," Mira Vale whispered. "I did not agree," Orin said. "Now it is funny," Sable Reed\'s voice dropped.',
        "#ffffff",
        colors,
      ),
    ).toEqual([
      { text: '"Yes,"', color: "#b58cff" },
      { text: " Mira Vale whispered. ", color: "#ffffff" },
      { text: '"I did not agree,"', color: "#44ccff" },
      { text: " Orin said. ", color: "#ffffff" },
      { text: '"Now it is funny,"', color: "#28f26d" },
      { text: " Sable Reed's voice dropped.", color: "#ffffff" },
    ]);
  });

  it("colors quote-first attributions with nested punctuation and adverbs", () => {
    const colors = createSpeakerColorLookup([
      ["Mira Vale", "#b58cff"],
      ["Orin", "#44ccff"],
    ]);

    expect(
      splitSpeakerDialogueColorSegments(
        '"Ah. \'Technical specifications,\'" Mira Vale repeated. "Please, I implore you!" Orin cried out. "Right! Yes! Thank you!" Orin frantically babbled.',
        "#ffffff",
        colors,
      ),
    ).toEqual([
      { text: "\"Ah. 'Technical specifications,'\"", color: "#b58cff" },
      { text: " Mira Vale repeated. ", color: "#ffffff" },
      { text: '"Please, I implore you!"', color: "#44ccff" },
      { text: " Orin cried out. ", color: "#ffffff" },
      { text: '"Right! Yes! Thank you!"', color: "#44ccff" },
      { text: " Orin frantically babbled.", color: "#ffffff" },
    ]);
  });

  it("does not invent title aliases for a character", () => {
    const colors = createSpeakerColorLookup([["Mira Vale", "#b58cff"]]);

    expect(splitSpeakerDialogueColorSegments('"Welcome," the archivist said.', "#ffffff", colors)).toEqual([
      { text: '"Welcome," the archivist said.', color: "#ffffff" },
    ]);
  });

  it("only colors configured speaker names and aliases", () => {
    const colors = createSpeakerColorLookup([
      ["Mira Vale", "#b58cff"],
      ["The Archivist", "#b58cff"],
    ]);

    expect(splitSpeakerDialogueColorSegments('"Welcome," the archivist said.', "#ffffff", colors)).toEqual([
      { text: '"Welcome,"', color: "#b58cff" },
      { text: " the archivist said.", color: "#ffffff" },
    ]);
  });

  it("colors additional roleplay speech verbs in quote-first attribution", () => {
    const colors = createSpeakerColorLookup([
      ["Mira Vale", "#b58cff"],
      ["Orin", "#44ccff"],
      ["Sable Reed", "#28f26d"],
    ]);

    expect(
      splitSpeakerDialogueColorSegments(
        '"But I cannot argue," Mira Vale noted. "A promise," Orin corrected. "It is for your comfort!" Sable Reed wept.',
        "#ffffff",
        colors,
      ),
    ).toEqual([
      { text: '"But I cannot argue,"', color: "#b58cff" },
      { text: " Mira Vale noted. ", color: "#ffffff" },
      { text: '"A promise,"', color: "#44ccff" },
      { text: " Orin corrected. ", color: "#ffffff" },
      { text: '"It is for your comfort!"', color: "#28f26d" },
      { text: " Sable Reed wept.", color: "#ffffff" },
    ]);
  });

  it("keeps the previous speaker color across same-attribution quote continuations", () => {
    const colors = createSpeakerColorLookup([
      ["Mira Vale", "#b58cff"],
      ["Orin", "#44ccff"],
    ]);

    expect(
      splitSpeakerDialogueColorSegments(
        'Mira Vale leans close. "I want to hear this," she murmurs. "Please make it official." Orin ignores her.',
        "#ffffff",
        colors,
      ),
    ).toEqual([
      { text: "Mira Vale leans close. ", color: "#ffffff" },
      { text: '"I want to hear this,"', color: "#b58cff" },
      { text: " she murmurs. ", color: "#ffffff" },
      { text: '"Please make it official."', color: "#b58cff" },
      { text: " Orin ignores her.", color: "#ffffff" },
    ]);
  });

  it("prefers the speaking subject over a later addressed character name", () => {
    const colors = createSpeakerColorLookup([
      ["Mira Vale", "#b58cff"],
      ["Orin", "#44ccff"],
    ]);

    expect(splitSpeakerDialogueColorSegments('Mira Vale tells Orin, "Sign here."', "#ffffff", colors)).toEqual([
      { text: "Mira Vale tells Orin, ", color: "#ffffff" },
      { text: '"Sign here."', color: "#b58cff" },
    ]);
  });

  it("does not carry color across paragraph breaks for pronoun-only attribution", () => {
    const colors = createSpeakerColorLookup([
      ["Mira Vale", "#b58cff"],
      ["Orin", "#44ccff"],
    ]);

    expect(
      splitSpeakerDialogueColorSegments('Mira Vale smiled. "First."\n\nHe looked away. "Second."', "#ffffff", colors),
    ).toEqual([
      { text: "Mira Vale smiled. ", color: "#ffffff" },
      { text: '"First."', color: "#b58cff" },
      { text: '\n\nHe looked away. "Second."', color: "#ffffff" },
    ]);
  });

  it("does not treat straight double quotes in height measurements as dialogue delimiters", () => {
    const colors = createSpeakerColorLookup([
      ["Doctor", "#00ddff"],
      ["Mira Vale", "#b58cff"],
    ]);

    expect(
      splitSpeakerDialogueColorSegments(
        'Doctor stood 6\'9" tall, his hands still. "On time." Doctor observed.',
        "#ffffff",
        colors,
      ),
    ).toEqual([
      { text: "Doctor stood 6'9\" tall, his hands still. ", color: "#ffffff" },
      { text: '"On time."', color: "#00ddff" },
      { text: " Doctor observed.", color: "#ffffff" },
    ]);
  });
});
