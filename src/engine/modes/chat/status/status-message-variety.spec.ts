import { describe, expect, it } from "vitest";

import {
  appendAcceptedStatusMessage,
  isRepeatedStatusMessage,
  nextStatusAngle,
  readStatusMessageVarietyState,
} from "./status-message-variety";

describe("status message variety state", () => {
  it("reads legacy current status into a bounded recent history", () => {
    const state = readStatusMessageVarietyState({
      conversationStatusMessage: "latest status",
      conversationStatusMessageMeta: {
        recentMessages: ["status one", "status two", "status three", "status four", "status five", "status six"],
      },
    });

    expect(state.recentMessages).toEqual([
      "status two",
      "status three",
      "status four",
      "status five",
      "status six",
      "latest status",
    ]);
    expect(state.previousAngle).toBeNull();
  });

  it("rotates deterministically through every status angle", () => {
    const first = nextStatusAngle("char-1", null);
    const seen = [first.id];
    let current = first;

    for (let index = 1; index < 6; index += 1) {
      current = nextStatusAngle("char-1", current.id);
      seen.push(current.id);
    }

    expect(new Set(seen).size).toBe(6);
    expect(nextStatusAngle("char-1", current.id).id).toBe(first.id);
    expect(nextStatusAngle("char-1", null).id).toBe(first.id);
  });

  it("appends accepted statuses once and retains only the newest six", () => {
    const history = appendAcceptedStatusMessage(
      ["one", "two", "three", "four", "five", "SAME status"],
      " same   status ",
    );

    expect(history).toEqual(["one", "two", "three", "four", "five", "same status"]);
    expect(appendAcceptedStatusMessage(history, "brand new")).toEqual([
      "two",
      "three",
      "four",
      "five",
      "same status",
      "brand new",
    ]);
  });
});

describe("status message similarity", () => {
  it.each([
    ["Thinking about yesterday!", ["thinking about yesterday"], true],
    ["still thinking about yesterday", ["thinking about yesterday"], true],
    ["thinking again about yesterday", ["still thinking about yesterday"], true],
    ["still in class", ["in class"], true],
    ["🌙", ["🌙"], true],
    ["coffee has become structural", ["thinking about yesterday"], false],
    ["in class", ["at work"], false],
  ])("classifies %j against recent statuses", (candidate, recentMessages, expected) => {
    expect(isRepeatedStatusMessage(candidate, recentMessages)).toBe(expected);
  });
});
