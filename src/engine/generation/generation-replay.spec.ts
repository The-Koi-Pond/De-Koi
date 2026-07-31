import { describe, expect, it } from "vitest";

import { applyCachedContextInjectionsToRegenerateInput, type GenerationReplayInput } from "./generation-replay";

describe("cached generation injections", () => {
  it("does not replay current or retired narrative guidance", () => {
    const input: GenerationReplayInput = {};

    expect(
      applyCachedContextInjectionsToRegenerateInput(input, [
        "legacy prose guidance",
        { agentType: "narrative-craft", text: "current craft guidance" },
        { agentType: "prose-guardian", text: "old prose guidance" },
        { agentType: "director", text: "old direction" },
        { agentType: "secret-plot-driver", text: "old plot direction" },
        { agentType: "continuity", agentName: "Continuity Checker", text: "Keep the date consistent." },
      ]),
    ).toBe(true);

    expect(input.agentInjectionOverrides).toEqual([
      { agentType: "continuity", agentName: "Continuity Checker", text: "Keep the date consistent." },
    ]);
  });

  it("does not create overrides when the cache contains only stale narrative guidance", () => {
    const input: GenerationReplayInput = {};

    expect(applyCachedContextInjectionsToRegenerateInput(input, ["legacy prose guidance"])).toBe(false);
    expect(input.agentInjectionOverrides).toBeUndefined();
  });
});
