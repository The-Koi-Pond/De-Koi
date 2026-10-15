import { describe, expect, it } from "vitest";
import { ttsConfigSchema, type TTSConfig } from "../../../../engine/contracts/types/tts";
import { buildFanficNarration, fanficNarrationText, fanficProseBlocks, type FanficNarrationChapter } from "./narration";

function ttsConfig(overrides: Partial<TTSConfig> = {}): TTSConfig {
  return ttsConfigSchema.parse({ enabled: true, ...overrides });
}

const chapter: FanficNarrationChapter = {
  messageId: "msg-1",
  number: 1,
  heading: "Chapter 1: Lagging",
  content: [
    "# Chapter 1: Lagging",
    "",
    "The bookshop was *closed*, which meant nothing to Crowley.",
    "",
    "* * *",
    "",
    '"Angel," he said. **"We need to talk."**',
  ].join("\n"),
};

describe("fanficProseBlocks", () => {
  it("matches the paragraphs the reader renders, without the chapter heading", () => {
    expect(fanficProseBlocks(chapter.content)).toEqual([
      "The bookshop was *closed*, which meant nothing to Crowley.",
      "* * *",
      '"Angel," he said. **"We need to talk."**',
    ]);
  });
});

describe("fanficNarrationText", () => {
  it("drops emphasis markers so the voice never reads them out", () => {
    expect(fanficNarrationText("She was *very* sure, **really** ~~not~~ _sure_.")).toBe(
      "She was very sure, really not sure.",
    );
    expect(fanficNarrationText("A stray * star and line\nbreak")).toBe("A stray star and line break");
  });
});

describe("buildFanficNarration", () => {
  it("reads the heading, then each paragraph in the narrator voice, skipping scene breaks", () => {
    const plan = buildFanficNarration(
      [chapter],
      ttsConfig({ source: "elevenlabs", voice: "global", narratorVoiceEnabled: true, narratorVoice: "narrator" }),
    );

    expect(plan.problem).toBeNull();
    expect(plan.parts.map(({ text, block }) => ({ text, block }))).toEqual([
      { text: "Chapter 1: Lagging.", block: null },
      { text: "The bookshop was closed, which meant nothing to Crowley.", block: 0 },
      { text: '"Angel," he said. "We need to talk."', block: 2 },
    ]);
    expect(plan.parts.every((part) => part.voice === "narrator" && part.speaker === "Narrator")).toBe(true);
    expect(plan.parts.every((part) => part.chapterNumber === 1)).toBe(true);
    expect(plan.characters).toBe(plan.parts.reduce((sum, part) => sum + part.text.length, 0));
  });

  it("splits long paragraphs into provider-sized parts that all point at the same paragraph", () => {
    const longParagraph = Array.from({ length: 60 }, (_, index) => `Sentence number ${index} goes on a while.`).join(
      " ",
    );
    const plan = buildFanficNarration([{ ...chapter, content: longParagraph }], ttsConfig({ voice: "alloy" }));
    const paragraphParts = plan.parts.filter((part) => part.block === 0);

    expect(paragraphParts.length).toBeGreaterThan(1);
    expect(paragraphParts.every((part) => part.text.length <= 900)).toBe(true);
    expect(paragraphParts.map((part) => part.text).join(" ")).toBe(longParagraph);
  });

  it("keys the audio cache by chapter text, so an edited chapter gets fresh audio", () => {
    const config = ttsConfig({ voice: "alloy" });
    const before = buildFanficNarration([chapter], config).parts;
    const same = buildFanficNarration([chapter], config).parts;
    const edited = buildFanficNarration(
      [{ ...chapter, content: chapter.content.replace("closed", "shut") }],
      config,
    ).parts;

    expect(same.map((part) => part.cacheKey)).toEqual(before.map((part) => part.cacheKey));
    expect(edited[0]!.cacheKey).toBe(before[0]!.cacheKey);
    expect(edited[1]!.cacheKey).not.toBe(before[1]!.cacheKey);
  });

  it("labels each chapter's parts when reading the whole work", () => {
    const plan = buildFanficNarration(
      [chapter, { ...chapter, messageId: "msg-2", number: 2, heading: "Chapter 2", content: "It rained." }],
      ttsConfig({ voice: "alloy" }),
    );

    expect(plan.parts.map((part) => [part.chapterNumber, part.text])).toEqual([
      [1, "Chapter 1: Lagging."],
      [1, "The bookshop was closed, which meant nothing to Crowley."],
      [1, '"Angel," he said. "We need to talk."'],
      [2, "Chapter 2."],
      [2, "It rained."],
    ]);
  });

  it("asks for an ElevenLabs voice instead of sending requests without one", () => {
    const plan = buildFanficNarration([chapter], ttsConfig({ source: "elevenlabs", voice: "" }));

    expect(plan.parts).toEqual([]);
    expect(plan.problem).toMatch(/ElevenLabs voice/);
  });
});
