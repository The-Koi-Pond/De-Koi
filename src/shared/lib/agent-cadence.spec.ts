import { describe, expect, it } from "vitest";

import { getAgentRunIntervalMeta } from "./agent-cadence";

describe("getAgentRunIntervalMeta", () => {
  it("does not retain cadence metadata for removed narrative agents", () => {
    expect(getAgentRunIntervalMeta("narrative-craft")).toBeNull();
    expect(getAgentRunIntervalMeta("director")).toBeNull();
  });
});
