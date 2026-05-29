import { describe, expect, it } from "vitest";
import { sanitizeChatPresetSettings } from "./use-chat-presets";

describe("sanitizeChatPresetSettings", () => {
  it("removes chat-specific summary metadata from saved presets", () => {
    const sanitized = sanitizeChatPresetSettings({
      connectionId: "conn",
      promptPresetId: "prompt",
      metadata: {
        enableAgents: true,
        daySummaries: { "01.01.2026": { summary: "Old chat", keyDetails: [] } },
        weekSummaries: { "29.12.2025": { summary: "Old week", keyDetails: [] } },
        summaryEntries: [],
        lastRoleplaySceneSummary: "Old scene",
      },
    });

    expect(sanitized).toEqual({
      connectionId: "conn",
      promptPresetId: "prompt",
      metadata: { enableAgents: true },
    });
  });
});
