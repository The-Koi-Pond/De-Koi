import { describe, expect, it } from "vitest";

import { filterAgentIdsForChatMode, isBuiltInAgentAvailableInChatMode } from "./agent";

describe("built-in agent chat mode availability", () => {
  it("allows explicit illustrator retries in Conversation mode", () => {
    expect(isBuiltInAgentAvailableInChatMode("conversation", "illustrator")).toBe(true);
    expect([...filterAgentIdsForChatMode(["illustrator"], "conversation")]).toEqual(["illustrator"]);
  });
});