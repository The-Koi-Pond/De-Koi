import { describe, expect, it } from "vitest";
import { autonomousUnreadClearKey } from "./app-shell-autonomous-unread";

const base = {
  activeChatId: "chat-1",
  isPageActive: true,
  isClearing: false,
  metadata: { autonomousUnreadCount: 1, autonomousUnreadAt: "2026-10-21T18:20:32.000Z" },
  hasLocalUnread: false,
  lastClearKey: null,
};

describe("autonomousUnreadClearKey", () => {
  it("clears a texts-first unread mark when the chat is on screen", () => {
    expect(autonomousUnreadClearKey(base)).toBe("chat-1:1:2026-10-21T18:20:32.000Z");
  });

  // A backgrounded phone tab with the chat open used to clear the mark 0.2 s after the message arrived, so the
  // unread dot never showed even though the user hadn't read it.
  it("leaves the mark alone while the page is hidden", () => {
    expect(autonomousUnreadClearKey({ ...base, isPageActive: false })).toBeNull();
  });

  it("clears once the page becomes visible again", () => {
    expect(autonomousUnreadClearKey({ ...base, isPageActive: false })).toBeNull();
    expect(autonomousUnreadClearKey({ ...base, isPageActive: true })).not.toBeNull();
  });

  it("clears a local-only unread count too", () => {
    expect(autonomousUnreadClearKey({ ...base, metadata: {}, hasLocalUnread: true })).toBe("chat-1:0:");
  });

  it("does nothing with no unread, no active chat, a clear in flight, or the same mark already cleared", () => {
    expect(autonomousUnreadClearKey({ ...base, metadata: {} })).toBeNull();
    expect(autonomousUnreadClearKey({ ...base, activeChatId: null })).toBeNull();
    expect(autonomousUnreadClearKey({ ...base, isClearing: true })).toBeNull();
    expect(autonomousUnreadClearKey({ ...base, lastClearKey: "chat-1:1:2026-10-21T18:20:32.000Z" })).toBeNull();
  });
});
