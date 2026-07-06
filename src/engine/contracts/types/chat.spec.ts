import { describe, expect, it } from "vitest";

import { getEffectiveMemoryRecallEnabled } from "./chat";

describe("getEffectiveMemoryRecallEnabled", () => {
  it("uses one default for omitted Memory Recall metadata", () => {
    expect(getEffectiveMemoryRecallEnabled("conversation", {})).toBe(true);
    expect(getEffectiveMemoryRecallEnabled("roleplay", {})).toBe(true);
    expect(getEffectiveMemoryRecallEnabled("visual_novel", {})).toBe(true);
    expect(getEffectiveMemoryRecallEnabled("game", {})).toBe(false);
    expect(getEffectiveMemoryRecallEnabled("game", { sceneStatus: "active" })).toBe(true);
  });

  it("honors explicit chat metadata over the default", () => {
    expect(getEffectiveMemoryRecallEnabled("roleplay", { enableMemoryRecall: false })).toBe(false);
    expect(getEffectiveMemoryRecallEnabled("game", { enableMemoryRecall: true })).toBe(true);
  });
});
