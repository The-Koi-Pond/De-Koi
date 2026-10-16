import { describe, expect, it } from "vitest";

import { buildFanficAiIsmCleanupNotes, detectFanficAiIsms } from "./ai-isms";
import {
  buildFanficRepetitionCleanupLines,
  buildFanficRepetitionGuide,
  detectFanficRepetition,
  fanficRepetitionNames,
} from "./repetition";

const NAMES = ["harlequin", "pierrot"];

/** A chapter where Harlequin calls Pierrot "Bells" over and over and the bells are every reaction beat. */
function bellsChapter(variant: number): string {
  return [
    `"Bells," Harlequin says. "Sit down, Bells, you're making the ceiling nervous."`,
    `Pierrot sits. His bells give a small offended jingle, and the lamp swings on its hook.`,
    `"Bells. Look at them." Harlequin points with a claw. "Bells, they're laughing at you."`,
    `His bells go still. Pierrot folds his hands in his lap and studies the rug for a while.`,
    `"Oh, come on, Bells." Harlequin flops onto the cushions. "It was funny."`,
    `Pierrot's bells shiver once. The tent smells like sugar and old canvas, round ${variant}.`,
    `"Harlequin," Pierrot says at last, "you are impossible." His bells ring, sharp.`,
  ].join("\n\n");
}

describe("detectFanficRepetition", () => {
  it("flags a pet name and a signature detail used in every exchange across the fic", () => {
    const report = detectFanficRepetition([bellsChapter(1), bellsChapter(2), bellsChapter(3)], { names: NAMES });

    expect(report.scope).toBe("work");
    expect(report.chapterCount).toBe(3);
    const petName = report.repeats.find((repeat) => repeat.kind === "pet_name");
    expect(petName).toMatchObject({ term: "Bells", count: 15, chapters: 3 });
    const detail = report.repeats.find((repeat) => repeat.kind === "detail");
    expect(detail).toMatchObject({ term: "bells", count: 12, chapters: 3 });
    expect(detail?.examples[0]).toContain("bells");
  });

  it("never treats character names, interjections, titles, or body words as repeats", () => {
    const chapter = [
      `"Harlequin, stop." "Okay, okay." "Yes, sir." "Please, sir." "Fine, sir." "Sorry, sir." "No, sir."`,
      `His eyes go wide. His eyes narrow. His eyes close. His eyes open. His eyes roll. His eyes shine. His eyes water.`,
      `"Harlequin, wait." "Harlequin, look." "Harlequin, listen." "Well, Harlequin." "Oh, Harlequin."`,
    ].join("\n\n");

    expect(detectFanficRepetition([chapter], { names: NAMES, focus: 0 }).repeats).toEqual([]);
  });

  it("skips names the narration writes capitalized, even when the request does not list them", () => {
    const chapter = [
      `"Reggie, sit." "Reggie, look." "Reggie, no." "Fine, Reggie." "Up, Reggie."`,
      `Reggie sat. Later Reggie looked out of the window, and then Reggie went home.`,
    ].join("\n\n");

    expect(detectFanficRepetition([chapter], { focus: 0 }).repeats).toEqual([]);
  });

  it("ignores describing words that follow a possessive", () => {
    const chapter = Array.from(
      { length: 8 },
      (_, index) => `His long coat swings. The night is long. It was so long ago, line ${index}.`,
    ).join("\n");

    const report = detectFanficRepetition([chapter], { focus: 0 });
    expect(report.repeats.filter((repeat) => repeat.kind === "detail")).toEqual([]);
  });

  it("flags a phrase reused across chapters but not a stutter", () => {
    const chapter = (n: number) =>
      `I want to watch the rain, she thinks. "Come on, come on, come on, come on." Scene ${n} ends here quietly.`;
    const report = detectFanficRepetition([1, 2, 3, 4].map(chapter), {});

    const phrases = report.repeats.filter((repeat) => repeat.kind === "phrase").map((repeat) => repeat.term);
    expect(phrases).toContain("I want to watch");
    expect(phrases.some((phrase) => phrase.includes("come on come"))).toBe(false);
  });

  it("looks inside one chapter when given a focus, using the whole fic to tell names from pet names", () => {
    const quiet = `Pierrot reads by the lamp. "Goodnight," he says, and the tent goes dark.`;
    const report = detectFanficRepetition([quiet, bellsChapter(1)], { names: NAMES, focus: 1 });

    expect(report.scope).toBe("chapter");
    expect(report.chapterCount).toBe(1);
    expect(report.repeats.find((repeat) => repeat.kind === "pet_name")).toMatchObject({ term: "Bells", count: 5 });
    expect(detectFanficRepetition([quiet, bellsChapter(1)], { names: NAMES, focus: 0 }).repeats).toEqual([]);
  });

  it("lets a pet name breathe at about two uses a chapter", () => {
    const chapter = `"Morning, sweetheart." He pours the coffee. "Drink up, sweetheart." The kettle ticks as it cools.`;
    const report = detectFanficRepetition([chapter, chapter, chapter], {});

    expect(report.repeats.filter((repeat) => repeat.kind === "pet_name")).toEqual([]);
  });
});

describe("fanficRepetitionNames", () => {
  it("splits characters, ships, and the POV character into lowercase name words", () => {
    expect(
      fanficRepetitionNames({
        characters: ["Pierrot", "The Doctor"],
        relationships: ["Harlequin/Pierrot", "Jack x Ennis"],
        povCharacter: "",
      }),
    ).toEqual(["pierrot", "the", "doctor", "harlequin", "pierrot", "jack", "ennis"]);
  });
});

describe("repetition guidance", () => {
  const report = detectFanficRepetition([bellsChapter(1), bellsChapter(2), bellsChapter(3)], { names: NAMES });

  it("tells the next chapter what earlier chapters wore out and how rarely to use it", () => {
    const guide = buildFanficRepetitionGuide(report);

    expect(guide).toContain('Calling someone "Bells" (15 times so far, in 3 of 3 chapters): once or twice at most');
    expect(guide).toContain('"bells" as a detail (12 times so far, in 3 of 3 chapters)');
    expect(guide).toContain("Keep anything the plot depends on");
    expect(buildFanficRepetitionGuide({ ...report, repeats: [] })).toBe("");
  });

  it("adds the chapter's repeats to the clean-up notes and lets the rewrite cut them", () => {
    const chapterReport = detectFanficRepetition([bellsChapter(1)], { names: NAMES, focus: 0 });
    const aiIsms = detectFanficAiIsms(bellsChapter(1));
    const notes = buildFanficAiIsmCleanupNotes(aiIsms, chapterReport);

    expect(buildFanficRepetitionCleanupLines(chapterReport)[0]).toBe(
      '- Someone is called "Bells" 5 times. Keep it once or twice at most; drop the rest, since most lines need no name or pet name.',
    );
    expect(notes).toContain("cut the repeats listed below");
    expect(notes).not.toContain("Only change how sentences are built");
    expect(notes).toContain('Someone is called "Bells" 5 times');
    expect(buildFanficAiIsmCleanupNotes(aiIsms)).toContain("Only change how sentences are built");
  });
});
