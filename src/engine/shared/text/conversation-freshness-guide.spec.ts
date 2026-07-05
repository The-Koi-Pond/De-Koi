import { describe, expect, it } from "vitest";
import { buildConversationFreshnessGuide } from "./conversation-freshness-guide";

describe("buildConversationFreshnessGuide", () => {
  it("does not add guidance without conversation history", () => {
    expect(
      buildConversationFreshnessGuide({
        chatMode: "conversation",
        messages: [],
        latestUserInput: "Hello.",
      }),
    ).toBeNull();
  });

  it("warns conversation generations away from repeated question endings and stock check-ins", () => {
    const guide = buildConversationFreshnessGuide({
      chatMode: "conversation",
      latestUserInput: "Tell me what you think.",
      messages: [
        { role: "assistant", content: "That sounds exhausting. How are you feeling about it?" },
        { role: "user", content: "A little stuck." },
        { role: "assistant", content: "I hear you. Does that make sense?" },
        { role: "assistant", content: "It sounds like this has been weighing on you. What would help right now?" },
      ],
    });

    expect(guide).toContain("Conversation freshness guide");
    expect(guide).toContain("avoid ending this reply with another question");
    expect(guide).toContain("avoid stock reassurance, therapy-style check-ins, or summary-back phrasing");
  });

  it("does not forbid a repeated pattern the user explicitly requested", () => {
    const guide = buildConversationFreshnessGuide({
      chatMode: "conversation",
      latestUserInput: "Please end with a question so I can keep going.",
      messages: [
        { role: "assistant", content: "That makes sense. What do you want to do next?" },
        { role: "assistant", content: "I get that. Does that help?" },
      ],
    });

    expect(guide).not.toContain("avoid ending this reply with another question");
  });

  it("warns away from repeated signature details unless the user steers toward them", () => {
    const guide = buildConversationFreshnessGuide({
      chatMode: "conversation",
      latestUserInput: "Keep the reply grounded in the moment.",
      messages: [
        { role: "assistant", content: "Her silver eyes narrowed as she leaned against the counter." },
        { role: "assistant", content: "Those silver eyes flicked toward the window before she answered." },
      ],
    });
    const steeredGuide = buildConversationFreshnessGuide({
      chatMode: "conversation",
      latestUserInput: "Mention her silver eyes here.",
      messages: [
        { role: "assistant", content: "Her silver eyes narrowed as she leaned against the counter." },
        { role: "assistant", content: "Those silver eyes flicked toward the window before she answered." },
      ],
    });

    expect(guide).toContain("silver eyes");
    expect(steeredGuide ?? "").not.toContain("silver eyes");
  });

  it("does not run outside Conversation mode", () => {
    const guide = buildConversationFreshnessGuide({
      chatMode: "roleplay",
      latestUserInput: "Tell me what you think.",
      messages: [
        { role: "assistant", content: "That sounds exhausting. How are you feeling about it?" },
        { role: "assistant", content: "I hear you. Does that make sense?" },
      ],
    });

    expect(guide).toBeNull();
  });
});
