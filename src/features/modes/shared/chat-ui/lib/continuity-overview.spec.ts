import { describe, expect, it } from "vitest";

import type { ChatMetadata } from "../../../../../engine/contracts/types/chat";
import { buildContinuityOverviewViewModel } from "./continuity-overview";

describe("continuity overview view model", () => {
  it("summarizes the current chat continuity systems in user-facing terms", () => {
    const metadata: Partial<ChatMetadata> = {
      summary: "The group reached the moonlit station.",
      summaryEntries: [
        {
          kind: "rolling",
          id: "summary-1",
          title: "Station arrival",
          content: "The group reached the moonlit station.",
          origin: "manual",
          enabled: true,
          sourceMode: "last",
          tokenEstimate: 8,
          createdAt: "2026-06-23T00:00:00.000Z",
          updatedAt: "2026-06-23T00:00:00.000Z",
        },
        {
          kind: "rolling",
          id: "summary-empty",
          title: "Empty",
          content: "   ",
          origin: "manual",
          enabled: true,
          sourceMode: "last",
          tokenEstimate: 8,
          createdAt: "2026-06-23T00:00:00.000Z",
          updatedAt: "2026-06-23T00:00:00.000Z",
        },
      ],
      activeAgentIds: ["chat-summary", "world-state", "custom-tracker"],
      activeLorebookIds: ["moon-station"],
      enableMemoryRecall: undefined,
    };

    const model = buildContinuityOverviewViewModel({
      chatMode: "conversation",
      metadata,
      activeLorebookCount: 2,
      totalMessageCount: 42,
    });

    expect(model.headline).toBe("4 continuity sources active");
    expect(model.sections).toEqual([
      expect.objectContaining({
        id: "memory",
        label: "Memory",
        status: "active",
        value: "On",
        detail: "Earlier chat fragments can be recalled after 1 recent message.",
        action: "open_memories",
      }),
      expect.objectContaining({
        id: "summary",
        label: "Summary",
        status: "active",
        value: "1 entry",
        detail: "Automated Chat Summary is also enabled.",
        action: "open_summaries",
      }),
      expect.objectContaining({
        id: "lorebooks",
        label: "World Info",
        status: "active",
        value: "2 sources",
        detail: "Active lorebooks can inject matching world info into prompts.",
        action: "manage_lorebooks",
      }),
      expect.objectContaining({
        id: "trackers",
        label: "Trackers",
        status: "active",
        value: "2 agents",
        detail: "World State and Custom Tracker can update continuity after messages.",
        action: "manage_agents",
      }),
    ]);
  });

  it("uses the roleplay memory default and missing-state labels when nothing is configured", () => {
    const model = buildContinuityOverviewViewModel({
      chatMode: "roleplay",
      metadata: { summary: null, activeAgentIds: [] },
      activeLorebookCount: 0,
      totalMessageCount: 0,
    });

    expect(model.headline).toBe("No continuity sources active yet");
    expect(model.sections.map((section) => [section.id, section.status, section.value])).toEqual([
      ["memory", "idle", "Off"],
      ["summary", "idle", "Missing"],
      ["lorebooks", "idle", "None"],
      ["trackers", "idle", "None"],
    ]);
  });
});
