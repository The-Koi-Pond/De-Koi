import { describe, expect, it } from "vitest";

import { DEFAULT_AGENT_PROMPTS, ROLEPLAY_QUALITY_EDITOR_PROMPT } from "./agent-prompts";

describe("default agent prompts", () => {
  it("constrains focused Roleplay quality corrections to exact bounded edits", () => {
    expect(ROLEPLAY_QUALITY_EDITOR_PROMPT).toContain('"edits"');
    expect(ROLEPLAY_QUALITY_EDITOR_PROMPT).toContain('"before"');
    expect(ROLEPLAY_QUALITY_EDITOR_PROMPT).toContain('"after"');
    expect(ROLEPLAY_QUALITY_EDITOR_PROMPT).toContain("Do not return the complete response");
    expect(ROLEPLAY_QUALITY_EDITOR_PROMPT).toContain("explicit, dark, violent, coercive, romantic, or sexual");
    expect(ROLEPLAY_QUALITY_EDITOR_PROMPT).toContain("MUST NOT be longer");
    expect(ROLEPLAY_QUALITY_EDITOR_PROMPT).toContain("agencyContract");
    expect(ROLEPLAY_QUALITY_EDITOR_PROMPT).not.toContain('"editedText"');
  });

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

  it("keeps the Background agent generation-only", () => {
    const prompt = DEFAULT_AGENT_PROMPTS.background;

    expect(prompt).toContain("never select or apply an existing background");
    expect(prompt).toContain("only when no current background is set");
    expect(prompt).not.toContain("pick the closest match");
    expect(prompt).not.toContain('"chosen": "filename.ext or null"');
  });

  it("makes Narrative Craft structured, sparse, and non-formulaic", () => {
    const prompt = DEFAULT_AGENT_PROMPTS["narrative-craft"];

    expect(prompt).toContain("Return exactly one JSON object");
    expect(prompt).toContain('"text": ""');
    expect(prompt).toContain("zero or one");
    expect(prompt).toContain("Preserve character voice");
    expect(prompt).toContain("Trust the reader");
    expect(prompt).toContain("state emotions plainly");
    expect(prompt).toContain("setting as an automatic psychological mirror");
    expect(prompt).toContain("Not every turn needs escalation");
    expect(prompt).toContain("independent threads");
    expect(prompt).toContain("Never invent user facts");
    expect(prompt).toContain("Do not classify a requested choice as a defect");
    expect(prompt).toContain('"evidence": []');
    expect(prompt).toContain('"issue": ""');
    expect(prompt).toContain("The runtime constructs the directive");
    expect(prompt).toContain("different exact short excerpts copied from recent assistant prose");
    expect(prompt).toContain("one flat JSON array of exactly two strings; never nest evidence pairs");
    expect(prompt).toContain("Before any assistant message exists");
    expect(prompt).toContain("An assistant-role message always counts as existing assistant prose");
    expect(prompt).toContain("Never reinterpret an assistant-role message as user-authored scene direction");
    expect(prompt).toContain("Do not treat the unanswered current user message as an opening turn");
    expect(prompt).toContain("Actively inspect existing assistant prose");
    expect(prompt).toContain("explanation after an image");
    expect(prompt).toContain("concrete image or sensory detail");
    expect(prompt).toContain("not factual exposition about a stated procedure");
    expect(prompt).toContain("Never classify deliberate action, task mechanics, object movement");
    expect(prompt).toContain("When the same listed pattern appears in two assistant messages");
    expect(prompt).toContain("explicitly sentient or speaking");
    expect(prompt).toContain("requested ritual, chorus, procedure, or formal refrain");
    expect(prompt).toContain("distinct, causally necessary events in an ongoing physical hazard");
    expect(prompt).toContain("Do not stay silent merely because grammar, continuity, and general scene quality are good");
    expect(prompt).toContain("If you cannot quote the problem twice, stay silent");
    expect(prompt).toContain("<assistant_response>");
    expect(prompt).toContain("completed assistant response");
    expect(prompt).toContain("later reply");
    expect(prompt).not.toContain("pre-generation story editor");
    expect(prompt).not.toMatch(/AI detector|undetectable/i);
    expect(prompt).not.toContain("Rotate which senses you emphasize");
  });

  it("makes Conversation Craft structured, mode-aware, and unable to author directives", () => {
    const prompt = DEFAULT_AGENT_PROMPTS["conversation-craft"];

    expect(prompt).toContain("quiet background texting critic");
    expect(prompt).toContain("<assistant_response>");
    expect(prompt).toContain("<conversation_craft_state>");
    expect(prompt).toContain('"text": ""');
    expect(prompt).toContain('"issue": ""');
    expect(prompt).toContain('"conversationMode": "solo|group"');
    expect(prompt).toContain("The runtime constructs the directive");
    expect(prompt).toContain("exact excerpts copied from assistant messages");
    expect(prompt).toContain("explicitly requested style");
    expect(prompt).toContain("group-omnireply");
    expect(prompt).toContain("group-voice-collapse");
    expect(prompt).not.toMatch(/AI detector|undetectable/i);
  });

  it("retires the three overlapping narrative prompts", () => {
    expect(DEFAULT_AGENT_PROMPTS).not.toHaveProperty("prose-guardian");
    expect(DEFAULT_AGENT_PROMPTS).not.toHaveProperty("director");
    expect(DEFAULT_AGENT_PROMPTS).not.toHaveProperty("secret-plot-driver");
  });
});
