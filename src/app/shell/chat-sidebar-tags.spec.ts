import { describe, expect, it } from "vitest";

import { formatChatTagsDraft, normalizeChatTagsDraft } from "./chat-sidebar-tags";

describe("chat sidebar tags", () => {
  it("normalizes comma and newline separated tag drafts", () => {
    expect(normalizeChatTagsDraft(" story, urgent\nstory,  cozy ")).toEqual(["story", "urgent", "cozy"]);
  });

  it("formats existing tags for editing", () => {
    expect(formatChatTagsDraft(["story", "urgent"])).toBe("story, urgent");
  });
});
