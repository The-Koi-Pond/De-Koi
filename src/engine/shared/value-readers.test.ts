import { describe, expect, it } from "vitest";
import { readString } from "./value-readers";

describe("readString", () => {
  it("returns string values without replacing empty strings", () => {
    expect(readString("Nia")).toBe("Nia");
    expect(readString("", "fallback")).toBe("");
  });

  it("returns the fallback for non-string values without coercion", () => {
    expect(readString(null)).toBe("");
    expect(readString(42, "fallback")).toBe("fallback");
    expect(readString({ value: "Nia" }, "fallback")).toBe("fallback");
  });

});
