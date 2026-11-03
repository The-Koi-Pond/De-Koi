import { describe, expect, it } from "vitest";

import { getDekiSceneMood } from "./deki-scene";

describe("Deki scene mood", () => {
  it("squishes calmly when nothing is happening", () => {
    expect(getDekiSceneMood({ sending: false, justReplied: false })).toBe("idle");
  });

  it("thinks while waiting for an answer", () => {
    expect(getDekiSceneMood({ sending: true, justReplied: false })).toBe("thinking");
  });

  it("keeps thinking if a new question goes out during the happy hop", () => {
    expect(getDekiSceneMood({ sending: true, justReplied: true })).toBe("thinking");
  });

  it("hops once an answer has arrived", () => {
    expect(getDekiSceneMood({ sending: false, justReplied: true })).toBe("happy");
  });
});
