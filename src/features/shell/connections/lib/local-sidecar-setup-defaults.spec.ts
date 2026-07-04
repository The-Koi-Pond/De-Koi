import { describe, expect, it } from "vitest";
import { preferredCuratedQuantization } from "./local-sidecar-setup-defaults";

describe("local sidecar setup defaults", () => {
  it("prefers the smaller curated model on Linux arm64 boards", () => {
    expect(preferredCuratedQuantization("linux", "arm64")).toBe("q4_k_m");
  });

  it("keeps the quality preset for stronger default platforms", () => {
    expect(preferredCuratedQuantization("win32", "x64")).toBe("q8_0");
  });
});
