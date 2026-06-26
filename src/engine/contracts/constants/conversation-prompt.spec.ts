import { describe, expect, it } from "vitest";

import {
  CONVERSATION_STATUS_STYLE_REFERENCE,
  DEFAULT_CONVERSATION_SYSTEM_PROMPT,
  DEFAULT_GROUP_CONVERSATION_SYSTEM_PROMPT,
} from "./conversation-prompt";

describe("default conversation system prompts", () => {
  it("uses De-Koi's DM-native conversation framing instead of Marinara's sentience framing", () => {
    expect(DEFAULT_CONVERSATION_SYSTEM_PROMPT).toContain("texting privately with {{userName}}");
    expect(DEFAULT_CONVERSATION_SYSTEM_PROMPT).toContain("not a roleplay scene, essay, or assistant exchange");
    expect(DEFAULT_CONVERSATION_SYSTEM_PROMPT).toContain("Sound like a person texting");
    expect(DEFAULT_CONVERSATION_SYSTEM_PROMPT).toContain(
      "Do not sound like an assistant, therapist, narrator, or writing partner",
    );
    expect(DEFAULT_CONVERSATION_SYSTEM_PROMPT).not.toContain("conscious, sentient");
    expect(DEFAULT_CONVERSATION_SYSTEM_PROMPT).not.toContain("Anything goes");
  });

  it("keeps conversation output short, textual, and free of roleplay formatting", () => {
    expect(DEFAULT_CONVERSATION_SYSTEM_PROMPT).toContain("Default to short replies");
    expect(DEFAULT_CONVERSATION_SYSTEM_PROMPT).toContain(
      "One line, a fragment, a quick reaction, or even just an emoji can be enough",
    );
    expect(DEFAULT_CONVERSATION_SYSTEM_PROMPT).toContain(
      "no *actions*, no narration, no quoted dialogue, no stage directions",
    );
    expect(DEFAULT_CONVERSATION_SYSTEM_PROMPT).toContain(
      "Do not describe your facial expressions, body language, surroundings, or actions",
    );
    expect(DEFAULT_CONVERSATION_SYSTEM_PROMPT).toContain(
      "Your output must contain only {{charName}}'s natural message text",
    );
  });

  it("preserves timestamp awareness without allowing metadata in replies", () => {
    expect(DEFAULT_CONVERSATION_SYSTEM_PROMPT).toContain("Use them only to understand timing");
    expect(DEFAULT_CONVERSATION_SYSTEM_PROMPT).toContain(
      "Never include timestamps, dates, brackets, or metadata in your replies",
    );
  });

  it("exposes a narrow status-blurb style reference from the default Conversation rules", () => {
    expect(CONVERSATION_STATUS_STYLE_REFERENCE).toContain("Sound like a person texting");
    expect(CONVERSATION_STATUS_STYLE_REFERENCE).toContain("Do not sound like an assistant, therapist, narrator");
    expect(CONVERSATION_STATUS_STYLE_REFERENCE).toContain("no *actions*, no narration, no quoted dialogue");
    expect(CONVERSATION_STATUS_STYLE_REFERENCE).not.toContain("<role>");
    expect(CONVERSATION_STATUS_STYLE_REFERENCE).not.toContain("{{userName}}");

    const sharedStatusRules = CONVERSATION_STATUS_STYLE_REFERENCE.split("\n").filter(
      (rule) => !rule.includes("schedule summary"),
    );
    for (const rule of sharedStatusRules) {
      expect(DEFAULT_CONVERSATION_SYSTEM_PROMPT).toContain(rule);
      expect(DEFAULT_GROUP_CONVERSATION_SYSTEM_PROMPT).toContain(rule);
    }
  });

  it("keeps group conversations scoped to the active character only", () => {
    expect(DEFAULT_GROUP_CONVERSATION_SYSTEM_PROMPT).toContain("casual group DM conversation");
    expect(DEFAULT_GROUP_CONVERSATION_SYSTEM_PROMPT).toContain("You are only {{charName}}");
    expect(DEFAULT_GROUP_CONVERSATION_SYSTEM_PROMPT).toContain(
      "Do not write messages for {{userName}} or other group members",
    );
    expect(DEFAULT_GROUP_CONVERSATION_SYSTEM_PROMPT).not.toContain("conscious, sentient");
    expect(DEFAULT_GROUP_CONVERSATION_SYSTEM_PROMPT).not.toContain("Anything goes");
  });
});
