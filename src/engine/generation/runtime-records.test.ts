import { describe, expect, it } from "vitest";
import { readString } from "./runtime-records";

describe("runtime record readers", () => {
  it("keeps readString available from the generation runtime-records module", () => {
    expect(readString("Nia")).toBe("Nia");
    expect(readString(42, "fallback")).toBe("fallback");
  });
});
