import { describe, expect, it } from "vitest";
import {
  buildFanficAiIsmCleanupNotes,
  detectFanficAiIsms,
  FANFIC_AI_ISM_CLEANUP_SCORE,
  fanficAiIsmNeedsCleanup,
} from "./ai-isms";

const MACHINE = [
  "The kettle did not answer, which he decided to forgive. He had been told it existed. He had not been told it was beige.",
  "",
  "Michael did not move. Dwight did not move either. It wasn't fear. It was something worse.",
  "",
  "He was simply there. The silence was very long and very heavy. Then a step. Then another. For a long moment, nobody breathed.",
].join("\n");

const PLAIN = [
  "Zuko burned the first pot of jasmine tea before the shop even opened. Iroh sniffed it, laughed, and poured it into the potted fern by the door.",
  "",
  '"It likes it strong," he said.',
  "",
  "By noon Zuko had broken one cup, misheard three orders, and learned that the old woman at the corner table wanted her tea lukewarm and her opinions on the Earth King taken seriously. He nodded through all of it.",
].join("\n");

describe("detectFanficAiIsms", () => {
  it("names each machine-sounding habit with the line it came from", () => {
    const report = detectFanficAiIsms(MACHINE);
    const ids = report.findings.map((finding) => finding.id);

    expect(ids).toEqual(
      expect.arrayContaining([
        "negation_beat",
        "wry_which",
        "reframe",
        "simply",
        "doubled_intensifier",
        "then_chain",
        "stock_phrase",
        "echo_openers",
      ]),
    );
    const which = report.findings.find((finding) => finding.id === "wry_which");
    expect(which?.examples[0]).toBe("The kettle did not answer, which he decided to forgive.");
    expect(report.score).toBeGreaterThan(FANFIC_AI_ISM_CLEANUP_SCORE);
  });

  it("leaves ordinary prose under the clean-up threshold", () => {
    const report = detectFanficAiIsms(PLAIN);

    expect(report.score).toBeLessThan(FANFIC_AI_ISM_CLEANUP_SCORE);
  });

  it("allows a few em dashes before counting them", () => {
    const words = Array.from({ length: 1000 }, () => "word").join(" ");
    const light = detectFanficAiIsms(`${words} — one — two — three`);
    const heavy = detectFanficAiIsms(`${words} ${Array.from({ length: 10 }, () => "—").join(" a ")}`);

    expect(light.findings.find((finding) => finding.id === "em_dash")).toBeUndefined();
    expect(heavy.findings.find((finding) => finding.id === "em_dash")?.count).toBe(10 - 4);
  });

  it("ignores a chapter heading the model added", () => {
    expect(detectFanficAiIsms("# Chapter 1: Then Then\n\nShe laughed.").findings).toEqual([]);
  });

  it("flags the narrator's verdict asides but not ordinary relative clauses", () => {
    const ordinary = [
      "They reached the bookshop, which was built in 1800, before the snow got deep.",
      "Crowley ordered the tea, which he drank in one go.",
      "The Bentley, which had seen better decades, idled at the curb.",
    ].join(" ");
    const asides = [
      "The ducks ignored him, which was worse.",
      "The kettle did not answer, which he decided to forgive.",
      "It was nowhere near the A, which was a cruelty.",
      "The cowboy hat, which somehow made it worse, stayed on.",
    ].join("\n");

    expect(detectFanficAiIsms(ordinary).findings.find((finding) => finding.id === "wry_which")).toBeUndefined();
    expect(detectFanficAiIsms(asides).findings.find((finding) => finding.id === "wry_which")?.count).toBe(4);
  });
});

describe("fanficAiIsmNeedsCleanup", () => {
  const filler = (words: number) => Array.from({ length: words }, () => "snow").join(" ");

  it("never offers a clean-up for one stray line in a short scene", () => {
    const short = detectFanficAiIsms(`${filler(40)}. The bookshop, which was old, smelled of dust. He did not move.`);

    expect(short.score).toBeGreaterThan(FANFIC_AI_ISM_CLEANUP_SCORE);
    expect(fanficAiIsmNeedsCleanup(short)).toBe(false);
  });

  it("offers it when a full-length chapter leans on the habits", () => {
    const chapter = `${filler(250)}.\n\n${MACHINE}\n\n${MACHINE}`;

    expect(fanficAiIsmNeedsCleanup(detectFanficAiIsms(chapter))).toBe(true);
    expect(fanficAiIsmNeedsCleanup(detectFanficAiIsms(`${filler(400)}.\n\n${PLAIN}`))).toBe(false);
  });
});

describe("buildFanficAiIsmCleanupNotes", () => {
  it("keeps the story and points the rewrite at the exact lines", () => {
    const notes = buildFanficAiIsmCleanupNotes(detectFanficAiIsms(MACHINE));

    expect(notes).toMatch(/Keep the plot, every beat and joke/);
    expect(notes).toContain('"The kettle did not answer, which he decided to forgive."');
    expect(notes).toContain("Say what the character does");
    expect(notes).toMatch(/Don't swap one habit for another/);
  });
});
