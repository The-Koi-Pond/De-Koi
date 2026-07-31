import { describe, expect, it } from "vitest";

import {
  CONVERSATION_CRAFT_AGENT_TYPE,
  CONVERSATION_CRAFT_BASELINE_GUIDANCE,
  conversationCraftDirectiveForIssue,
  emptyConversationCraftState,
  normalizeConversationCraftState,
} from "./conversation-craft";

describe("Conversation Craft contracts", () => {
  it("defines a compact first-reply baseline without imposing fake messiness", () => {
    expect(CONVERSATION_CRAFT_AGENT_TYPE).toBe("conversation-craft");
    expect(CONVERSATION_CRAFT_BASELINE_GUIDANCE).toContain("Do not paraphrase");
    expect(CONVERSATION_CRAFT_BASELINE_GUIDANCE).toContain("canned validation");
    expect(CONVERSATION_CRAFT_BASELINE_GUIDANCE).toContain("polished triplets");
    expect(CONVERSATION_CRAFT_BASELINE_GUIDANCE).toContain("forced closing question");
    expect(CONVERSATION_CRAFT_BASELINE_GUIDANCE).toContain("Explicit style requests control");
    expect(CONVERSATION_CRAFT_BASELINE_GUIDANCE).not.toContain("Always use lowercase");
  });

  it("normalizes and bounds untrusted critic state", () => {
    expect(normalizeConversationCraftState(null)).toEqual(emptyConversationCraftState());
    expect(
      normalizeConversationCraftState({
        version: 99,
        conversationMode: "group",
        recentPatterns: Array.from({ length: 12 }, (_, index) => ` pattern ${index} `.repeat(100)),
        recentStrengths: ["dry humor", "", 42, "distinct voices", "brief replies"],
        pendingGuidance: [" next reply rule ", "must be discarded"],
        lastAnalysisReason: "reason ".repeat(200),
      }),
    ).toEqual({
      version: 1,
      conversationMode: "group",
      recentPatterns: expect.arrayContaining([expect.stringMatching(/^pattern 0/)]),
      recentStrengths: ["dry humor", "distinct voices", "brief replies"],
      pendingGuidance: ["next reply rule"],
      lastAnalysisReason: expect.stringMatching(/^reason/),
    });
    expect(
      normalizeConversationCraftState({ recentPatterns: Array.from({ length: 12 }, (_, index) => `pattern ${index}`) })
        .recentPatterns,
    ).toHaveLength(6);
  });

  it("maps supported issues to bounded solo and group directives", () => {
    expect(conversationCraftDirectiveForIssue("therapy-speak", "solo")).toContain("canned validation");
    expect(conversationCraftDirectiveForIssue("group-omnireply", "group")).toContain(
      "answer only what this character would notice",
    );
    expect(conversationCraftDirectiveForIssue("group-omnireply", "solo")).toBeNull();
    expect(conversationCraftDirectiveForIssue("not-real", "solo")).toBeNull();
  });
});
