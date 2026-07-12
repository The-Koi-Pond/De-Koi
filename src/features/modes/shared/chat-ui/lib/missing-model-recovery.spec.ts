import { describe, expect, it } from "vitest";
import { MISSING_MODEL_RECOVERY_MESSAGE } from "./missing-model-recovery";

describe("missing model recovery", () => {
  it("points users to the connection owner instead of chat settings", () => {
    expect(MISSING_MODEL_RECOVERY_MESSAGE).toContain("Connections");
    expect(MISSING_MODEL_RECOVERY_MESSAGE).toContain("Finish setup");
    expect(MISSING_MODEL_RECOVERY_MESSAGE).not.toContain("Chat Settings");
    expect(MISSING_MODEL_RECOVERY_MESSAGE).not.toContain("top right");
  });
});
