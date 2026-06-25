import { describe, expect, it } from "vitest";

import { DEKI_SCENE_POSES, getDekiSceneMood } from "./deki-scene";

describe("Deki scene mood", () => {
  it("uses a greeting pose while idle", () => {
    expect(getDekiSceneMood({ historyLoaded: true, sending: false })).toBe("idle");
    expect(DEKI_SCENE_POSES.idle).toBe("/koi-mark.svg");
  });

  it("uses a thinking pose while restoring history", () => {
    expect(getDekiSceneMood({ historyLoaded: false, sending: false })).toBe("thinking");
    expect(DEKI_SCENE_POSES.thinking).toBe("/koi-mark.svg");
  });

  it("keeps the thinking pose while restoring history even if sending overlaps", () => {
    expect(getDekiSceneMood({ historyLoaded: false, sending: true })).toBe("thinking");
  });

  it("uses an explaining pose while Deki is responding", () => {
    expect(getDekiSceneMood({ historyLoaded: true, sending: true })).toBe("responding");
    expect(DEKI_SCENE_POSES.responding).toBe("/koi-mark.svg");
  });
});
