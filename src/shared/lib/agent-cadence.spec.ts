import { describe, expect, it } from "vitest";

import { getAgentRunIntervalMeta } from "./agent-cadence";

describe("getAgentRunIntervalMeta", () => {
  it("gives Narrative Craft an assistant-message cadence with a four-message default", () => {
    expect(getAgentRunIntervalMeta("narrative-craft")).toEqual({
      label: "Run every N assistant messages",
      unit: "assistant messages",
      help: "How many assistant messages should pass before Narrative Craft analyzes the story again.",
      defaultValue: 4,
      max: 100,
    });
  });

  it("does not retain Director-specific cadence metadata", () => {
    expect(getAgentRunIntervalMeta("director")).toBeNull();
  });
});
