import { describe, expect, it } from "vitest";

import { DEFAULT_IMPERSONATE_PROMPT } from "../../../contracts/constants/impersonate";
import { buildImpersonateInstruction } from "./impersonate-prompt";

describe("impersonate prompt", () => {
  it("frames impersonation as writing only the user's next message", () => {
    expect(DEFAULT_IMPERSONATE_PROMPT).toContain("Write only {{user}}'s next message");
    expect(DEFAULT_IMPERSONATE_PROMPT).toContain("Do not answer as the assistant");
    expect(DEFAULT_IMPERSONATE_PROMPT).toContain("Do not write for any other character");
    expect(DEFAULT_IMPERSONATE_PROMPT).toContain("No speaker labels, prefixes, quotation marks, markdown, or metadata");
    expect(DEFAULT_IMPERSONATE_PROMPT).not.toContain("the user's character");
  });

  it("uses prior user turns as style evidence without parroting exact wording", () => {
    expect(DEFAULT_IMPERSONATE_PROMPT).toContain("Use {{user}}'s prior messages as style evidence");
    expect(DEFAULT_IMPERSONATE_PROMPT).toContain("Do not copy exact phrasing from earlier messages");
    expect(DEFAULT_IMPERSONATE_PROMPT).toContain("Do not overfit into parody");
    expect(DEFAULT_IMPERSONATE_PROMPT).not.toContain(
      "replicate their voice, mannerisms, speech patterns, and style as closely as possible",
    );
  });

  it("treats direction as private steering when rendering the default instruction", () => {
    const instruction = buildImpersonateInstruction({
      personaName: "Celia",
      personaDescription: "A tired engineer with dry humor.",
      direction: "deflect with a joke, then answer honestly",
    });

    expect(instruction).toContain("You are writing Celia's next message");
    expect(instruction).toContain("Persona notes: A tired engineer with dry humor.");
    expect(instruction).toContain("Private steering for this reply: deflect with a joke, then answer honestly");
    expect(instruction).toContain("Treat the steering as intent, not text to quote or explain");
    expect(instruction).not.toContain("{{user}}");
    expect(instruction).not.toContain("{{persona_description}}");
    expect(instruction).not.toContain("{{impersonate_direction}}");
  });

  it("omits optional persona and direction lines when they are empty", () => {
    const instruction = buildImpersonateInstruction({ personaName: "Celia" });

    expect(instruction).toContain("You are writing Celia's next message");
    expect(instruction).not.toContain("Persona notes:");
    expect(instruction).not.toContain("Private steering for this reply:");
  });
});
