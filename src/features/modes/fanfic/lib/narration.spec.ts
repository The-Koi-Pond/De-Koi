import { describe, expect, it } from "vitest";
import { ttsConfigSchema, type TTSConfig } from "../../../../engine/contracts/types/tts";
import {
  buildFanficNarration,
  fanficNarrationText,
  fanficProseBlocks,
  fanficScriptLine,
  fanficSoundEffect,
  type FanficNarrationChapter,
} from "./narration";

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

const scriptChapter: FanficNarrationChapter = {
  messageId: "msg-script",
  number: 1,
  heading: "Chapter 1",
  content: [
    "[SFX: Rain on a window. A phone screen tapping.]",
    "",
    "(You open the app. The rain gets louder.)",
    "",
    "**PIERROT:** (delighted, softly) Good evening, my dear! (a pause) I missed you.",
    "",
    "(a shaky pause)",
    "",
    "HARLEQUIN (dry): Must you?",
    "",
    "[END OF AUDIO]",
  ].join("\n"),
};

describe("fanficScriptLine", () => {
  it("never speaks production notes, cue-only paragraphs, or speaker labels", () => {
    expect(fanficScriptLine("[SFX: Rain on a window.]", "inline")).toBeNull();
    expect(fanficScriptLine("[END OF AUDIO]", "tone")).toBeNull();
    expect(fanficScriptLine("(a shaky pause)", "inline")).toBeNull();
    expect(fanficScriptLine("**PIERROT:** (laughs)", "inline")).toBeNull();
    expect(fanficScriptLine("**Pierrot**: Hello there.", "drop")).toEqual({ text: "Hello there." });
    expect(fanficScriptLine("PIERROT: Hello there.", "drop")).toEqual({ text: "Hello there." });
  });

  it("turns delivery cues into ElevenLabs v3 audio tags where they were written", () => {
    expect(fanficScriptLine("**PIERROT:** (softly) Good evening! (a pause) I missed you.", "inline")).toEqual({
      text: "[softly] Good evening! [a pause] I missed you.",
    });
    expect(fanficScriptLine("HARLEQUIN (dry): Must you?", "inline")).toEqual({ text: "[dry] Must you?" });
  });

  it("passes the opening cue as a tone, or drops cues, for voices that can't act out tags", () => {
    expect(fanficScriptLine("**PIERROT:** (softly) Good evening! (a pause) I missed you.", "tone")).toEqual({
      text: "Good evening! I missed you.",
      tone: "softly",
    });
    expect(fanficScriptLine("**PIERROT:** (softly) Good evening! (a pause) I missed you.", "drop")).toEqual({
      text: "Good evening! I missed you.",
    });
  });

  it("reads parenthesised stage directions as story, and leaves ordinary prose alone", () => {
    expect(fanficScriptLine("(You open the app. The rain gets louder.)", "inline")).toEqual({
      text: "You open the app. The rain gets louder.",
    });
    for (const prose of [
      "Note: she never came back.",
      "He said (quietly) that it was fine.",
      "The file read [redacted] in red ink.",
      "The sign on the door said [OPEN] in red.",
      '"Angel," he said. **"We need to talk."**',
    ]) {
      expect(fanficScriptLine(prose, "inline")).toEqual({ text: fanficNarrationText(prose) });
    }
  });
});

describe("buildFanficNarration with an audio-script chapter", () => {
  it("reads only what a listener should hear, with cues as v3 tags", () => {
    const plan = buildFanficNarration(
      [scriptChapter],
      ttsConfig({ source: "elevenlabs", model: "eleven_v3", voice: "pierrot" }),
    );

    expect(plan.parts.map(({ text, block, tone }) => ({ text, block, tone }))).toEqual([
      { text: "Chapter 1.", block: null, tone: undefined },
      { text: "You open the app. The rain gets louder.", block: 1, tone: undefined },
      { text: "[delighted, softly] Good evening, my dear! [a pause] I missed you.", block: 2, tone: undefined },
      { text: "[dry] Must you?", block: 4, tone: undefined },
    ]);
  });

  it("sends the opening cue as a tone for other providers, and keys the cache by it", () => {
    const config = ttsConfig({ source: "openai", voice: "alloy" });
    const parts = buildFanficNarration([scriptChapter], config).parts;
    const line = parts.find((part) => part.block === 2)!;

    expect(line).toMatchObject({ text: "Good evening, my dear! I missed you.", tone: "delighted, softly" });
    const withoutTone = buildFanficNarration(
      [{ ...scriptChapter, content: "**PIERROT:** Good evening, my dear! I missed you." }],
      config,
    ).parts[1]!;
    expect(withoutTone.text).toBe(line.text);
    expect(withoutTone.cacheAliases).not.toEqual(line.cacheAliases);
  });
});

describe("buildFanficNarration with sound effects", () => {
  const soundConfig = (overrides: Partial<TTSConfig> = {}) =>
    ttsConfig({ source: "elevenlabs", model: "eleven_v3", voice: "pierrot", fanficSoundEffects: true, ...overrides });

  it("plays [SFX: …] paragraphs as sounds in reading order and counts them apart from speech", () => {
    const plan = buildFanficNarration([scriptChapter], soundConfig());

    expect(plan.parts.map(({ text, block, kind }) => ({ text, block, kind }))).toEqual([
      { text: "Chapter 1.", block: null, kind: undefined },
      { text: "Rain on a window. A phone screen tapping.", block: 0, kind: "sound_effect" },
      { text: "You open the app. The rain gets louder.", block: 1, kind: undefined },
      { text: "[delighted, softly] Good evening, my dear! [a pause] I missed you.", block: 2, kind: undefined },
      { text: "[dry] Must you?", block: 4, kind: undefined },
    ]);
    expect(plan.soundEffects).toBe(1);
    expect(plan.characters).toBe(
      plan.parts.filter((part) => part.kind !== "sound_effect").reduce((sum, part) => sum + part.text.length, 0),
    );
  });

  it("keys a sound by its description only, so voice changes and other chapters reuse it", () => {
    const sound = (config: TTSConfig, messageId: string) =>
      buildFanficNarration([{ ...scriptChapter, messageId }], config).parts.find((part) => part.kind)!;

    const first = sound(soundConfig(), "msg-a");
    expect(sound(soundConfig({ voice: "freddy", speed: 2 }), "msg-b").cacheKey).toBe(first.cacheKey);
    expect(first.cacheKey).toMatch(/^fanfic-sfx-v1:/);
  });

  it("stays silent for sound cues when the setting is off, the provider isn't ElevenLabs, or it goes through NanoGPT", () => {
    for (const config of [
      soundConfig({ fanficSoundEffects: false }),
      ttsConfig({ source: "openai", voice: "alloy", fanficSoundEffects: true }),
      soundConfig({ baseUrl: "https://nano-gpt.com/api/v1" }),
    ]) {
      const plan = buildFanficNarration([scriptChapter], config);
      expect(plan.soundEffects).toBe(0);
      expect(plan.parts.some((part) => /Rain on a window/.test(part.text))).toBe(false);
    }
  });

  it("only treats a whole sound-cue paragraph as a sound", () => {
    expect(fanficSoundEffect("[SFX: A door creaks.]")).toBe("A door creaks.");
    expect(fanficSoundEffect("[Sound effect:   distant   thunder]")).toBe("distant thunder");
    expect(fanficSoundEffect("[END OF AUDIO]")).toBeNull();
    expect(fanficSoundEffect("She heard it. [SFX: A door creaks.]")).toBeNull();
    expect(fanficSoundEffect("[SFX: ]")).toBeNull();
  });
});
