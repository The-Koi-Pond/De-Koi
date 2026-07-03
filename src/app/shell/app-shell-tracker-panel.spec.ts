import { describe, expect, it } from "vitest";

import { isTrackerPanelAvailableForChatMode } from "./app-shell-tracker-panel";

describe("app shell tracker panel eligibility", () => {
  it("does not make the tracker panel available for conversation chats", () => {
    expect(isTrackerPanelAvailableForChatMode("conversation")).toBe(false);
  });

  it("keeps the tracker panel available for tracker-backed modes", () => {
    expect(isTrackerPanelAvailableForChatMode("roleplay")).toBe(true);
    expect(isTrackerPanelAvailableForChatMode("game")).toBe(true);
  });

  it("hides the tracker panel when no active chat mode is known", () => {
    expect(isTrackerPanelAvailableForChatMode(null)).toBe(false);
    expect(isTrackerPanelAvailableForChatMode(undefined)).toBe(false);
  });
});
