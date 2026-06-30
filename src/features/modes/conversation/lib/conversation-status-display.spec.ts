import { describe, expect, it } from "vitest";

import {
  getConversationCharacterStatusDetail,
  getConversationCharacterStatusLabel,
  getConversationCharacterStatusTitle,
} from "./conversation-status-display";

describe("conversation status display", () => {
  it("hides no-schedule availability placeholders from fake Discord status titles", () => {
    const character = {
      name: "Aster",
      conversationStatus: "online" as const,
      conversationActivity: "unknown (no schedule)",
      conversationAvailabilityExplanation: "Available: unknown (no schedule).",
    };

    expect(getConversationCharacterStatusDetail(character)).toBeNull();
    expect(getConversationCharacterStatusTitle(character, "Open Aster profile")).toBe("Open Aster profile");
    expect(getConversationCharacterStatusLabel(character)).toBe("Aster");
  });

  it("keeps meaningful schedule details available for status titles", () => {
    const character = {
      name: "Aster",
      conversationStatus: "idle" as const,
      conversationActivity: "commuting",
      conversationAvailabilityExplanation: "Delayed: commuting.",
    };

    expect(getConversationCharacterStatusDetail(character)).toBe("Delayed: commuting.");
    expect(getConversationCharacterStatusTitle(character, "Open Aster profile")).toBe("Delayed: commuting.");
    expect(getConversationCharacterStatusLabel(character)).toBe("Aster: Delayed: commuting.");
  });

  it("prefers explicit conversation status messages over schedule details", () => {
    const character = {
      name: "Aster",
      conversationStatus: "idle" as const,
      conversationStatusMessage: "At the library",
      conversationActivity: "commuting",
      conversationAvailabilityExplanation: "Delayed: commuting.",
    };

    expect(getConversationCharacterStatusDetail(character)).toBe("At the library");
  });
});