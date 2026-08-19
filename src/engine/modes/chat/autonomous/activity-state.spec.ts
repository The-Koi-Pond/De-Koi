import { describe, expect, it } from "vitest";

import {
  clearChatActivity,
  getChatActivityState,
  setChatActivityState,
  type ChatActivityState,
} from "./activity-state";

function activityState(): ChatActivityState {
  return {
    lastUserMessageAt: 10,
    lastAssistantMessageAt: 20,
    autonomousMessages: new Map(),
    generationInProgressSince: null,
  };
}

describe("autonomous chat activity state", () => {
  it("clears the same chat state stored by the autonomous owner", () => {
    const state = activityState();
    setChatActivityState("chat-1", state);

    expect(getChatActivityState("chat-1")).toBe(state);

    clearChatActivity("chat-1");

    expect(getChatActivityState("chat-1")).toBeUndefined();
  });
});
