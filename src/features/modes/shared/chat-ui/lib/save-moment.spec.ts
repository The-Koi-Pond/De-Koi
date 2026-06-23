import { describe, expect, it } from "vitest";

import { buildSaveMomentExportText, buildSaveMomentMenuItems } from "./save-moment";

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
      canBranch: true,
      canCloneScene: false,
    });

    expect(items.map((item) => item.id)).toEqual(["copy-snippet", "branch"]);
  });
});
