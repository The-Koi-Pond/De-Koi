import { describe, expect, it } from "vitest";

import { CONVERSATION_CRAFT_BASELINE_GUIDANCE, conversationCraftDirectiveForIssue } from "./conversation-craft";

describe("Conversation Craft contracts", () => {
  it("defines a compact first-reply baseline without imposing fake messiness", () => {
    expect(CONVERSATION_CRAFT_BASELINE_GUIDANCE).toContain("Do not paraphrase");
    expect(CONVERSATION_CRAFT_BASELINE_GUIDANCE).toContain("canned validation");
    expect(CONVERSATION_CRAFT_BASELINE_GUIDANCE).toContain("polished triplets");
    expect(CONVERSATION_CRAFT_BASELINE_GUIDANCE).toContain("forced closing question");
    expect(CONVERSATION_CRAFT_BASELINE_GUIDANCE).toContain("what they really mean");
    expect(CONVERSATION_CRAFT_BASELINE_GUIDANCE).toContain("one direct reaction");
    expect(CONVERSATION_CRAFT_BASELINE_GUIDANCE).toContain("Explicit style requests control");
    expect(CONVERSATION_CRAFT_BASELINE_GUIDANCE).not.toContain("Always use lowercase");
  });

  it("maps supported issues to bounded solo and group directives", () => {
    expect(conversationCraftDirectiveForIssue("therapy-speak", "solo")).toContain("canned validation");
    expect(conversationCraftDirectiveForIssue("group-omnireply", "group")).toContain(
      "respond to what this character naturally cares about",
    );
    expect(conversationCraftDirectiveForIssue("group-omnireply", "solo")).toBeNull();
    expect(conversationCraftDirectiveForIssue("not-real", "solo")).toBeNull();
  });
});
