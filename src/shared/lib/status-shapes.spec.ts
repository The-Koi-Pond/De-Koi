import { describe, expect, it } from "vitest";
import { presenceDotClass } from "./status-shapes";

describe("presenceDotClass", () => {
  it("gives every non-online status a shape as well as a color", () => {
    expect(presenceDotClass("online")).toBe("bg-green-500");
    expect(presenceDotClass("idle")).toContain("cb-shape-crescent");
    expect(presenceDotClass("dnd")).toContain("cb-shape-bar");
    expect(presenceDotClass("offline")).toContain("cb-shape-ring");
  });

  it("reads a missing status as online and an unknown one as offline", () => {
    expect(presenceDotClass(undefined)).toBe("bg-green-500");
    expect(presenceDotClass("away")).toContain("cb-shape-ring");
  });
});
