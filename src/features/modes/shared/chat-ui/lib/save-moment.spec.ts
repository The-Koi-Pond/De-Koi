import { describe, expect, it } from "vitest";

import {
  applySaveMomentSummaryDraft,
  buildSaveMomentExportText,
  buildSaveMomentSource,
  buildSaveMomentMenuItems,
  buildSaveMomentSummaryDraft,
} from "./save-moment";

describe("save moment", () => {
  it("builds a canonical source payload for message actions", () => {
    expect(
      buildSaveMomentSource({
        chatId: "chat-7",
        messageId: "msg-42",
        role: "assistant",
        speakerName: undefined,
        createdAt: undefined,
        content: "The lighthouse finally answered back.",
      }),
    ).toEqual({
      chatId: "chat-7",
      messageId: "msg-42",
      role: "assistant",
      speakerName: null,
      createdAt: null,
      content: "The lighthouse finally answered back.",
    });
  });

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

  it("omits duplicate copy and branch actions already exposed by the parent message surface", () => {
    const items = buildSaveMomentMenuItems({
      canCreateSummaryDraft: true,
      canBranch: true,
      canCloneScene: false,
      canDraftLore: true,
    });

    expect(items.map((item) => item.id)).toEqual(["chat-summary", "lore-draft"]);
    expect(items.find((item) => item.id === "chat-summary")?.label).toBe("Remember in chat summary");
    expect(items.find((item) => item.id === "lore-draft")?.label).toBe("Draft lorebook entry");
  });

  it("leaves illustration out of the remember menu", () => {
    const items = buildSaveMomentMenuItems({
      canCreateSummaryDraft: false,
      canBranch: true,
      canCloneScene: false,
    });

    expect(items.map((item) => item.id)).toEqual([]);
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

  it("adds caller-provided destinations after built-in message actions", () => {
    const items = buildSaveMomentMenuItems({
      canBranch: false,
      canCloneScene: true,
      destinations: [
        { id: "game-journal-note", label: "Add journal note" },
        { id: "game-checkpoint", label: "Create checkpoint" },
      ],
    });

    expect(items.map((item) => item.id)).toEqual([
      "clone-scene",
      "destination:game-journal-note",
      "destination:game-checkpoint",
    ]);
    expect(items.at(-1)).toMatchObject({
      destinationId: "game-checkpoint",
      label: "Create checkpoint",
    });
  });
});
