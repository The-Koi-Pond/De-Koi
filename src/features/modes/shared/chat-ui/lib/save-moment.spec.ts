import { describe, expect, it } from "vitest";

import {
  applySaveMomentSummaryDraft,
  buildSaveMomentExportText,
  buildSaveMomentMenuItems,
  buildSaveMomentSummaryDraft,
} from "./save-moment";

describe("save moment", () => {
  it("builds an export snippet with source message metadata", () => {
    const text = buildSaveMomentExportText({
      chatId: "chat-7",
      messageId: "msg-42",
      role: "assistant",
      speakerName: "Deki",
      createdAt: "2026-06-23T15:40:00.000Z",
      content: "The lighthouse finally answered back.",
    });

    expect(text).toBe(
      [
        "De-Koi Save Moment",
        "Chat: chat-7",
        "Message: msg-42",
        "Role: assistant",
        "Speaker: Deki",
        "Created: 2026-06-23T15:40:00.000Z",
        "",
        "The lighthouse finally answered back.",
      ].join("\n"),
    );
  });

  it("only exposes destinations backed by the current message surface", () => {
    const items = buildSaveMomentMenuItems({
      canCreateSummaryDraft: true,
      canBranch: true,
      canCloneScene: false,
      canDraftLore: true,
    });

    expect(items.map((item) => item.id)).toEqual(["copy-snippet", "chat-summary", "lore-draft", "branch"]);
  });

  it("builds a chat summary draft from source message metadata", () => {
    const draft = buildSaveMomentSummaryDraft({
      chatId: "chat-7",
      messageId: "msg-42",
      role: "assistant",
      speakerName: "Deki",
      createdAt: "2026-06-23T15:40:00.000Z",
      content: "The lighthouse finally answered back.",
    });

    expect(draft.dateKey).toBe("23.06.2026");
    expect(draft.detail).toBe(
      "Save Moment from Deki (assistant). Source chat chat-7, message msg-42: The lighthouse finally answered back.",
    );
  });

  it("prefills the selected day summary without mutating existing drafts", () => {
    const current = {
      daySummaries: {
        "23.06.2026": {
          summary: "Morning setup.",
          keyDetails: ["The lighthouse was quiet."],
        },
      },
      weekSummaries: {},
    };
    const next = applySaveMomentSummaryDraft(current, {
      source: {
        chatId: "chat-7",
        messageId: "msg-42",
        role: "assistant",
        speakerName: "Deki",
        createdAt: "2026-06-23T15:40:00.000Z",
        content: "The lighthouse finally answered back.",
      },
      dateKey: "23.06.2026",
      detail:
        "Save Moment from Deki (assistant). Source chat chat-7, message msg-42: The lighthouse finally answered back.",
    });

    expect(next.daySummaries["23.06.2026"]?.keyDetails).toEqual([
      "The lighthouse was quiet.",
      "Save Moment from Deki (assistant). Source chat chat-7, message msg-42: The lighthouse finally answered back.",
    ]);
    expect(current.daySummaries["23.06.2026"]?.keyDetails).toEqual(["The lighthouse was quiet."]);
  });
});
