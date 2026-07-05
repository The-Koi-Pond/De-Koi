import { describe, expect, it } from "vitest";

import { DEFAULT_AGENT_PROMPTS } from "./agent-prompts";

describe("default agent prompts", () => {
  it("anchors sprite expression selection to the latest turn source", () => {
    const prompt = DEFAULT_AGENT_PROMPTS.expression;

    expect(prompt).toContain("Analyze the latest turn");
    expect(prompt).toContain("Include exactly one expression entry for every sprite owner listed");
    expect(prompt).toContain("Use <latest_user_message> to choose the active user persona's expression");
    expect(prompt).toContain("still needs an entry even when <assistant_response> does not describe their face");
    expect(prompt).toContain("Use <assistant_response> to choose assistant or character expressions");
  });

  it("keeps Illustrator prompts anchored to the latest scene and text-free images", () => {
    const prompt = DEFAULT_AGENT_PROMPTS.illustrator;

    expect(prompt).toContain("provided in <assistant_response>");
    expect(prompt).toContain("do not illustrate an older scene");
    expect(prompt).toContain("hair length, hair style, hair color");
    expect(prompt).toContain("Do not request dialogue text");
    expect(prompt).toContain("speech bubbles");
  });

  it("keeps CYOA choices aligned with the chat perspective and tense", () => {
    const prompt = DEFAULT_AGENT_PROMPTS.cyoa;

    expect(prompt).toContain(
      "Match the perspective and verb tense already used for the player's messages and actions in the chat",
    );
    expect(prompt).toContain(
      "If the chat is written in first person, second person, third person, past tense, present tense, or future tense, keep that style",
    );
    expect(prompt).not.toContain("Write them in first person");
    expect(prompt).toContain("preserving the chat's perspective and tense");
  });

  it("gives Music Player its own YouTube-first scene intent prompt", () => {
    const prompt = DEFAULT_AGENT_PROMPTS["music-dj"];

    expect(prompt).toContain("YouTube-first Music Player");
    expect(prompt).toContain("meaningful mood shift");
    expect(prompt).toContain('"action": "play" | "volume" | "none"');
    expect(prompt).toContain('"setting"');
    expect(prompt).toContain('"constraints"');
    expect(prompt).not.toContain("spotify_play");
  });
});